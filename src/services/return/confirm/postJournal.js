const JournalEntry = require('../../../models/JournalEntry');

/**
 * ينشئ قيد المرتجع ويرحّله.
 */
async function postJournal(client, companyId, userId, ret, lines) {
  console.log('[confirm:4] postJournal START, lines =', lines.length);

  const entry = await JournalEntry.create(client, companyId, {
    entry_date: ret.return_date,
    description: `قيد مرتجع ${ret.return_type === 'sales' ? 'بيع' : 'شراء'} ${ret.return_number}`,
    source_type: ret.return_type === 'sales' ? 'sale_return' : 'purchase_return',
    source_id: ret.id,
    created_by: userId,
    lines,
  });

  console.log('[confirm:4] journal created, id =', entry.id);

  await JournalEntry.post(client, companyId, entry.id, userId);
  console.log('[confirm:4] journal posted');

  return entry;
}

module.exports = { postJournal };