const Notification = require('../../../models/Notification');

/**
 * يرسل إشعاراً — fire-and-forget (لا يُفشل العملية).
 */
async function notify(client, companyId, returnId, ret) {
  try {
    console.log('[confirm:6] notify START');
    await Notification.create(client, {
      companyId,
      type: 'general',
      title: `مرتجع ${ret.return_type === 'sales' ? 'بيع' : 'شراء'}`,
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
    console.log('[confirm:6] notify OK');
  } catch (err) {
    console.error('[confirm:6] notify FAILED (non-fatal):', err.message);
  }
}

module.exports = { notify };