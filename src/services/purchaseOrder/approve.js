// services/purchaseOrder/approve.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const QRService = require('../qrService');
const NotificationService = require('../notificationService');
const ReservationService = require('../reservationService');
const { calculateTotals } = require('./helpers/totals');
const { checkSupplierStockAvailability } = require('./helpers/stock');

async function approve(companyId, userId, orderId, opts = {}) {
  const client = await pool.connect();
  let approved = null;
  let qrResult = null;

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT po.*, bc.name AS buyer_company_name, bc.email AS buyer_email
       FROM purchase_orders po
       JOIN companies bc ON bc.id = po.company_id
       WHERE po.id = $1 AND po.supplier_company_id = $2
       FOR UPDATE`,
      [orderId, companyId]
    );
    const order = result.rows[0];
    if (!order) throw new ApiError(404, 'Incoming purchase order not found');
    if (order.status !== 'pending_approval') throw new ApiError(400, 'Only pending orders can be approved');

    const invoiceDiscountRate = Number(order.discount_rate || 0);
    if (!Number.isFinite(invoiceDiscountRate) || invoiceDiscountRate < 0 || invoiceDiscountRate > 100) {
      throw new ApiError(500, 'Invalid order.discount_rate');
    }

    const adjustments = Array.isArray(opts.itemAdjustments) ? opts.itemAdjustments : [];
    if (adjustments.length > 0) {
      await applyItemAdjustments(client, { orderId, adjustments, userId });
    }

    const itemsFromDb = await client.query(
      `SELECT id, product_id, supplier_product_id, unit_id, paid_quantity, bonus_quantity, quantity,
              unit_price, discount_rate, tax_rate, batch_number, expiry_date,
              margin_rate, computed_selling_price, override_selling_price, min_selling_price
       FROM purchase_order_items WHERE order_id = $1 ORDER BY id`,
      [orderId]
    );

    if (itemsFromDb.rowCount === 0) throw new ApiError(400, 'Order has no items after adjustments');

    const itemsInput = itemsFromDb.rows.map((r) => ({
      product_id: r.product_id,
      supplier_product_id: r.supplier_product_id,
      unit_id: r.unit_id,
      paid_quantity: Number(r.paid_quantity),
      bonus_quantity: Number(r.bonus_quantity),
      unit_price: Number(r.unit_price),
      discount_rate: 0,
      tax_rate: Number(r.tax_rate),
      batch_number: r.batch_number,
      expiry_date: r.expiry_date,
      margin_rate: Number(r.margin_rate) || 0,
      computed_selling_price: Number(r.computed_selling_price) || 0,
      override_selling_price: r.override_selling_price != null ? Number(r.override_selling_price) : null,
      min_selling_price: Number(r.min_selling_price) || 0,
    }));

    const totals = await calculateTotals(client, {
      companyId: order.company_id,
      supplierCompanyId: order.supplier_company_id,
      isNetwork: Boolean(order.supplier_company_id),
      items: itemsInput,
      invoiceDiscountRate,
    });

    if (totals.enrichedItems.length !== itemsFromDb.rowCount) {
      throw new ApiError(500, 'Items count mismatch after recompute');
    }

    for (let i = 0; i < itemsFromDb.rowCount; i++) {
      const dbItem = itemsFromDb.rows[i];
      const calc = totals.enrichedItems[i];

      await client.query(
        `UPDATE purchase_order_items SET
           quantity = $1, unit_price = $2, discount_rate = $3, discount_amount = $4,
           net_unit_price = $5, tax_rate = $6, tax_amount = $7, line_total = $8,
           invoice_discount_amount = $9
         WHERE id = $10`,
        [calc.quantity, calc.unit_price, calc.discount_rate || 0, calc.discount_amount || 0,
         calc.net_unit_price, calc.tax_rate, calc.tax_amount, calc.line_total,
         calc.invoice_discount_amount || 0, dbItem.id]
      );
    }

    await client.query(
      `UPDATE purchase_orders SET
         subtotal = $1, discount_rate = $2, discount_amount = $3, tax_total = $4, total = $5
       WHERE id = $6`,
      [totals.subtotal, totals.discount_rate, totals.discount_amount, totals.tax_total, totals.total, orderId]
    );

    await checkSupplierStockAvailability(client, { orderId, supplierCompanyId: companyId });

    const updated = await client.query(
      `UPDATE purchase_orders SET
         status = 'approved', approved_by = $1, approved_at = NOW(),
         rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL, updated_at = NOW()
       WHERE id = $2
       RETURNING id, order_number, status, approved_by, approved_at,
                 subtotal, discount_rate, discount_amount, tax_total, total,
                 company_id, supplier_company_id, payment_type, payment_method, due_date, paid_amount`,
      [userId, orderId]
    );
    approved = updated.rows[0];

    await ReservationService.reserveForOrder(client, { orderId, supplierCompanyId: companyId, userId, ttlDays: 7 });

    await QRService.revokeForOrder(client, orderId, { userId, reason: 'QR جديد بعد الموافقة' });

    const qr = await QRService.generateForOrder(client, {
      order: {
        id: approved.id, order_number: approved.order_number,
        company_id: approved.company_id, supplier_company_id: approved.supplier_company_id,
        total: approved.total,
      },
      mode: opts.qrMode || 'both',
      ttlDays: Number(opts.qrTtlDays) > 0 ? Number(opts.qrTtlDays) : 7,
      createdBy: userId,
    });

    qrResult = { url: qr.url, qr_data_url: qr.qrDataUrl, pin: qr.pin, mode: qr.mode, expires_at: qr.expiresAt };

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  try {
    const notifyClient = await pool.connect();
    try {
      await NotificationService.purchaseOrderApproved(notifyClient, { order: approved });
    } finally {
      notifyClient.release();
    }
  } catch (e) {
    console.error('[approve] notification failed:', e.message);
  }

  return { ...approved, qr: qrResult };
}

async function applyItemAdjustments(client, { orderId, adjustments, userId }) {
  const itemsRes = await client.query(
    `SELECT poi.*, p.name AS product_name
     FROM purchase_order_items poi
     JOIN products p ON p.id = poi.product_id
     WHERE poi.order_id = $1
     FOR UPDATE OF poi`,
    [orderId]
  );
  const itemsById = new Map(itemsRes.rows.map((r) => [r.id, r]));

  for (const adj of adjustments) {
    if (!adj.item_id) throw new ApiError(400, 'itemAdjustments[].item_id is required');
    const item = itemsById.get(adj.item_id);
    if (!item) throw new ApiError(404, `Item ${adj.item_id} not found in this order`);

    const current = {
      paid_quantity: Number(item.paid_quantity),
      bonus_quantity: Number(item.bonus_quantity),
      unit_price: Number(item.unit_price),
      discount_rate: Number(item.discount_rate),
      tax_rate: Number(item.tax_rate),
      batch_number: item.batch_number,
      expiry_date: item.expiry_date,
    };
    const next = { ...current };
    const changed = [];

    if (adj.paid_quantity !== undefined) {
      const v = Number(adj.paid_quantity);
      if (!Number.isFinite(v) || v <= 0) throw new ApiError(400, 'paid_quantity must be > 0');
      next.paid_quantity = v;
      if (v !== current.paid_quantity) changed.push(['paid_quantity', current.paid_quantity, v]);
    }
    if (adj.bonus_quantity !== undefined) {
      const v = Number(adj.bonus_quantity);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'bonus_quantity must be >= 0');
      next.bonus_quantity = v;
      if (v !== current.bonus_quantity) changed.push(['bonus_quantity', current.bonus_quantity, v]);
    }
    if (adj.unit_price !== undefined) {
      const v = Number(adj.unit_price);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'unit_price must be >= 0');
      next.unit_price = v;
      if (v !== current.unit_price) changed.push(['unit_price', current.unit_price, v]);
    }
    if (adj.discount_rate !== undefined) {
      const v = Number(adj.discount_rate);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new ApiError(400, 'discount_rate must be between 0 and 100');
      next.discount_rate = v;
      if (v !== current.discount_rate) changed.push(['discount_rate', current.discount_rate, v]);
    }
    if (adj.tax_rate !== undefined) {
      const v = Number(adj.tax_rate);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new ApiError(400, 'tax_rate must be between 0 and 100');
      next.tax_rate = v;
      if (v !== current.tax_rate) changed.push(['tax_rate', current.tax_rate, v]);
    }
    if (adj.batch_number !== undefined) {
      const v = adj.batch_number ? String(adj.batch_number).trim() : null;
      next.batch_number = v;
      if ((v || null) !== (current.batch_number || null)) changed.push(['batch_number', current.batch_number, next.batch_number]);
    }
    if (adj.expiry_date !== undefined) {
      const v = adj.expiry_date || null;
      next.expiry_date = v;
      if ((v || null) !== (current.expiry_date || null)) changed.push(['expiry_date', current.expiry_date, next.expiry_date]);
    }

    await client.query(
      `UPDATE purchase_order_items SET
         paid_quantity = $1, bonus_quantity = $2, quantity = $3,
         unit_price = $4, discount_rate = $5, tax_rate = $6, batch_number = $7, expiry_date = $8
       WHERE id = $9`,
      [next.paid_quantity, next.bonus_quantity, next.paid_quantity + next.bonus_quantity,
       next.unit_price, next.discount_rate, next.tax_rate, next.batch_number, next.expiry_date, item.id]
    );

    for (const [field, oldV, newV] of changed) {
      await client.query(
        `INSERT INTO purchase_order_item_adjustments
           (item_id, order_id, adjusted_by, field_name, old_value, new_value, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.id, orderId, userId, field, oldV == null ? null : String(oldV), newV == null ? null : String(newV), adj.reason || null]
      );
    }
  }
}

module.exports = { approve };