const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const JournalEntry = require('../models/JournalEntry');
const currencyUtil = require('../utils/currency');

/**
 * إنشاء طلب بيع (draft)
 * لا يؤثر على المخزون أو القيود حتى يُرحّل
 */
const create = async (companyId, userId, payload) => {
  // في بداية create:
let exchangeRate = Number(payload.exchange_rate || 0);
if (exchangeRate <= 0) {
  const currencyUtil = require('../utils/currency');
  const ex = await currencyUtil.toBase(companyId, 1, payload.currency_id, payload.order_date);
  exchangeRate = ex.rate;
}
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) توليد رقم الطلب
    const number = await nextOrderNumber(client, companyId);

    // 2) تحقق من العميل
    const cust = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [payload.customer_id, companyId]
    );
    if (!cust.rowCount) throw new ApiError(400, 'Customer not found or inactive');

    // 3) تحقق من العملة
    const cur = await client.query(
      `SELECT id FROM currencies WHERE id = $1`,
      [payload.currency_id]
    );
    if (!cur.rowCount) throw new ApiError(400, 'Currency not found');

    // 4) احسب المجاميع
    const totals = await calculateTotals(client, companyId, payload.items);

    // 5) أدخل الطلب
    const orderRes = await client.query(
      `INSERT INTO sales_orders
         (company_id, order_number, customer_id, order_date, currency_id, exchange_rate,
          subtotal, tax_total, total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)
       RETURNING id, order_number, status, subtotal, tax_total, total`,
      [
        companyId, number, payload.customer_id,
        payload.order_date || new Date().toISOString().slice(0, 10),
        payload.currency_id, payload.exchange_rate || 1,
        totals.subtotal, totals.tax_total, totals.total, userId,
      ]
    );
    const order = orderRes.rows[0];

    // 6) أدخل السطور
    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO sales_order_items
           (order_id, product_id, batch_id, quantity, unit_price, tax_rate, tax_amount, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [order.id, item.product_id, item.batch_id || null, item.quantity,
         item.unit_price, item.tax_rate, item.tax_amount, item.line_total]
      );
    }

    await client.query('COMMIT');
    return { ...order, items: totals.enrichedItems };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * ترحيل الطلب → خصم المخزون + إنشاء قيد
 */


const confirm = async (companyId, userId, orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'draft') throw new ApiError(400, 'Only draft orders can be confirmed');

    const itemsRes = await client.query(
      `SELECT soi.*, p.name AS product_name
       FROM sales_order_items soi
       JOIN products p ON p.id = soi.product_id
       WHERE soi.order_id = $1`,
      [orderId]
    );

    // 🔥 التحقق من سعر الصرف وحساب المبالغ بالعملة الأساسية
    const exchange = await currencyUtil.toBase(
      companyId, 1, order.currency_id, order.order_date
    );
    // إذا كانت العملة الأساسية → rate = 1
    // وإلا → نستخدم order.exchange_rate المحفوظ (أو السعر الحالي إن كان 1)
    const rate = Number(order.exchange_rate) > 0
      ? Number(order.exchange_rate)
      : exchange.rate;

    const totalBase     = round2(Number(order.total) * rate);
    const subtotalBase  = round2(Number(order.subtotal) * rate);
    const taxBase       = round2(Number(order.tax_total) * rate);

    // خصم المخزون
    let totalCogs = 0;
    for (const item of itemsRes.rows) {
      const { batchId, cogs } = await consumeStock(
        client, companyId, item.product_id, item.quantity, item.batch_id
      );
      totalCogs += cogs;

      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         SELECT $1, b.warehouse_id, b.id, 'out', $2, b.cost_price,
                'sale', $3, $4, $5
         FROM product_batches b WHERE b.id = $6`,
        [companyId, item.quantity, orderId, order.order_date, userId, batchId]
      );
    }

    const accounts = await getDefaultAccounts(client, companyId);

    // 🔥 القيد بالعملة الأساسية
    const lines = [
      { account_id: accounts.receivable, debit: totalBase, credit: 0,
        description: `طلب بيع ${order.order_number} (${order.exchange_rate} × ${order.total})` },
      { account_id: accounts.revenue, credit: subtotalBase, debit: 0,
        description: 'إيراد مبيعات' },
      ...(taxBase > 0
        ? [{ account_id: accounts.vat, credit: taxBase, debit: 0, description: 'ضريبة القيمة المضافة' }]
        : []),
      ...(totalCogs > 0
        ? [{ account_id: accounts.cogs, debit: totalCogs, credit: 0, description: 'تكلفة المبيعات' },
           { account_id: accounts.inventory, credit: totalCogs, debit: 0, description: 'خصم مخزون' }]
        : []),
    ];

    const entry = await JournalEntry.create(client, companyId, {
      entry_date: order.order_date,
      description: `قيد طلب بيع ${order.order_number} [${order.exchange_rate}]`,
      source_type: 'sale',
      source_id: orderId,
      created_by: userId,
      lines,
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    await client.query(
      `UPDATE sales_orders SET status = 'confirmed', journal_entry_id = $1 WHERE id = $2`,
      [entry.id, orderId]
    );

    await client.query('COMMIT');
    return { id: orderId, status: 'confirmed', journal_entry_id: entry.id, total_cogs: totalCogs };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

function round2(n) { return Math.round(Number(n) * 100) / 100; }
/**
 * إلغاء الطلب
 */
const cancel = async (companyId, orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (!['draft', 'confirmed'].includes(order.status)) {
      throw new ApiError(400, 'Order cannot be cancelled');
    }

    // إذا كان مرحّل، نعيد المخزون ونلغي القيد
    if (order.status === 'confirmed') {
      const movements = await client.query(
        `SELECT sm.batch_id, SUM(sm.quantity)::numeric AS total_qty
         FROM stock_movements sm
         WHERE sm.reference_type = 'sale' AND sm.reference_id = $1
         GROUP BY sm.batch_id`,
        [orderId]
      );

      for (const mv of movements.rows) {
        await client.query(
          `UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`,
          [mv.total_qty, mv.batch_id]
        );
      }

      // إلغاء القيد
      if (order.journal_entry_id) {
        await client.query(
          `DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`,
          [order.journal_entry_id]
        );
        await client.query(
          `DELETE FROM journal_entries WHERE id = $1 AND status = 'draft'`,
          [order.journal_entry_id]
        );
      }
    }

    await client.query(
      `UPDATE sales_orders SET status = 'cancelled' WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');
    return { id: orderId, status: 'cancelled' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ============ Helpers ============

async function nextOrderNumber(client, companyId) {
  const r = await client.query(
    `SELECT COUNT(*)::int + 1 AS next FROM sales_orders WHERE company_id = $1`,
    [companyId]
  );
  return `SO-${String(r.rows[0].next).padStart(5, '0')}`;
}

async function calculateTotals(client, companyId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required');
  }

  const enrichedItems = [];
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    // تحقق من المنتج
    const p = await client.query(
      `SELECT id FROM products WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [item.product_id, companyId]
    );
    if (!p.rowCount) throw new ApiError(400, `Product ${item.product_id} not found`);

    const qty = Number(item.quantity);
    const price = Number(item.unit_price);
    if (qty <= 0) throw new ApiError(400, 'Quantity must be > 0');
    if (price < 0) throw new ApiError(400, 'Price must be >= 0');

    const lineSubtotal = qty * price;
    const taxRate = Number(item.tax_rate || 0);
    const taxAmount = lineSubtotal * (taxRate / 100);
    const lineTotal = lineSubtotal + taxAmount;

    subtotal += lineSubtotal;
    taxTotal += taxAmount;

    enrichedItems.push({
      product_id: item.product_id,
      batch_id: item.batch_id || null,
      quantity: qty,
      unit_price: price,
      tax_rate: taxRate,
      tax_amount: Math.round(taxAmount * 100) / 100,
      line_total: Math.round(lineTotal * 100) / 100,
    });
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax_total: Math.round(taxTotal * 100) / 100,
    total: Math.round((subtotal + taxTotal) * 100) / 100,
    enrichedItems,
  };
}

/**
 * خصم المخزون من الـ batches (FIFO حسب expiry_date)
 */
async function consumeStock(client, companyId, productId, requiredQty, preferredBatchId = null) {
  let remaining = Number(requiredQty);
  let totalCogs = 0;
  let lastBatchId = null;

  // إذا حُدد batch معيّن، نستخدمه أولاً
  let query = preferredBatchId
    ? `SELECT id, quantity, cost_price FROM product_batches
       WHERE id = $1 AND product_id = $2 AND company_id = $3 AND quantity > 0 FOR UPDATE`
    : `SELECT id, quantity, cost_price FROM product_batches
       WHERE product_id = $1 AND company_id = $2 AND quantity > 0
       ORDER BY expiry_date ASC FOR UPDATE`;

  const params = preferredBatchId ? [preferredBatchId, productId, companyId] : [productId, companyId];
  const batches = await client.query(query, params);

  if (!batches.rowCount) throw new ApiError(400, 'No stock available for product');

  for (const batch of batches.rows) {
    if (remaining <= 0) break;
    const take = Math.min(Number(batch.quantity), remaining);
    await client.query(
      `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`,
      [take, batch.id]
    );
    totalCogs += take * Number(batch.cost_price);
    remaining -= take;
    lastBatchId = batch.id;
  }

  if (remaining > 0) throw new ApiError(400, `Insufficient stock (missing ${remaining})`);

  return { batchId: lastBatchId, cogs: totalCogs };
}

async function getDefaultAccounts(client, companyId) {
  const codes = {
    receivable: '1120',
    revenue: '4100',
    vat: '2120',
    cogs: '5100',
    inventory: '1130',
  };
  const r = await client.query(
    `SELECT code, id FROM chart_of_accounts
     WHERE company_id = $1 AND code = ANY($2::text[])`,
    [companyId, Object.values(codes)]
  );
  const map = {};
  for (const row of r.rows) {
    const key = Object.keys(codes).find((k) => codes[k] === row.code);
    if (key) map[key] = row.id;
  }
  for (const [key, code] of Object.entries(codes)) {
    if (!map[key]) throw new ApiError(500, `Required account ${code} not found`);
  }
  return map;
}

module.exports = { create, confirm, cancel };