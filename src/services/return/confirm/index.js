const { pool } = require('../../../config/pool');
const { lockReturn } = require('./lockReturn');
const { applyInventory } = require('./applyInventory');
const { buildJournalLines } = require('./buildJournalLines');
const { postJournal } = require('./postJournal');
const { finalize } = require('./finalize');
const { notify } = require('./notify');
const { getDefaultAccounts } = require('../helpers/accounts');

/**
 * تأكيد المرتجع — كل خطوة لها log منفصل.
 * عند التعليق، آخر log يظهر = الخطوة التي توقفت.
 */
const confirm = async (companyId, userId, returnId) => {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;

  console.log(`\n════════ [confirm] START returnId=${returnId} ════════`);

  const client = await pool.connect();
  console.log(`[confirm:0] ${elapsed()} pool.connect OK`);

  try {
    await client.query('BEGIN');
    console.log(`[confirm:0] ${elapsed()} BEGIN OK`);

    // 1) قفل المرتجع
    const { ret, items } = await lockReturn(client, companyId, returnId);
    console.log(`[confirm:1] ${elapsed()} lockReturn OK`);

    // 2) تعديل المخزون
    const { totalCostChange } = await applyInventory(client, companyId, userId, ret, items);
    console.log(`[confirm:2] ${elapsed()} applyInventory OK`);

    // 3) بناء القيد
    const accounts = await getDefaultAccounts(client, companyId);
    console.log(`[confirm:3-pre] ${elapsed()} accounts loaded`);

    const lines = buildJournalLines(ret, accounts, totalCostChange);
    console.log(`[confirm:3] ${elapsed()} buildJournalLines OK (${lines.length} lines)`);

    // 4) ترحيل القيد
    const entry = await postJournal(client, companyId, userId, ret, lines);
    console.log(`[confirm:4] ${elapsed()} postJournal OK, entryId=${entry.id}`);

    // 5) تحديث المرتجع
    await finalize(client, companyId, returnId, entry.id);
    console.log(`[confirm:5] ${elapsed()} finalize OK`);

    // 6) إشعار (قبل COMMIT — best effort)
    await notify(client, companyId, returnId, ret);
    console.log(`[confirm:6] ${elapsed()} notify done`);

    // 7) COMMIT
    await client.query('COMMIT');
    console.log(`[confirm:7] ${elapsed()} COMMIT OK`);

    console.log(`════════ [confirm] DONE in ${elapsed()} ════════\n`);

    return { id: returnId, status: 'confirmed', journal_entry_id: entry.id };
  } catch (err) {
    console.error(`[confirm:ERROR] ${elapsed()} →`, err.message);
    console.error(err.stack);
    try {
      await client.query('ROLLBACK');
      console.log(`[confirm:ROLLBACK] ${elapsed()} OK`);
    } catch (rbErr) {
      console.error('[confirm:ROLLBACK] failed:', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
    console.log(`[confirm:RELEASE] ${elapsed()} client released`);
  }
};

module.exports = { confirm };