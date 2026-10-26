const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const JournalEntry = require('../models/JournalEntry');
const currencyUtil = require('../utils/currency');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * إنشاء طلب بيع (draft) مع دعم الكميات المدفوعة والمجانية والخصومات والسعر الصافي
 */
const create = async (companyId, userId, payload) => {
  let exchangeRate = Number(payload.exchange_rate || 0);
  if (exchangeRate <= 0) {
    const ex = await currencyUtil.toBase(companyId, 1, payload.currency_id, payload.order_date);
    exchangeRate = ex.rate;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const number = await nextOrderNumber(client, companyId);

    const cust = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [payload.customer_id, companyId]
    );
    if (!cust.rowCount) throw new ApiError(400, 'Customer not found or inactive');

    const cur = await client.query(
      `SELECT id FROM currencies WHERE id = $1`,
      [payload.currency_id]
    );
    if (!cur.rowCount) throw new ApiError(400, 'Currency not found');

    const totals = await calculateTotals(client, companyId, payload.items);

    const orderRes = await client.query(
      `INSERT INTO sales_orders
         (company_id, order_number, customer_id, order_date, currency_id, exchange_rate,
          subtotal, tax_total, total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)
       RETURNING id, order_number, status, subtotal, tax_total, total`,
      [
        companyId, number, payload.customer_id,
        payload.order_date || new Date().toISOString().slice(0, 10),
        payload.currency_id, exchangeRate,
        totals.subtotal, totals.tax_total, totals.total, userId,
      ]
    );
    const order = orderRes.rows[0];

    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO sales_order_items
           (order_id, product_id, batch_id, quantity, unit_price, tax_rate, tax_amount, line_total,
            paid_quantity, bonus_quantity, discount_rate, discount_amount, net_unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          order.id, item.product_id, item.batch_id || null, item.quantity,
          item.unit_price, item.tax_rate, item.tax_amount, item.line_total,
          item.paid_quantity, item.bonus_quantity, item.discount_rate, item.discount_amount, item.net_unit_price
        ]
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

    const exchange = await currencyUtil.toBase(
      companyId, 1, order.currency_id, order.order_date
    );
    const rate = Number(order.exchange_rate) > 0
      ? Number(order.exchange_rate)
      : exchange.rate;

    const totalBase     = round2(Number(order.total) * rate);
    const subtotalBase  = round2(Number(order.subtotal) * rate);
    const taxBase       = round2(Number(order.tax_total) * rate);

    let totalCogs = 0;
    for (const item of itemsRes.rows) {
      // إجمالي الكمية المطلوب صرفها من المخزون (المدفوعة + المجانية)
      const totalPhysicalQty = Number(item.quantity);
      const { batchId, cogs } = await consumeStock(
        client, companyId, item.product_id, totalPhysicalQty, item.batch_id
      );
      totalCogs += cogs;

      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         SELECT $1, b.warehouse_id, b.id, 'out', $2, b.cost_price,
                'sale', $3, $4, $5
         FROM product_batches b WHERE b.id = $6`,
        [companyId, totalPhysicalQty, orderId, order.order_date, userId, batchId]
      );
    }

    const accounts = await getDefaultAccounts(client, companyId);

    const lines = [
      { account_id: accounts.receivable, debit: totalBase, credit: 0,
        description: `طلب بيع ${order.order_number}` },
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
      description: `قيد طلب بيع ${order.order_number}`,
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
    const p = await client.query(
      `SELECT id FROM products WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [item.product_id, companyId]
    );
    if (!p.rowCount) throw new ApiError(400, `Product ${item.product_id} not found`);

    const paidQty = Number(item.paid_quantity ?? item.quantity);
    const bonusQty = Number(item.bonus_quantity || 0);
    const totalPhysicalQty = paidQty + bonusQty;
    const price = Number(item.unit_price);

    if (paidQty <= 0) throw new ApiError(400, 'Paid quantity must be > 0');
    if (price < 0) throw new ApiError(400, 'Price must be >= 0');

    const grossSubtotal = paidQty * price;
    let discountAmt = Number(item.discount_amount || 0);
    const discountRate = Number(item.discount_rate || 0);
    if (discountRate > 0) {
      discountAmt = grossSubtotal * (discountRate / 100);
    }

    const netSubtotal = Math.max(0, grossSubtotal - discountAmt);
    const netUnitPrice = totalPhysicalQty > 0 ? round2(netSubtotal / totalPhysicalQty) : 0;

    const taxRate = Number(item.tax_rate || 0);
    const taxAmount = netSubtotal * (taxRate / 100);
    const lineTotal = netSubtotal + taxAmount;

    subtotal += netSubtotal;
    taxTotal += taxAmount;

    enrichedItems.push({
      product_id: item.product_id,
      batch_id: item.batch_id || null,
      paid_quantity: paidQty,
      bonus_quantity: bonusQty,
      quantity: totalPhysicalQty, // إجمالي الكمية للمخزون
      unit_price: price,
      discount_rate: discountRate,
      discount_amount: round2(discountAmt),
      net_unit_price: netUnitPrice,
      tax_rate: taxRate,
      tax_amount: round2(taxAmount),
      line_total: round2(lineTotal),
    });
  }

  return {
    subtotal: round2(subtotal),
    tax_total: round2(taxTotal),
    total: round2(subtotal + taxTotal),
    enrichedItems,
  };
}

async function consumeStock(client, companyId, productId, requiredQty, preferredBatchId = null) {
  let remaining = Number(requiredQty);
  let totalCogs = 0;
  let lastBatchId = null;

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