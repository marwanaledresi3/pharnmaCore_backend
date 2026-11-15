// services/return/confirm/finalize.js
const ApiError = require('../../../errors/ApiError');

/**
 * يحدّث حالة المرتجع ويربطه بالقيد.
 * ✅ مع company_id + status + RETURNING
 */
async function finalize(client, companyId, returnId, entryId) {
  // 1) تحديث الحالة إلى confirmed + ربط القيد (مع التحقق)
  const upd = await client.query(
    `UPDATE returns
     SET status = 'confirmed', journal_entry_id = $1
     WHERE id = $2 AND company_id = $3 AND status = 'draft'
     RETURNING id`,
    [entryId, returnId, companyId]
  );

  if (!upd.rowCount) {
    throw new ApiError(
      409,
      'فشل تأكيد المرتجع — قد يكون معدّلاً من عملية أخرى. أعد المحاولة.'
    );
  }
}

module.exports = { finalize };