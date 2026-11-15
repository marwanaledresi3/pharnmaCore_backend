// services/purchaseOrder/confirm.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const NotificationService = require('../notificationService');
const QRService = require('../qrService');
const ReservationService = require('../reservationService');
const { confirmInventory } = require('./helpers/stock');
const { createSalesInvoiceForSupplier, createPurchaseInvoiceForBuyer } = require('./helpers/invoices');
const { createBuyerJournalEntry, createSupplierJournalEntries } = require('./helpers/journal');
const { handlePayment } = require('./helpers/payment');
const { updateProductCost } = require('./helpers/products');
const { markQRUsed } = require('./helpers/qr');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function confirm(companyId, userId, orderId, opts = {}) {
  const client = await pool.connect();
  let result = null;
  let supplierCompanyId = null;
  let orderRef = null;
  let qrMarked = false;

  try {
    await client.query('BEGIN');

    const order = await loadOrderForConfirm(client, companyId, orderId);
    orderRef = order;
    supplierCompanyId = order.supplier_company_id;

    const totalNum = Number(order.total);
    if (!Number.isFinite(totalNum) || totalNum < 0) throw new ApiError(500, `Invalid order.total: ${order.total}`);

    const inventory = await confirmInventory(client, {
      order, buyerCompanyId: companyId, supplierCompanyId: order.supplier_company_id, userId,
    });

    if (order.supplier_company_id) {
      await ReservationService.consumeForOrder(client, { orderId: order.id, userId, orderDate: order.order_date });
    }

    await updateProductCostsAndPrices(client, { companyId, order, inventory, userId });

    const purchaseInvoice = await createPurchaseInvoiceForBuyer(client, { order, userId });

    const buyerEntryId = await createBuyerJournalEntry(client, { order, companyId, userId });

    await client.query(`UPDATE invoices SET journal_entry_id = $1 WHERE id = $2`, [buyerEntryId, purchaseInvoice.id]);

    let salesInvoice = null;
    let supplierEntries = null;

    if (order.supplier_company_id) {
      salesInvoice = await createSalesInvoiceForSupplier(client, { order, userId });
      supplierEntries = await createSupplierJournalEntries(client, { order, salesInvoice, inventory, userId });
    }

    const payment = await handlePayment(client, {
      order, companyId, userId,
      supplierCompanyId: order.supplier_company_id,
      salesInvoiceId: salesInvoice?.id || null,
      purchaseInvoiceId: purchaseInvoice.id,
    });

    if (opts.deliveryToken) {
      try {
        await markQRUsed(client, { token: opts.deliveryToken, userId, usedMode: opts.usedMode || 'authenticated' });
        qrMarked = true;
      } catch (qrErr) {
        console.error('[confirm] markQRUsed failed (non-fatal):', qrErr.message);
      }
    }

    const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
    const paidAmountOriginal = rate > 0 ? round2(payment.paid_amount / rate) : payment.paid_amount;

    await client.query(
      `UPDATE purchase_orders SET
         status = 'confirmed', journal_entry_id = $1, paid_amount = $2, paid_at = $3, updated_at = NOW()
       WHERE id = $4`,
      [buyerEntryId, paidAmountOriginal, payment.paid_at, order.id]
    );

    if (!opts.deliveryToken) {
      await QRService.revokeForOrder(client, order.id, { userId, reason: 'تم التأكيد عبر الزر العادي' });
    }

    await client.query('COMMIT');

    result = {
      id: order.id, status: 'confirmed', journal_entry_id: buyerEntryId,
      purchase_invoice_id: purchaseInvoice.id,
      purchase_invoice_number: purchaseInvoice.invoice_number,
      sales_invoice_id: salesInvoice?.id || null,
      sales_invoice_number: salesInvoice?.invoice_number || null,
      supplier_journal_entries: supplierEntries,
      total_inventory_cost: inventory.totalCost,
      payment: {
        type: payment.type,
        paid_amount: payment.paid_amount,
        paid_at: payment.paid_at,
        payment_id: payment.payment_id || null,
      },
      qr_marked: qrMarked,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (supplierCompanyId && orderRef) {
    try {
      const notifyClient = await pool.connect();
      try {
        await NotificationService.purchaseOrderConfirmed(notifyClient, { order: orderRef, supplierCompanyId, confirmedBy: userId });
      } finally {
        notifyClient.release();
      }
    } catch (e) {
      console.error('[confirm] notification failed:', e.message);
    }
  }

  return result;
}

async function updateProductCostsAndPrices(client, { companyId, order, inventory, userId }) {
  for (const b of inventory.buyerBatches) {
    const itemRes = await client.query(
      `SELECT id, net_unit_price, unit_price, conversion_factor, paid_quantity, bonus_quantity,
              quantity, line_total, tax_amount, unit_id, margin_rate, computed_selling_price,
              override_selling_price, min_selling_price
       FROM purchase_order_items WHERE order_id = $1 AND product_id = $2 LIMIT 1`,
      [order.id, b.product_id]
    );

    if (!itemRes.rowCount) throw new ApiError(500, `Purchase order item not found for product ${b.product_id}`);

    const item = itemRes.rows[0];
    const factor = Number(item.conversion_factor) || 1;
    if (factor <= 0) throw new ApiError(500, `Invalid conversion_factor for product ${b.product_id}`);

    let pricePerSelectedUnit = Number(item.net_unit_price);
    if (!Number.isFinite(pricePerSelectedUnit) || pricePerSelectedUnit <= 0) {
      const lineTotal = Number(item.line_total);
      const taxAmount = Number(item.tax_amount);
      const totalQty = Number(item.quantity);
      if (totalQty > 0) {
        pricePerSelectedUnit = round2((lineTotal - taxAmount) / totalQty);
      } else {
        pricePerSelectedUnit = Number(item.unit_price);
      }
    }

    if (!Number.isFinite(pricePerSelectedUnit) || pricePerSelectedUnit < 0) {
      throw new ApiError(500, `Invalid price for product ${b.product_id}`);
    }

    const unitCostBase = round2(pricePerSelectedUnit / factor);

    await updateProductCost(client, {
      companyId, productId: b.product_id, unitCost: unitCostBase, referenceId: order.id, userId,
    });

    const minSelling = Number(item.min_selling_price);
    if (Number.isFinite(minSelling) && minSelling > 0 && item.unit_id) {
      await client.query(
        `UPDATE product_units SET min_selling_price = $1 WHERE product_id = $2 AND unit_id = $3`,
        [round2(minSelling), b.product_id, item.unit_id]
      );
    }
  }
}

async function loadOrderForConfirm(client, companyId, orderId) {
  const r = await client.query(
    `SELECT po.*, s.name AS supplier_name
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = $1 AND po.company_id = $2
     FOR UPDATE`,
    [orderId, companyId]
  );
  const order = r.rows[0];
  if (!order) throw new ApiError(404, 'Purchase order not found');

  if (order.supplier_company_id) {
    if (order.status !== 'approved') throw new ApiError(400, 'Network purchase orders must be approved by the supplier first');
  } else {
    if (order.status !== 'draft') throw new ApiError(400, 'Only draft local purchase orders can be confirmed');
  }

  return order;
}

async function confirmByToken(companyId, userId, token, opts = {}) {
  const peekClient = await pool.connect();
  let payload;
  try {
    const verified = await QRService.verify(peekClient, token, { mode: 'authenticated', userCompanyId: companyId });
    payload = verified.payload;
  } finally {
    peekClient.release();
  }
  return await confirm(companyId, userId, payload.order_id, {
    deliveryToken: token,
    usedMode: opts.usedMode || 'authenticated',
  });
}

module.exports = { confirm, confirmByToken };