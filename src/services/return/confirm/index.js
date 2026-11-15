// services/return/confirm/index.js
const { pool } = require('../../../config/pool');
const { lockReturn } = require('./lockReturn');
const { applyInventory } = require('./applyInventory');
const { buildJournalLines } = require('./buildJournalLines');
const { postJournal } = require('./postJournal');
const { finalize } = require('./finalize');
const { notifyAfterCommit } = require('./notify');
const {
  getSalesReturnAccounts,
  getPurchaseReturnAccounts,
} = require('../helpers/accounts');

const confirm = async (companyId, userId, returnId) => {
  const client = await pool.connect();
  let transactionStarted = false;
  let retData = null;
  let entry = null;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل المرتجع
    const { ret, items } = await lockReturn(client, companyId, returnId);
    retData = ret;

    // 2) تعديل المخزون
    const { totalCostChange } = await applyInventory(
      client, companyId, userId, ret, items
    );

    // 3) بناء القيد (حسب نوع المرتجع)
    const accounts = ret.return_type === 'sale'
      ? await getSalesReturnAccounts(client, companyId)
      : await getPurchaseReturnAccounts(client, companyId);

    const lines = buildJournalLines(ret, accounts, totalCostChange);

    // 4) ترحيل القيد
    entry = await postJournal(client, companyId, userId, ret, lines);

    // 5) تحديث المرتجع
    await finalize(client, companyId, returnId, entry.id);

    await client.query('COMMIT');
    transactionStarted = false;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[return.confirm] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }

  // 6) إشعار بعد COMMIT — best effort
  if (retData && entry) {
    try {
      await notifyAfterCommit(companyId, returnId, retData);
    } catch (err) {
      console.error('[return.confirm] notify failed (non-fatal):', err.message);
    }
  }

  return { id: returnId, status: 'confirmed', journal_entry_id: entry.id };
};

module.exports = { confirm };