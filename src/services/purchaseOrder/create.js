// services/purchaseOrder/create.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const NumberingService = require('../numberingService');
const NotificationService = require('../notificationService');
const currencyUtil = require('../../utils/currency');
const { calculateTotals } = require('./helpers/totals');
const { validatePaymentType, computePaymentAmounts } = require('./helpers/payment');

const create = async (companyId, userId, payload) => {
  let client;
  let transactionStarted = false;

  try {
    if (!companyId || !userId) throw new ApiError(400, 'Company and user are required');
    if (!payload.supplier_id) throw new ApiError(400, 'Supplier is required');
    if (!payload.currency_id) throw new ApiError(400, 'Currency is required');
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ApiError(400, 'At least one item is required');
    }

    const invoiceDiscountRate = Number(payload.discount_rate ?? 0);
    if (!Number.isFinite(invoiceDiscountRate) || invoiceDiscountRate < 0 || invoiceDiscountRate > 100) {
      throw new ApiError(400, 'discount_rate must be between 0 and 100');
    }

    let exchangeRate = Number(payload.exchange_rate || 0);
    const orderDate = payload.order_date || new Date().toISOString().slice(0, 10);

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      const exchangeResult = await currencyUtil.toBase(companyId, 1, payload.currency_id, orderDate);
      exchangeRate = Number(exchangeResult.rate);
    }

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new ApiError(400, 'Exchange rate must be > 0');
    }

    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const orderNumber = await NumberingService.next(client, companyId, 'purchase_order', { prefix: 'PO', pad: 5 });

    const supplierResult = await client.query(
      `SELECT id, name, source_company_id, connected_company_id, is_active
       FROM suppliers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [payload.supplier_id, companyId]
    );
    if (!supplierResult.rowCount) throw new ApiError(400, 'Supplier not found');

    const supplier = supplierResult.rows[0];
    if (!supplier.is_active) throw new ApiError(400, 'Supplier is inactive');

    const supplierCompanyId = supplier.connected_company_id || supplier.source_company_id || null;
    const isNetwork = Boolean(supplierCompanyId);

    const currencyResult = await client.query(`SELECT id FROM currencies WHERE id = $1`, [payload.currency_id]);
    if (!currencyResult.rowCount) throw new ApiError(400, 'Currency not found');

    const payment = validatePaymentType(payload);

    const totals = await calculateTotals(client, {
      companyId, supplierCompanyId, isNetwork,
      items: payload.items, invoiceDiscountRate,
    });

    if (!Number.isFinite(Number(totals.total)) || Number(totals.total) < 0) {
      throw new ApiError(400, 'Invalid purchase order total');
    }

    const paymentComputed = computePaymentAmounts(payment, totals.total, orderDate);
    const initialStatus = isNetwork ? 'pending_approval' : 'draft';

    const orderResult = await client.query(
      `INSERT INTO purchase_orders (
         company_id, supplier_id, supplier_company_id, order_number, order_date,
         currency_id, exchange_rate, subtotal, discount_rate, discount_amount, tax_total, total,
         status, created_by, payment_type, payment_method, payment_terms_days, due_date,
         paid_amount, paid_at, supplier_invoice_number, supplier_invoice_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id, company_id, supplier_id, supplier_company_id, order_number, order_date,
                 currency_id, exchange_rate, subtotal, discount_rate, discount_amount, tax_total, total,
                 status, payment_type, payment_method, payment_terms_days, due_date,
                 paid_amount, paid_at, supplier_invoice_number, supplier_invoice_date`,
      [companyId, payload.supplier_id, supplierCompanyId, orderNumber, orderDate,
       payload.currency_id, exchangeRate, totals.subtotal, invoiceDiscountRate, totals.discount_amount,
       totals.tax_total, totals.total, initialStatus, userId,
       paymentComputed.payment_type, paymentComputed.payment_method, paymentComputed.payment_terms_days,
       paymentComputed.due_date, paymentComputed.paid_amount, paymentComputed.paid_at,
       payload.supplier_invoice_number || null, payload.supplier_invoice_date || null]
    );

    const order = orderResult.rows[0];

    for (const item of totals.enrichedItems) {
      await client.query(
        `INSERT INTO purchase_order_items (
           order_id, product_id, supplier_product_id, quantity, paid_quantity, bonus_quantity,
           unit_price, discount_rate, discount_amount, net_unit_price, tax_rate, tax_amount, line_total,
           invoice_discount_amount, batch_number, expiry_date, unit_id, conversion_factor,
           margin_rate, computed_selling_price, override_selling_price, min_selling_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [order.id, item.product_id, item.supplier_product_id || null, item.quantity,
         item.paid_quantity, item.bonus_quantity, item.unit_price,
         item.discount_rate || 0, item.discount_amount || 0, item.net_unit_price || item.unit_price,
         item.tax_rate || 0, item.tax_amount || 0, item.line_total, item.invoice_discount_amount || 0,
         item.batch_number || null, item.expiry_date || null, item.unit_id || null,
         item.conversion_factor || 1, item.margin_rate || 0, item.computed_selling_price || 0,
         item.override_selling_price ?? null, item.min_selling_price || 0]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;

    if (isNetwork) {
      try {
        const notifyClient = await pool.connect();
        try {
          await NotificationService.purchaseOrderIncoming(notifyClient, { order, supplierCompanyId });
        } finally {
          notifyClient.release();
        }
      } catch (notificationError) {
        console.error('[purchaseOrder:create] Notification failed:', notificationError);
      }
    }

    return { ...order, items: totals.enrichedItems };

  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[purchaseOrder:create] ROLLBACK failed:', rollbackError);
      }
    }
    console.error('[purchaseOrder:create] Error:', error);
    throw error;
  } finally {
    if (client) client.release();
  }
};

module.exports = { create };