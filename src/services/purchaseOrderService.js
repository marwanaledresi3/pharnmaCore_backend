const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const JournalEntry = require('../models/JournalEntry');
const PurchaseOrder = require('../models/PurchaseOrder');

/**
 * إنشاء أمر شراء (draft)
 */
const create = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const number = await PurchaseOrder.nextNumber(client, companyId);

    // تحقق من المورد
    const sup = await client.query(
      `SELECT id FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [payload.supplier_id, companyId]
    );
    if (!sup.rowCount) throw new ApiError(400, 'Supplier not found or inactive');

    // تحقق من العملة
    const cur = await client.query(
      `SELECT id FROM currencies WHERE id = $1`,
      [payload.currency_id]
    );
    if (!cur.rowCount) throw new ApiError(400, 'Currency not found');

    // احسب المجاميع
    const totals = await calculateTotals(client, companyId, payload.items);

    // أدخل الطلب
    const orderRes = await client.query(
      `INSERT INTO purchase_orders
         (company_id, order_number, supplier_id, order_date, currency_id, exchange_rate,
          subtotal, tax_total, total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)
       RETURNING id, order_number, status, subtotal, tax_total, total`,
      [
        companyId, number, payload.supplier_id,
        payload.order_date || new Date().toISOString().slice(0, 10),
        payload.currency_id, payload.exchange_rate || 1,
        totals.subtotal, totals.tax_total, totals.total, userId,
      ]
    );
    const order = orderRes.rows[0];

    // أدخل السطور (مع batch_number و expiry_date اختياري)
    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO purchase_order_items
           (order_id, product_id, quantity, unit_price, tax_rate, tax_amount, line_total,
            batch_number, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          order.id, item.product_id, item.quantity, item.unit_price,
          item.tax_rate, item.tax_amount, item.line_total,
          item.batch_number || null, item.expiry_date || null,
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

/**
 * تأكيد أمر الشراء → استلام مخزون + إنشاء قيد
 */
const confirm = async (companyId, userId, orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Purchase order not found');
    if (order.status !== 'draft') throw new ApiError(400, 'Only draft orders can be confirmed');

    const itemsRes = await client.query(
      `SELECT poi.*, p.name AS product_name
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1`,
      [orderId]
    );

    // 1) إضافة المخزون (batches)
    // نفترض أن كل سطر ينشئ batch جديد (ما لم يُعطَ batch_number -> نعيد استخدام الموجود)
    let totalInventoryCost = 0;

    for (const item of itemsRes.rows) {
      const batchNumber = item.batch_number || `PO${order.order_number}-${item.id.slice(0, 8)}`;
      const expiry = item.expiry_date || '2099-12-31';

      // نحتاج warehouse_id — نستخدم الرئيسي أو نطلب من المستخدم إضافته
      // نستخدم أول مستودع نشط (المستودع الرئيسي عادة)
      const warehouseRes = await client.query(
        `SELECT id FROM warehouses WHERE company_id = $1 AND is_active = TRUE
         ORDER BY created_at ASC LIMIT 1`,
        [companyId]
      );
      if (!warehouseRes.rowCount) throw new ApiError(400, 'No active warehouse found');
      const warehouseId = warehouseRes.rows[0].id;

      // ابحث عن batch موجود بنفس (product, warehouse, batch_number)
      const existingBatch = await client.query(
        `SELECT id, quantity FROM product_batches
         WHERE product_id = $1 AND warehouse_id = $2 AND batch_number = $3
         FOR UPDATE`,
        [item.product_id, warehouseId, batchNumber]
      );

      let batchId;
      if (existingBatch.rowCount) {
        // أضف للكمية
        await client.query(
          `UPDATE product_batches SET quantity = quantity + $1, cost_price = $2
           WHERE id = $3`,
          [item.quantity, item.unit_price, existingBatch.rows[0].id]
        );
        batchId = existingBatch.rows[0].id;
      } else {
        // أنشئ batch جديد
        const newBatch = await client.query(
          `INSERT INTO product_batches
             (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [companyId, item.product_id, warehouseId, batchNumber, expiry, item.unit_price, item.quantity]
        );
        batchId = newBatch.rows[0].id;
      }

      // سجّل حركة المخزون
      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         VALUES ($1, $2, $3, 'in', $4, $5, 'purchase', $6, $7, $8)`,
        [companyId, warehouseId, batchId, item.quantity, item.unit_price,
         orderId, order.order_date, userId]
      );

      totalInventoryCost += Number(item.line_total);
    }

    // 2) جلب الحسابات
    const accounts = await getDefaultAccounts(client, companyId);

    // داخل confirm بعد جلب order:

const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
const totalBase    = round2(Number(order.total) * rate);
const subtotalBase = round2(Number(order.subtotal) * rate);
const taxBase      = round2(Number(order.tax_total) * rate);

// القيد:
const lines = [
  { account_id: accounts.inventory, debit: subtotalBase, credit: 0, description: 'استلام مخزون' },
];
if (taxBase > 0) {
  lines.push({ account_id: accounts.vat_input, debit: taxBase, credit: 0, description: 'ضريبة مدخلات' });
}
lines.push({ account_id: accounts.payable, credit: totalBase, debit: 0,
             description: `أمر شراء ${order.order_number} [${order.exchange_rate}]` });
    

    
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: order.order_date,
      description: `قيد أمر شراء ${order.order_number}`,
      source_type: 'purchase',
      source_id: orderId,
      created_by: userId,
      lines,
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 4) تحديث الطلب
    await client.query(
      `UPDATE purchase_orders
       SET status = 'confirmed', journal_entry_id = $1
       WHERE id = $2`,
      [entry.id, orderId]
    );

    await client.query('COMMIT');
    return {
      id: orderId,
      status: 'confirmed',
      journal_entry_id: entry.id,
      total_inventory_cost: totalInventoryCost,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * إلغاء أمر شراء
 */
const cancel = async (companyId, orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Purchase order not found');
    if (!['draft', 'confirmed'].includes(order.status)) {
      throw new ApiError(400, 'Order cannot be cancelled');
    }

    // إذا مرحّل، نعكس: نخصم المخزون ونلغي القيد
    if (order.status === 'confirmed') {
      const movements = await client.query(
        `SELECT sm.batch_id, SUM(sm.quantity)::numeric AS total_qty
         FROM stock_movements sm
         WHERE sm.reference_type = 'purchase' AND sm.reference_id = $1
         GROUP BY sm.batch_id`,
        [orderId]
      );

      for (const mv of movements.rows) {
        // تحقق أن المخزون كافٍ للخصم (لم يُبع)
        const batch = await client.query(
          `SELECT quantity FROM product_batches WHERE id = $1 FOR UPDATE`,
          [mv.batch_id]
        );
        if (!batch.rowCount || Number(batch.rows[0].quantity) < Number(mv.total_qty)) {
          throw new ApiError(400, 'Cannot cancel: some inventory has been sold');
        }
        await client.query(
          `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`,
          [mv.total_qty, mv.batch_id]
        );
      }

      // قيد عكسي
      if (order.journal_entry_id) {
        const original = await JournalEntry.findById(companyId, order.journal_entry_id);
        if (original) {
          const reversedLines = original.lines.map((l) => ({
            account_id: l.account_id,
            debit: Number(l.credit),
            credit: Number(l.debit),
            description: `عكس: ${l.description || ''}`,
          }));
          const reverse = await JournalEntry.create(client, companyId, {
            entry_date: new Date().toISOString().slice(0, 10),
            description: `إلغاء أمر شراء ${order.order_number}`,
            source_type: 'adjustment',
            source_id: orderId,
            created_by: null,
            lines: reversedLines,
          });
          await JournalEntry.post(client, companyId, reverse.id, null);
        }
      }
    }

    await client.query(
      `UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`,
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
      quantity: qty,
      unit_price: price,
      tax_rate: taxRate,
      tax_amount: Math.round(taxAmount * 100) / 100,
      line_total: Math.round(lineTotal * 100) / 100,
      batch_number: item.batch_number || null,
      expiry_date: item.expiry_date || null,
    });
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax_total: Math.round(taxTotal * 100) / 100,
    total: Math.round((subtotal + taxTotal) * 100) / 100,
    enrichedItems,
  };
}

async function getDefaultAccounts(client, companyId) {
  const codes = {
    inventory: '1130',
    payable: '2110',
    vat_input: '2120',   // نستخدم نفس حساب الضريبة (يقبل رصيد مدين أو دائن)
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

// // في salesOrderService.cancel و purchaseOrderService.cancel
// if (order.journal_entry_id) {
//   const original = await JournalEntry.findById(companyId, order.journal_entry_id);
//   if (original) {
//     const reversedLines = original.lines.map((l) => ({
//       account_id: l.account_id,
//       debit: Number(l.credit),
//       credit: Number(l.debit),
//       description: `عكس: ${l.description || ''}`,
//     }));
//     const reverse = await JournalEntry.create(client, companyId, {
//       entry_date: new Date().toISOString().slice(0, 10),
//       description: `إلغاء طلب ${order.order_number}`,
//       source_type: 'adjustment',
//       source_id: orderId,
//       created_by: null,
//       lines: reversedLines,
//     });
//     await JournalEntry.post(client, companyId, reverse.id, null);
//   }
//   // لا تحذف الأصلي — أبقِه للأثر المحاسبي
// }