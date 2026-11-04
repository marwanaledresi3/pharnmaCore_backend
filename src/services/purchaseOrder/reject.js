const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const QRService = require('../qrService');
const NotificationService = require('../notificationService');
const ReservationService = require('../reservationService');

async function reject(companyId, userId, orderId, reason) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new ApiError(400, 'Rejection reason is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const updated = await client.query(
      `UPDATE purchase_orders
       SET status = 'rejected',
           rejected_by = $1, rejected_at = NOW(), rejection_reason = $2
       WHERE id = $3
       RETURNING id, order_number, status, rejected_by, rejected_at,
                 rejection_reason, company_id, supplier_company_id`,
      [userId, cleanReason, orderId]
    );
    const rejected = updated.rows[0];

    await QRService.revokeForOrder(client, orderId, {
      userId,
      reason: 'رفض الطلب',
    });

    await NotificationService.purchaseOrderRejected(client, {
      order: rejected,
      reason: cleanReason,
    });
    // في نهاية reject:
await ReservationService.releaseForOrder(client, {
  orderId,
  reason: `rejected: ${cleanReason}`,
});

    await client.query('COMMIT');
    return rejected;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { reject };