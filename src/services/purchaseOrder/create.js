const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const NumberingService = require('../numberingService');
const NotificationService = require('../notificationService');
const { calculateTotals } = require('./helpers/totals');
const { validatePaymentType, computePaymentAmounts } = require('./helpers/payment');

/**
 * إنشاء أمر شراء.
 * - مورد شبكي: سعر من دفعاته، تحقق مخزون، pending_approval، إشعار.
 * - مورد محلي: كما هو، draft.
 */
async function create(companyId, userId, payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const number = await NumberingService.next(client, companyId, 'purchase_order', {
      prefix: 'PO',
      pad: 5,
    });

    // 1) المورد
    const sup = await client.query(
      `SELECT id, name, source_company_id, connected_company_id, is_active
       FROM suppliers WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [payload.supplier_id, companyId]
    );
    if (!sup.rowCount) throw new ApiError(400, 'Supplier not found');
    const supplier = sup.rows[0];
    if (!supplier.is_active) throw new ApiError(400, 'Supplier is inactive');

    const supplierCompanyId =
      supplier.source_company_id || supplier.connected_company_id || null;
    const isNetwork = Boolean(supplierCompanyId);

    // 2) العملة
    const cur = await client.query(`SELECT id FROM currencies WHERE id = $1`, [
      payload.currency_id,
    ]);
    if (!cur.rowCount) throw new ApiError(400, 'Currency not found');

    // 3) الدفع
    const payment = validatePaymentType(payload);

    // 4) المجاميع
    const totals = await calculateTotals(client, {
      companyId,
      supplierCompanyId,
      isNetwork,
      items: payload.items,
    });

    // 5) تاريخ + حالة
    const orderDate = payload.order_date || new Date().toISOString().slice(0, 10);
    const paymentComputed = computePaymentAmounts(payment, totals.total, orderDate);
    const initialStatus = isNetwork ? 'pending_approval' : 'draft';

    const exchangeRate =
      payload.exchange_rate != null ? Number(payload.exchange_rate) : 1;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new ApiError(400, 'Exchange rate must be > 0');
    }

    // ── 6) الإدراج ──
    const orderRes = await client.query(
      `INSERT INTO purchase_orders
        (company_id, supplier_id, supplier_company_id, order_number,
          order_date, currency_id, exchange_rate,
          subtotal, tax_total, total, status, created_by,
          payment_type, payment_method, payment_terms_days,
          due_date, paid_amount, paid_at,
          supplier_invoice_number, supplier_invoice_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING id, order_number, supplier_company_id, status,
                subtotal, tax_total, total, payment_type, payment_method,
                due_date, paid_amount, company_id, currency_id,
                supplier_invoice_number, supplier_invoice_date`,
      [
        companyId,
        payload.supplier_id,
        supplierCompanyId,
        number,
        orderDate,
        payload.currency_id,
        exchangeRate,
        totals.subtotal,
        totals.tax_total,
        totals.total,
        initialStatus,
        userId,
        paymentComputed.payment_type,
        paymentComputed.payment_method,
        paymentComputed.payment_terms_days,
        paymentComputed.due_date,
        paymentComputed.paid_amount,
        paymentComputed.paid_at,
        payload.supplier_invoice_number || null,   // ← جديد
        payload.supplier_invoice_date || null,     // ← جديد
      ]
    );
    const order = orderRes.rows[0];

    // 7) السطور
    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO purchase_order_items
           (order_id, product_id, supplier_product_id,
            quantity, unit_price, tax_rate, tax_amount, line_total,
            batch_number, expiry_date, paid_quantity, bonus_quantity,
            discount_rate, discount_amount, net_unit_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          order.id,
          item.product_id,
          item.supplier_product_id,
          item.quantity,
          item.unit_price,
          item.tax_rate,
          item.tax_amount,
          item.line_total,
          item.batch_number,
          item.expiry_date,
          item.paid_quantity,
          item.bonus_quantity,
          item.discount_rate,
          item.discount_amount,
          item.net_unit_price,
        ]
      );
    }

    // 8) إشعار المورد
    if (isNetwork) {
      await NotificationService.purchaseOrderIncoming(client, {
        order,
        supplierCompanyId,
      });
    }

    await client.query('COMMIT');
    return { ...order, items: totals.enrichedItems };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { create };