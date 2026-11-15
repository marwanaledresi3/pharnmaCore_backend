// services/return/confirm/postJournal.js
const ApiError = require('../../../errors/ApiError');
const JournalEntry = require('../../../models/JournalEntry');
const {
  assertBalanced,
  verifyJournalEntry,
} = require('../../journalHelper');

/**
 * ينشئ قيد المرتجع ويرحّله.
 *
 * التدفق:
 * 1) التحقق من التوازن (assertBalanced) — قبل الإنشاء
 * 2) إنشاء القيد (JournalEntry.create) — draft
 * 3) التحقق بعد الإنشاء (verifyJournalEntry) — defensive
 * 4) الترحيل (JournalEntry.post) — posted
 *
 * ⚠️ source_type:
 * - مرتجع بيع: 'sale_return'
 * - مرتجع شراء: 'purchase_return'
 * كلاهما ضمن VALID_SOURCE_TYPES.
 *
 * @param {object} client - pg client داخل transaction
 * @param {string} companyId
 * @param {string} userId
 * @param {object} ret - صف returns (id, return_number, return_type, return_date)
 * @param {Array} lines - سطور القيد [{account_id, debit, credit, description}]
 * @returns {Promise<{id, entry_number}>}
 */
async function postJournal(client, companyId, userId, ret, lines) {
  // ═══ 1) تحقق من المدخلات ═══
  if (!ret || !ret.id) {
    throw new ApiError(500, 'postJournal: return data is required');
  }
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new ApiError(500, 'postJournal: at least 2 lines are required');
  }

  // ═══ 2) تحديد source_type حسب نوع المرتجع ═══
  const sourceType =
    ret.return_type === 'sale' ? 'sale_return' : 'purchase_return';

  // ═══ 3) التحقق من التوازن قبل الإنشاء ═══
  assertBalanced(lines, `في قيد المرتجع ${ret.return_number || ret.id}`);

  // ═══ 4) إنشاء القيد (draft) ═══
  const description =
    ret.return_type === 'sale'
      ? `قيد مرتجع بيع ${ret.return_number}`
      : `قيد مرتجع شراء ${ret.return_number}`;

  const entry = await JournalEntry.create(client, companyId, {
    entry_date: ret.return_date,
    description,
    source_type: sourceType,
    source_id: ret.id,
    created_by: userId,
    lines,
  });

  if (!entry || !entry.id) {
    throw new ApiError(500, 'postJournal: failed to create journal entry');
  }

  // ═══ 5) verify بعد الإنشاء (defensive) ═══
  await verifyJournalEntry(
    client,
    entry.id,
    `في قيد المرتجع ${ret.return_number || ret.id}`
  );

  // ═══ 6) الترحيل ═══
  const posted = await JournalEntry.post(client, companyId, entry.id, userId);
  if (!posted) {
    throw new ApiError(
      500,
      `postJournal: failed to post journal entry ${entry.id}`
    );
  }

  // ═══ 7) إرجاع القيد المُرحّل ═══
  return {
    id: entry.id,
    entry_number: entry.entry_number,
    status: 'posted',
    posted_at: posted.posted_at,
  };
}

module.exports = { postJournal };