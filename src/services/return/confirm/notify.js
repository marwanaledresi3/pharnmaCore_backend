// services/return/confirm/notify.js
const Notification = require('../../../models/Notification');

/**
 * إشعار بعد COMMIT — best effort.
 * ✅ يستخدم return_type === 'sale' (بدون s)
 */
async function notifyAfterCommit(companyId, returnId, ret) {
  try {
    const { pool } = require('../../../config/pool');
    const client = await pool.connect();
    try {
      const label = ret.return_type === 'sale' ? 'بيع' : 'شراء';
      await Notification.create(client, {
        companyId,
        type: 'general',
        title: `مرتجع ${label}`,
        message: `تم تأكيد المرتجع ${ret.return_number} بمبلغ ${ret.total}.`,
        metadata: {
          return_id: returnId,
          return_type: ret.return_type,
          total: Number(ret.total),
        },
        referenceType: 'return',
        referenceId: returnId,
        uniqueKey: `return_confirmed:${returnId}`,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[return:notify] failed (non-fatal):', err.message);
  }
}

module.exports = { notifyAfterCommit };