const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const QRService = require('../qrService');
const NotificationService = require('../notificationService');
const ReservationService = require('../reservationService');

async function cancel(companyId, userId, orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) جلب الطلب + قفل
    const r = await client.query(
      `SELECT * FROM purchase_orders
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [orderId, companyId]
    );
    const order = r.rows[0];
    if (!order) throw new ApiError(404, 'Purchase order not found');

    // 2) الحالات المسموح إلغاؤها
    const cancellable =
      ['draft', 'pending_approval'].includes(order.status) ||
      (order.status === 'approved' && order.supplier_company_id);

    if (!cancellable) {
      throw new ApiError(
        400,
        `Order with status '${order.status}' cannot be cancelled`
      );
    }

    // 3) حرر الحجوزات
    if (order.supplier_company_id) {
      await ReservationService.releaseForOrder(client, {
        orderId,
        reason: 'order cancelled',
      });
    }

    // 4) حدّث الحالة
    await client.query(
      `UPDATE purchase_orders
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    // 5) إلغِ QR
    await QRService.revokeForOrder(client, orderId, {
      userId,
      reason: 'تم إلغاء الطلب',
    });

    // 6) إشعار (best effort)
    try {
      if (order.supplier_company_id) {
        await NotificationService.purchaseOrderCancelled(client, {
          order,
          targetCompanyId: order.supplier_company_id,
          cancelledBy: userId,
        });
      }
    } catch (err) {
      console.error('[cancel] notification failed:', err.message);
    }

    await client.query('COMMIT');
    return { id: orderId, status: 'cancelled' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { cancel };