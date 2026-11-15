// services/salesOrderService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const JournalEntry = require('../models/JournalEntry');
const NumberingService = require('./numberingService');
const currencyUtil = require('../utils/currency');
const { resolveBaseQuantity } = require('./helpers/units');
const { assertMinSellingPrice } = require('./helpers/pricing');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ⚠️ ثابت موحّد — يطابق reservationService.consumeForOrder
const STOCK_REF_SALES = 'sales';

/* ============================================================
 * إنشاء طلب بيع (draft)
 * ============================================================ */
// services/salesOrderService.js — create (محدّث)

const create = async (companyId, userId, payload) => {
  // 1) سعر الصرف
  let exchangeRate = Number(payload.exchange_rate || 0);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    const ex = await currencyUtil.toBase(
      companyId, 1, payload.currency_id, payload.order_date
    );
    exchangeRate = Number(ex.rate);
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new ApiError(400, 'Exchange rate must be > 0');
  }

  // ✅ 1.5) التحقق من نوع الدفع
  const paymentType = payload.payment_type || 'cash';
  if (!['cash', 'credit', 'partial'].includes(paymentType)) {
    throw new ApiError(400, 'payment_type must be cash, credit, or partial');
  }

  const paymentMethod = payload.payment_method || null;
  if (paymentMethod && !['cash', 'bank', 'cheque'].includes(paymentMethod)) {
    throw new ApiError(400, 'payment_method must be cash, bank, or cheque');
  }

  const paymentTermsDays = Number(payload.payment_terms_days || 0);
  if (!Number.isFinite(paymentTermsDays) || paymentTermsDays < 0) {
    throw new ApiError(400, 'payment_terms_days must be >= 0');
  }

  // ✅ 1.6) الخصم على الفاتورة
  const invoiceDiscountRate = Number(payload.discount_rate || 0);
  if (!Number.isFinite(invoiceDiscountRate) || invoiceDiscountRate < 0 || invoiceDiscountRate > 100) {
    throw new ApiError(400, 'discount_rate must be between 0 and 100');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2) رقم الأمر
    const number = await NumberingService.next(client, companyId, 'sales_order', {
      prefix: 'SO', pad: 5,
    });

    // 3) العميل
    const cust = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [payload.customer_id, companyId]
    );
    if (!cust.rowCount) throw new ApiError(400, 'Customer not found or inactive');

    // 4) العملة
    const cur = await client.query(
      `SELECT id FROM currencies WHERE id = $1`,
      [payload.currency_id]
    );
    if (!cur.rowCount) throw new ApiError(400, 'Currency not found');

    // 5) المستودع (اختياري)
    let orderWarehouseId = payload.warehouse_id || null;
    if (orderWarehouseId) {
      const wh = await client.query(
        `SELECT id FROM warehouses
         WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
        [orderWarehouseId, companyId]
      );
      if (!wh.rowCount) {
        throw new ApiError(400, 'Warehouse not found or inactive');
      }
    }

    // 6) حساب المجاميع + الوحدات + الخصم على الفاتورة
    const totals = await calculateTotals(
      client,
      companyId,
      payload.items,
      invoiceDiscountRate  // ✅ تمرير الخصم
    );

    // ✅ 6.5) التحقق من المبلغ المدفوع
    let paidAmount = Number(payload.paid_amount || 0);

    if (paymentType === 'cash') {
      paidAmount = totals.total;  // ✅ نقدي = كامل
    } else if (paymentType === 'credit') {
      paidAmount = 0;  // ✅ آجل = 0
    } else {
      // partial
      if (paidAmount <= 0 || paidAmount >= totals.total) {
        throw new ApiError(
          400,
          'paid_amount must be > 0 and < total for partial payment'
        );
      }
    }

    // 7) إدراج الأمر — مع الحقول الجديدة
    const orderRes = await client.query(
      `INSERT INTO sales_orders
         (company_id, order_number, customer_id, order_date, currency_id, exchange_rate,
          subtotal, tax_total, total, status, created_by, warehouse_id,
          payment_type, payment_method, payment_terms_days, paid_amount, discount_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11,
               $12, $13, $14, $15, $16)
       RETURNING id, order_number, status, subtotal, tax_total, total, warehouse_id,
                 payment_type, payment_method, payment_terms_days, paid_amount, discount_rate`,
      [
        companyId, number, payload.customer_id,
        payload.order_date || new Date().toISOString().slice(0, 10),
        payload.currency_id, exchangeRate,
        totals.subtotal, totals.tax_total, totals.total, userId,
        orderWarehouseId,
        paymentType, paymentMethod, paymentTermsDays, paidAmount, invoiceDiscountRate,
      ]
    );
    const order = orderRes.rows[0];

    // 8) إدراج البنود
    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO sales_order_items
           (order_id, product_id, batch_id, quantity, unit_price, tax_rate, tax_amount, line_total,
            paid_quantity, bonus_quantity, discount_rate, discount_amount, net_unit_price,
            unit_id, conversion_factor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          order.id, item.product_id, item.batch_id || null, item.quantity,
          item.unit_price, item.tax_rate, item.tax_amount, item.line_total,
          item.paid_quantity, item.bonus_quantity, item.discount_rate,
          item.discount_amount, item.net_unit_price,
          item.unit_id || null, item.conversion_factor || 1,
        ]
      );
    }

    await client.query('COMMIT');
    return {
      ...order,
      items: totals.enrichedItems,
      warehouse_id: orderWarehouseId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
/* ============================================================
 * تأكيد طلب بيع
 * - تحقق من الحسابات أولاً (fail fast)
 * - إعادة تحقق من الحد الأدنى لسعر البيع
 * - استهلاك المخزون بالوحدة الأساسية (FIFO داخل المستودع إن حُدِّد)
 * - قيد محاسبي متوازن
 * ============================================================ */
const confirm = async (companyId, userId, orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) قفل الأمر
    const orderRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'draft') {
      throw new ApiError(400, 'Only draft orders can be confirmed');
    }

    // 2) الحسابات أولاً (fail fast)
    const accounts = await getDefaultAccounts(client, companyId);

    // 3) البنود
    const itemsRes = await client.query(
      `SELECT soi.*, p.name AS product_name
       FROM sales_order_items soi
       JOIN products p ON p.id = soi.product_id
       WHERE soi.order_id = $1`,
      [orderId]
    );
    if (!itemsRes.rowCount) throw new ApiError(400, 'Order has no items');

    // 4) سعر الصرف
    const exchange = await currencyUtil.toBase(
      companyId, 1, order.currency_id, order.order_date
    );
    const rate = Number(order.exchange_rate) > 0
      ? Number(order.exchange_rate)
      : Number(exchange.rate);

    const totalBase    = round2(Number(order.total) * rate);
    const subtotalBase = round2(Number(order.subtotal) * rate);
    const taxBase      = round2(Number(order.tax_total) * rate);

    // 5) إعادة تحقق من الحد الأدنى لسعر البيع
    for (const item of itemsRes.rows) {
      if (item.unit_id && Number(item.net_unit_price) > 0) {
        await assertMinSellingPrice(client, {
          productId: item.product_id,
          unitId: item.unit_id,
          sellingPrice: Number(item.net_unit_price),
        });
      }
    }

    // 6) warehouse_id من الطلب
    const orderWarehouseId = order.warehouse_id || null;

    // 7) استهلاك المخزون
    let totalCogs = 0;
    for (const item of itemsRes.rows) {
      const baseQty = Number(item.quantity) * Number(item.conversion_factor || 1);
      if (baseQty <= 0) {
        throw new ApiError(400, `Invalid quantity for item ${item.id}`);
      }

      const consumed = await consumeStock(
        client,
        companyId,
        item.product_id,
        baseQty,
        item.batch_id || null,
        orderWarehouseId
      );
      totalCogs += consumed.cogs;

      // سجل حركة المخزون — reference_type = 'sale'
      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         SELECT $1, b.warehouse_id, b.id, 'out', $2, b.cost_price,
                $3, $4, $5, $6
         FROM product_batches b WHERE b.id = $7`,
        [
          companyId,
          baseQty,
          STOCK_REF_SALES,
          orderId,
          order.order_date,
          userId,
          consumed.batchId,
        ]
      );
    }

    // 8) بناء القيد
    const lines = [
      {
        account_id: accounts.receivable,
        debit: totalBase, credit: 0,
        description: `طلب بيع ${order.order_number}`,
      },
      {
        account_id: accounts.revenue,
        credit: subtotalBase, debit: 0,
        description: 'إيراد مبيعات',
      },
    ];
    if (taxBase > 0) {
      lines.push({
        account_id: accounts.vat,
        credit: taxBase, debit: 0,
        description: 'ضريبة القيمة المضافة',
      });
    }

    if (totalCogs > 0) {
      lines.push(
        {
          account_id: accounts.cogs,
          debit: round2(totalCogs), credit: 0,
          description: 'تكلفة المبيعات',
        },
        {
          account_id: accounts.inventory,
          credit: round2(totalCogs), debit: 0,
          description: 'خصم مخزون',
        }
      );
    } else {
      console.warn(
        `[salesOrder.confirm] totalCogs = 0 for order ${order.order_number} — ` +
        `no COGS entry created.`
      );
    }

    // 9) إنشاء القيد وترحيله
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: order.order_date,
      description: `قيد طلب بيع ${order.order_number}`,
      source_type: 'sales',
      source_id: orderId,
      created_by: userId,
      lines,
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 10) تحديث الأمر
    await client.query(
      `UPDATE sales_orders SET status = 'confirmed', journal_entry_id = $1 WHERE id = $2`,
      [entry.id, orderId]
    );

    await client.query('COMMIT');
    return {
      id: orderId,
      status: 'confirmed',
      journal_entry_id: entry.id,
      total_cogs: round2(totalCogs),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * إلغاء طلب بيع
 * - draft: حذف مباشر
 * - confirmed: قيد عكسي + إرجاع المخزون
 * ============================================================ */
const cancel = async (companyId, userId, orderId) => {
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
      // 1) إرجاع المخزون
      const movements = await client.query(
        `SELECT sm.batch_id, SUM(sm.quantity)::numeric AS total_qty
         FROM stock_movements sm
         WHERE sm.reference_type = $1 AND sm.reference_id = $2
         GROUP BY sm.batch_id`,
        [STOCK_REF_SALES, orderId]
      );

      for (const mv of movements.rows) {
        if (!mv.batch_id) continue;

        const upd = await client.query(
          `UPDATE product_batches
           SET quantity = quantity + $1
           WHERE id = $2
           RETURNING id`,
          [mv.total_qty, mv.batch_id]
        );
        if (!upd.rowCount) {
          throw new ApiError(
            500,
            `Batch ${mv.batch_id} not found during order cancel — data inconsistency`
          );
        }
      }

      // 2) سجل حركات عكسية
      for (const mv of movements.rows) {
        if (!mv.batch_id) continue;

        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           SELECT $1, b.warehouse_id, b.id, 'in', $2, b.cost_price,
                  'adjustment', $3, CURRENT_DATE, $4
           FROM product_batches b WHERE b.id = $5`,
          [companyId, mv.total_qty, orderId, userId, mv.batch_id]
        );
      }

      // 3) قيد عكسي
      if (order.journal_entry_id) {
        const original = await JournalEntry.findById(companyId, order.journal_entry_id);
        if (original && original.lines) {
          const reversedLines = original.lines.map((l) => ({
            account_id: l.account_id,
            debit: Number(l.credit),
            credit: Number(l.debit),
            description: `إلغاء: ${l.description || ''}`,
          }));
          const reverse = await JournalEntry.create(client, companyId, {
            entry_date: new Date().toISOString().slice(0, 10),
            description: `إلغاء أمر بيع ${order.order_number}`,
            source_type: 'adjustment',
            source_id: orderId,
            created_by: userId,
            lines: reversedLines,
          });
          await JournalEntry.post(client, companyId, reverse.id, userId);
        }
      }
    }

    // 4) تحديث الحالة
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

/* ============================================================
 * حساب المجاميع + الوحدات
 *
 * المفاهيم:
 * - paid_quantity: الكمية المدفوعة بالوحدة المختارة
 * - bonus_quantity: الكمية المجانية (هدية) بالوحدة المختارة
 * - quantity: paid + bonus (بالوحدة المختارة)
 * - base_quantity: quantity × conversion_factor (للمخزون)
 * - net_unit_price: سعر الوحدة المختارة بعد الخصم (على paid فقط)
 * ============================================================ */
async function calculateTotals(client, companyId, items, invoiceDiscountRate = 0) {
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

    if (!Number.isFinite(paidQty) || paidQty <= 0) {
      throw new ApiError(400, 'Paid quantity must be > 0');
    }
    if (!Number.isFinite(bonusQty) || bonusQty < 0) {
      throw new ApiError(400, 'Bonus quantity must be >= 0');
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new ApiError(400, 'Price must be >= 0');
    }

    let conversionFactor = 1;
    if (item.unit_id) {
      const resolved = await resolveBaseQuantity(client, {
        productId: item.product_id,
        unitId: item.unit_id,
        quantity: 1,
      });
      conversionFactor = resolved.conversionFactor;
    }

    // ✅ لا خصم على البند — الخصم على الفاتورة
    const grossSubtotal = paidQty * price;
    const netSubtotal = grossSubtotal;  // ✅ بدون خصم على البند

    const netUnitPrice = paidQty > 0 ? round2(netSubtotal / paidQty) : 0;

    if (item.unit_id) {
      await assertMinSellingPrice(client, {
        productId: item.product_id,
        unitId: item.unit_id,
        sellingPrice: netUnitPrice,
      });
    }

    const taxRate = Number(item.tax_rate || 0);
    const taxAmount = netSubtotal * (taxRate / 100);
    const lineTotal = netSubtotal + taxAmount;

    subtotal += netSubtotal;
    taxTotal += taxAmount;

    enrichedItems.push({
      product_id: item.product_id,
      batch_id: item.batch_id || null,
      unit_id: item.unit_id || null,
      conversion_factor: conversionFactor,
      paid_quantity: paidQty,
      bonus_quantity: bonusQty,
      quantity: totalPhysicalQty,
      base_quantity: round2(totalPhysicalQty * conversionFactor),
      unit_price: price,
      discount_rate: 0,             // ✅ لا خصم على البند
      discount_amount: 0,           // ✅
      net_unit_price: netUnitPrice,
      tax_rate: taxRate,
      tax_amount: round2(taxAmount),
      line_total: round2(lineTotal),
    });
  }

  // ✅ تطبيق الخصم على الفاتورة
  const discountAmount = subtotal * (invoiceDiscountRate / 100);
  const netAfterDiscount = subtotal - discountAmount;

  return {
    subtotal: round2(subtotal),
    discount_amount: round2(discountAmount),     // 🆕
    net_after_discount: round2(netAfterDiscount), // 🆕
    tax_total: round2(taxTotal),
    total: round2(netAfterDiscount + taxTotal),   // ✅ الإجمالي بعد الخصم
    enrichedItems,
  };
}

/* ============================================================
 * استهلاك المخزون FIFO
 *
 * ✅ FIX: يستبعد الدفعات المنتهية (expiry_date > CURRENT_DATE)
 * ============================================================ */
async function consumeStock(
  client,
  companyId,
  productId,
  requiredQty,
  preferredBatchId = null,
  warehouseId = null
) {
  let remaining = Number(requiredQty);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new ApiError(400, 'Required quantity must be > 0');
  }

  let totalCogs = 0;
  let firstBatchId = null;

  let query;
  let params;

  if (preferredBatchId) {
    // 1) دفعة محددة (يتجاهل warehouseId)
    // ✅ نستبعد المنتهية
    query = `
      SELECT id, quantity, cost_price
      FROM product_batches
      WHERE id = $1 AND product_id = $2 AND company_id = $3
        AND quantity > 0
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      FOR UPDATE
    `;
    params = [preferredBatchId, productId, companyId];
  } else if (warehouseId) {
    // 2) مستودع محدد (FIFO داخل المستودع)
    // ✅ نستبعد المنتهية
    query = `
      SELECT id, quantity, cost_price
      FROM product_batches
      WHERE product_id = $1
        AND company_id = $2
        AND warehouse_id = $3
        AND quantity > 0
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      ORDER BY expiry_date ASC NULLS LAST, created_at ASC
      FOR UPDATE
    `;
    params = [productId, companyId, warehouseId];
  } else {
    // 3) أي مستودع (FIFO عام)
    // ✅ نستبعد المنتهية
    query = `
      SELECT id, quantity, cost_price
      FROM product_batches
      WHERE product_id = $1 AND company_id = $2
        AND quantity > 0
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      ORDER BY expiry_date ASC NULLS LAST, created_at ASC
      FOR UPDATE
    `;
    params = [productId, companyId];
  }

  const batches = await client.query(query, params);
  if (!batches.rowCount) {
    const scope = preferredBatchId
      ? `batch ${preferredBatchId}`
      : warehouseId
        ? `warehouse ${warehouseId}`
        : 'any warehouse';
    throw new ApiError(
      400,
      `No stock available for product ${productId} in ${scope} (all batches may be expired or reserved)`
    );
  }

  for (const batch of batches.rows) {
    if (remaining <= 0) break;

    const available = Number(batch.quantity);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;

    await client.query(
      `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`,
      [take, batch.id]
    );

    totalCogs += take * Number(batch.cost_price);
    remaining -= take;
    if (!firstBatchId) firstBatchId = batch.id;
  }

  if (remaining > 0.001) {
    const scope = preferredBatchId
      ? `batch ${preferredBatchId}`
      : warehouseId
        ? `warehouse ${warehouseId}`
        : 'any warehouse';
    throw new ApiError(
      400,
      `Insufficient stock for product ${productId} in ${scope} (missing ${round2(remaining)})`
    );
  }

  return { batchId: firstBatchId, cogs: round2(totalCogs) };
}

/* ============================================================
 * جلب الحسابات الافتراضية
 * ============================================================ */
async function getDefaultAccounts(client, companyId) {
  const codes = {
    receivable: '112',
    revenue: '411',
    vat: '213',
    cogs: '511',
    inventory: '113',
  };

  const r = await client.query(
    `SELECT code, id FROM chart_of_accounts
     WHERE company_id = $1 AND code = ANY($2::text[]) AND is_active = TRUE`,
    [companyId, Object.values(codes)]
  );

  const map = {};
  for (const row of r.rows) {
    const key = Object.keys(codes).find((k) => codes[k] === row.code);
    if (key) map[key] = row.id;
  }

  for (const [key, code] of Object.entries(codes)) {
    if (!map[key]) {
      throw new ApiError(500, `Required account ${code} (${key}) not found or inactive`);
    }
  }

  return map;
}

module.exports = { create, confirm, cancel };