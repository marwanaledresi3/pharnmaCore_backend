const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const QRService = require('../qrService');
const NotificationService = require('../notificationService');
const { recomputeOrderTotals } = require('./helpers/totals');
const { checkSupplierStockAvailability } = require('./helpers/stock');
const ReservationService = require('../reservationService');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * موافقة المورد.
 * - تعديلات البنود (اختياري)
 * - إعادة حساب المجاميع
 * - تحقق مخزون
 * - QR
 * - إشعار
 */
async function approve(companyId, userId, orderId, opts = {}) {
  const client = await pool.connect();
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
    if (order.status !== 'pending_approval') {
      throw new ApiError(400, 'Only pending orders can be approved');
    }

    // 1) تعديلات البنود
    const adjustments = Array.isArray(opts.itemAdjustments) ? opts.itemAdjustments : [];
    if (adjustments.length > 0) {
      await applyItemAdjustments(client, {
        orderId,
        adjustments,
        userId,
      });
    }

    // 2) إعادة حساب المجاميع
    const totals = await recomputeOrderTotals(client, orderId);
    await client.query(
      `UPDATE purchase_orders SET subtotal = $1, tax_total = $2, total = $3
       WHERE id = $4`,
      [totals.subtotal, totals.tax_total, totals.total, orderId]
    );

    // 3) تحقق مخزون
    await checkSupplierStockAvailability(client, {
      orderId,
      supplierCompanyId: companyId,
    });

    // 4) تحديث الحالة
    const updated = await client.query(
      `UPDATE purchase_orders
       SET status = 'approved',
           approved_by = $1, approved_at = NOW(),
           rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
       WHERE id = $2
       RETURNING id, order_number, status, approved_by, approved_at,
                 subtotal, tax_total, total, company_id,
                 supplier_company_id, payment_type, payment_method,
                 due_date, paid_amount`,
      [userId, orderId]
    );
    const approved = updated.rows[0];

    try {
      await ReservationService.reserveForOrder(client, {
        orderId,
        supplierCompanyId: companyId,
        userId,
        ttlDays: 7,
      });
      console.log('[approve] stock reserved for order', orderId);
    } catch (err) {
      console.error('[approve] reservation failed:', err.message);
      throw err;   // ← نُفشل approve إذا تعذر الحجز
    }

    // 5) QR جديد
    await QRService.revokeForOrder(client, orderId, {
      userId,
      reason: 'QR جديد بعد الموافقة',
    });

    const qr = await QRService.generateForOrder(client, {
      order: {
        id: approved.id,
        order_number: approved.order_number,
        company_id: approved.company_id,
        supplier_company_id: approved.supplier_company_id,
        total: approved.total,
      },
      mode: opts.qrMode || 'both',
      ttlDays: Number(opts.qrTtlDays) > 0 ? Number(opts.qrTtlDays) : 7,
      createdBy: userId,
    });

    // 6) إشعار
    await NotificationService.purchaseOrderApproved(client, { order: approved });

    await client.query('COMMIT');

    return {
      ...approved,
      qr: {
        url: qr.url,
        qr_data_url: qr.qrDataUrl,
        pin: qr.pin,
        mode: qr.mode,
        expires_at: qr.expiresAt,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
      unit_price: Number(item.unit_price),
      bonus_quantity: Number(item.bonus_quantity),
      discount_rate: Number(item.discount_rate),
      tax_rate: Number(item.tax_rate),
      batch_number: item.batch_number,
      expiry_date: item.expiry_date,
      paid_quantity: Number(item.paid_quantity),
    };

    const next = { ...current };

    if (adj.unit_price !== undefined) {
      const v = Number(adj.unit_price);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'unit_price must be >= 0');
      next.unit_price = v;
    }
    if (adj.bonus_quantity !== undefined) {
      const v = Number(adj.bonus_quantity);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'bonus_quantity must be >= 0');
      next.bonus_quantity = v;
    }
    if (adj.discount_rate !== undefined) {
      const v = Number(adj.discount_rate);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        throw new ApiError(400, 'discount_rate must be between 0 and 100');
      }
      next.discount_rate = v;
    }
    if (adj.tax_rate !== undefined) {
      const v = Number(adj.tax_rate);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        throw new ApiError(400, 'tax_rate must be between 0 and 100');
      }
      next.tax_rate = v;
    }
    if (adj.batch_number !== undefined) {
      next.batch_number = adj.batch_number ? String(adj.batch_number).trim() : null;
    }
    if (adj.expiry_date !== undefined) {
      next.expiry_date = adj.expiry_date || null;
    }

    const totalQty = next.paid_quantity + next.bonus_quantity;
    const grossSubtotal = next.paid_quantity * next.unit_price;
    const discountAmount = Math.min(grossSubtotal, grossSubtotal * (next.discount_rate / 100));
    const netSubtotal = Math.max(0, grossSubtotal - discountAmount);
    const netUnitPrice = totalQty > 0 ? round2(netSubtotal / totalQty) : 0;
    const taxAmount = netSubtotal * (next.tax_rate / 100);
    const lineTotal = netSubtotal + taxAmount;

    await client.query(
      `UPDATE purchase_order_items
       SET quantity = $1, unit_price = $2, bonus_quantity = $3,
           discount_rate = $4, discount_amount = $5, net_unit_price = $6,
           tax_rate = $7, tax_amount = $8, line_total = $9,
           batch_number = $10, expiry_date = $11
       WHERE id = $12`,
      [
        round2(totalQty),
        round2(next.unit_price),
        round2(next.bonus_quantity),
        next.discount_rate,
        round2(discountAmount),
        netUnitPrice,
        next.tax_rate,
        round2(taxAmount),
        round2(lineTotal),
        next.batch_number,
        next.expiry_date,
        item.id,
      ]
    );

    const changed = [];
    if (next.unit_price !== current.unit_price)
      changed.push(['unit_price', current.unit_price, next.unit_price]);
    if (next.bonus_quantity !== current.bonus_quantity)
      changed.push(['bonus_quantity', current.bonus_quantity, next.bonus_quantity]);
    if (next.discount_rate !== current.discount_rate)
      changed.push(['discount_rate', current.discount_rate, next.discount_rate]);
    if (next.tax_rate !== current.tax_rate)
      changed.push(['tax_rate', current.tax_rate, next.tax_rate]);
    if ((next.batch_number || null) !== (current.batch_number || null))
      changed.push(['batch_number', current.batch_number, next.batch_number]);
    if ((next.expiry_date || null) !== (current.expiry_date || null))
      changed.push(['expiry_date', current.expiry_date, next.expiry_date]);

    for (const [field, oldV, newV] of changed) {
      await client.query(
        `INSERT INTO purchase_order_item_adjustments
           (item_id, order_id, adjusted_by, field_name, old_value, new_value, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          item.id,
          orderId,
          userId,
          field,
          oldV == null ? null : String(oldV),
          newV == null ? null : String(newV),
          adj.reason || null,
        ]
      );
    }
  }
}

module.exports = { approve };