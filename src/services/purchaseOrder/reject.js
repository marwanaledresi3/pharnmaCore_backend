// services/purchaseOrder/reject.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const QRService = require('../qrService');
const NotificationService = require('../notificationService');
const ReservationService = require('../reservationService');

/**
 * رفض أمر شراء شبكي (من المورد).
 *
 * التدفق:
 * 1) قفل الطلب + تحقق من الحالة (pending_approval)
 * 2) تحديث الحالة → rejected
 * 3) تحرير الحجوزات (إن وُجدت)
 * 4) إلغاء QR
 * 5) COMMIT
 * 6) إشعار (best effort — بعد COMMIT)
 *
 * ⚠️ الإشعار خارج transaction — لا يُلغي الرفض إذا فشل.
 */
async function reject(companyId, userId, orderId, reason) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new ApiError(400, 'Rejection reason is required');
  }

  const client = await pool.connect();
  let rejected = null;

  try {
    await client.query('BEGIN');

    // ═══ 1) قفل الطلب ═══
    const result = await client.query(
      `SELECT po.* FROM purchase_orders po
       WHERE po.id = $1 AND po.supplier_company_id = $2
       FOR UPDATE`,
      [orderId, companyId]
    );
    const order = result.rows[0];
    if (!order) throw new ApiError(404, 'Incoming purchase order not found');
    if (order.status !== 'pending_approval') {
      throw new ApiError(400, 'Only pending orders can be rejected');
    }

    // ═══ 2) تحديث الحالة ═══
    const updated = await client.query(
      `UPDATE purchase_orders SET
         status = 'rejected',
         rejected_by = $1,
         rejected_at = NOW(),
         rejection_reason = $2,
         updated_at = NOW()
       WHERE id = $3
       RETURNING id, order_number, status, rejected_by, rejected_at,
                 rejection_reason, company_id, supplier_company_id`,
      [userId, cleanReason, orderId]
    );
    rejected = updated.rows[0];

    // ═══ 3) تحرير الحجوزات ═══
    await ReservationService.releaseForOrder(client, {
      orderId,
      reason: `rejected: ${cleanReason}`,
    });

    // ═══ 4) إلغاء QR ═══
    await QRService.revokeForOrder(client, orderId, {
      userId,
      reason: 'رفض الطلب',
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ═══ 5) إشعار (best effort — بعد COMMIT) ═══
  try {
    const notifyClient = await pool.connect();
    try {
      await NotificationService.purchaseOrderRejected(notifyClient, {
        order: rejected,
        reason: cleanReason,
      });
    } finally {
      notifyClient.release();
    }
  } catch (e) {
    console.error('[reject] notification failed:', e.message);
  }

  return rejected;
}

module.exports = { reject };