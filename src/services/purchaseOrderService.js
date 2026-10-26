const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const JournalEntry = require('../models/JournalEntry');
const PurchaseOrder = require('../models/PurchaseOrder');

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * إنشاء أمر شراء (draft) مع دعم الكميات المدفوعة والمجانية والخصومات والسعر الصافي
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

    // احسب المجاميع والعناصر المجهزة
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

    // أدخل السطور مع الحقول الجديدة
    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO purchase_order_items
           (order_id, product_id, quantity, unit_price, tax_rate, tax_amount, line_total,
            batch_number, expiry_date, paid_quantity, bonus_quantity, discount_rate, discount_amount, net_unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          order.id, item.product_id, item.quantity, item.unit_price,
          item.tax_rate, item.tax_amount, item.line_total,
          item.batch_number || null, item.expiry_date || null,
          item.paid_quantity, item.bonus_quantity,
          item.discount_rate, item.discount_amount, item.net_unit_price,
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
 * تأكيد أمر الشراء → استلام مخزون بالسعر الصافي + تحديث سعر البيع بناءً على profit_margin + إنشاء قيد
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

    let totalInventoryCost = 0;

    for (const item of itemsRes.rows) {
      const batchNumber = item.batch_number || `PO${order.order_number}-${item.id.slice(0, 8)}`;
      const expiry = item.expiry_date || '2099-12-31';
      const totalPhysicalQty = Number(item.quantity); // الإجمالي (مدفوع + مجاني)
      const unitCost = Number(item.net_unit_price) > 0 ? Number(item.net_unit_price) : Number(item.unit_price);

      const warehouseRes = await client.query(
        `SELECT id FROM warehouses WHERE company_id = $1 AND is_active = TRUE
         ORDER BY created_at ASC LIMIT 1`,
        [companyId]
      );
      if (!warehouseRes.rowCount) throw new ApiError(400, 'No active warehouse found');
      const warehouseId = warehouseRes.rows[0].id;

      // ابحث عن batch موجود
      const existingBatch = await client.query(
        `SELECT id, quantity FROM product_batches
         WHERE product_id = $1 AND warehouse_id = $2 AND batch_number = $3
         FOR UPDATE`,
        [item.product_id, warehouseId, batchNumber]
      );

      let batchId;
      if (existingBatch.rowCount) {
        await client.query(
          `UPDATE product_batches SET quantity = quantity + $1, cost_price = $2
           WHERE id = $3`,
          [totalPhysicalQty, unitCost, existingBatch.rows[0].id]
        );
        batchId = existingBatch.rows[0].id;
      } else {
        const newBatch = await client.query(
          `INSERT INTO product_batches
             (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [companyId, item.product_id, warehouseId, batchNumber, expiry, unitCost, totalPhysicalQty]
        );
        batchId = newBatch.rows[0].id;
      }

      // سجّل حركة المخزون بالكمية الكلية وتكلفة الوحدة الصافية
      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         VALUES ($1, $2, $3, 'in', $4, $5, 'purchase', $6, $7, $8)`,
        [companyId, warehouseId, batchId, totalPhysicalQty, unitCost,
         orderId, order.order_date, userId]
      );

      // تحديث سعر التكلفة وسعر البيع المقترح للمنتج بناءً على profit_margin
      const productRes = await client.query(
        `SELECT profit_margin FROM products WHERE id = $1 AND company_id = $2`,
        [item.product_id, companyId]
      );
      if (productRes.rowCount > 0) {
        const profitMargin = Number(productRes.rows[0].profit_margin) || 0;
        if (profitMargin > 0 && unitCost > 0) {
          const suggestedSellingPrice = round2(unitCost * (1 + profitMargin / 100));
          await client.query(
            `UPDATE products SET cost_price = $1, selling_price = $2 WHERE id = $3 AND company_id = $4`,
            [unitCost, suggestedSellingPrice, item.product_id, companyId]
          );
        } else {
          await client.query(
            `UPDATE products SET cost_price = $1 WHERE id = $2 AND company_id = $3`,
            [unitCost, item.product_id, companyId]
          );
        }
      }

      totalInventoryCost += round2(Number(item.line_total));
    }

    // جلب الحسابات وإنشاء القيد المحاسبي
    const accounts = await getDefaultAccounts(client, companyId);

    const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
    const totalBase    = round2(Number(order.total) * rate);
    const subtotalBase = round2(Number(order.subtotal) * rate);
    const taxBase      = round2(Number(order.tax_total) * rate);

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

    if (order.status === 'confirmed') {
      const movements = await client.query(
        `SELECT sm.batch_id, SUM(sm.quantity)::numeric AS total_qty
         FROM stock_movements sm
         WHERE sm.reference_type = 'purchase' AND sm.reference_id = $1
         GROUP BY sm.batch_id`,
        [orderId]
      );

      for (const mv of movements.rows) {
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

    const paidQty = Number(item.paid_quantity ?? item.quantity);
    const bonusQty = Number(item.bonus_quantity || 0);
    const totalQty = paidQty + bonusQty;
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
    // السعر الصافي للوحدة = صافي المبلغ / إجمالي الوحدات (المدفوعة + المجانية)
    const netUnitPrice = totalQty > 0 ? round2(netSubtotal / totalQty) : 0;

    const taxRate = Number(item.tax_rate || 0);
    const taxAmount = netSubtotal * (taxRate / 100);
    const lineTotal = netSubtotal + taxAmount;

    subtotal += netSubtotal;
    taxTotal += taxAmount;

    enrichedItems.push({
      product_id: item.product_id,
      paid_quantity: paidQty,
      bonus_quantity: bonusQty,
      quantity: totalQty, // إجمالي الكمية المخزنية
      unit_price: price,
      discount_rate: discountRate,
      discount_amount: round2(discountAmt),
      net_unit_price: netUnitPrice,
      tax_rate: taxRate,
      tax_amount: round2(taxAmount),
      line_total: round2(lineTotal),
      batch_number: item.batch_number || null,
      expiry_date: item.expiry_date || null,
    });
  }

  return {
    subtotal: round2(subtotal),
    tax_total: round2(taxTotal),
    total: round2(subtotal + taxTotal),
    enrichedItems,
  };
}

async function getDefaultAccounts(client, companyId) {
  const codes = {
    inventory: '1130',
    payable: '2110',
    vat_input: '2120',
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