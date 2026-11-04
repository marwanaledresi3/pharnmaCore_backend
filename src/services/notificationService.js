const ApiError = require('../errors/ApiError');
const WebSocketService = require('./websocketService');
/**
 * خدمة إشعارات موحّدة.
 * تعتمد على جدول notifications الموجود.
 */
class NotificationService {
  /**
   * ينشئ إشعاراً لشركة (واختيارياً لمستخدم محدد).
   *
   * @param {object} client
   * @param {object} params
   * @param {string} params.companyId - الشركة المستهدفة
   * @param {string} [params.userId] - مستخدم محدد (اختياري)
   * @param {string} params.type - نوع الإشعار (purchase_order_approved, ...)
   * @param {string} params.title
   * @param {string} [params.message]
   * @param {object} [params.metadata]
   * @param {string} [params.referenceType]
   * @param {string} [params.referenceId]
   * @param {string} [params.uniqueKey] - لمنع التكرار
   * @returns {Promise<{id}>}
   */
  static async create(client, params) {
    const {
      companyId,
      userId = null,
      type,
      title,
      message = null,
      metadata = null,
      referenceType = null,
      referenceId = null,
      uniqueKey = null,
    } = params;

    if (!companyId) throw new ApiError(400, 'companyId is required');
    if (!type) throw new ApiError(400, 'type is required');
    if (!title) throw new ApiError(400, 'title is required');

    const r = await client.query(
      `INSERT INTO notifications
         (company_id, user_id, type, title, message, metadata,
          reference_type, reference_id, unique_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, unique_key) WHERE unique_key IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         metadata = EXCLUDED.metadata
       RETURNING id`,
      [
        companyId,
        userId,
        type,
        title,
        message,
        metadata ? JSON.stringify(metadata) : null,
        referenceType,
        referenceId,
        uniqueKey,
      ]
    );
    const notification = r.rows[0];
     try {
    WebSocketService.emitToCompany(companyId, {
      type: 'notification',
      data: notification,
    });
  } catch (err) {
    console.error('[ws emit] failed:', err.message);
  }

    return { id: r.rows[0].id };
  }

  /**
   * إشعار "طلب شراء وارد" للمورد (عند create الشبكي).
   */
  static async purchaseOrderIncoming(client, { order, supplierCompanyId }) {
    return NotificationService.create(client, {
      companyId: supplierCompanyId,
      type: 'purchase_order_incoming',
      title: `طلب شراء وارد ${order.order_number}`,
      message: `وصل طلب شراء جديد بقيمة ${order.total}. يرجى المراجعة والموافقة.`,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        total: Number(order.total),
        currency_id: order.currency_id,
      },
      referenceType: 'purchase_order',
      referenceId: order.id,
      uniqueKey: `po_incoming:${order.id}`,
    });
  }

  /**
   * إشعار "تمت الموافقة" للمشتري (عند approve).
   */
  static async purchaseOrderApproved(client, { order }) {
    return NotificationService.create(client, {
      companyId: order.company_id,
      type: 'purchase_order_approved',
      title: `تمت الموافقة على أمر الشراء ${order.order_number}`,
      message: 'وافقت الشركة الموردة على طلبك. يمكنك الآن تأكيد الاستلام عند وصول البضاعة.',
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        approved_at: new Date().toISOString(),
      },
      referenceType: 'purchase_order',
      referenceId: order.id,
      uniqueKey: `po_approved:${order.id}`,
    });
  }

  /**
   * إشعار "تم الرفض" للمشتري (عند reject).
   */
  static async purchaseOrderRejected(client, { order, reason }) {
    return NotificationService.create(client, {
      companyId: order.company_id,
      type: 'purchase_order_rejected',
      title: `تم رفض أمر الشراء ${order.order_number}`,
      message: `رفضت الشركة الموردة طلبك. السبب: ${reason || 'غير محدد'}`,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        reason,
      },
      referenceType: 'purchase_order',
      referenceId: order.id,
      uniqueKey: `po_rejected:${order.id}`,
    });
  }

  /**
   * إشعار "تم الاستلام" للمورد (عند confirm).
   */
  static async purchaseOrderConfirmed(client, { order, supplierCompanyId }) {
    return NotificationService.create(client, {
      companyId: supplierCompanyId,
      type: 'purchase_order_confirmed',
      title: `تم استلام البضاعة لأمر الشراء ${order.order_number}`,
      message: `أكد المشتري استلام البضاعة. تم إنشاء فاتورة مبيعات لك.`,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        confirmed_at: new Date().toISOString(),
      },
      referenceType: 'purchase_order',
      referenceId: order.id,
      uniqueKey: `po_confirmed:${order.id}`,
    });
  }

  /**
   * إشعار "تم الإلغاء" (عند cancel).
   */
  static async purchaseOrderCancelled(client, { order, targetCompanyId, cancelledBy }) {
    return NotificationService.create(client, {
      companyId: targetCompanyId,
      type: 'purchase_order_cancelled',
      title: `تم إلغاء أمر الشراء ${order.order_number}`,
      message: `أُلغي أمر الشراء. إن كنت قد بدأت التحضير، يرجى إيقافه.`,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        cancelled_by: cancelledBy,
      },
      referenceType: 'purchase_order',
      referenceId: order.id,
      uniqueKey: `po_cancelled:${order.id}:${targetCompanyId}`,
    });
  }

  /**
   * يعلّم إشعاراً كمقروء.
   */
  static async markRead(client, notificationId, companyId) {
    await client.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE id = $1 AND company_id = $2`,
      [notificationId, companyId]
    );
  }

  /**
   * يعلّم كل إشعارات شركة كمقروءة.
   */
  static async markAllRead(client, companyId) {
    await client.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE company_id = $1 AND is_read = FALSE`,
      [companyId]
    );
  }
}

module.exports = NotificationService;