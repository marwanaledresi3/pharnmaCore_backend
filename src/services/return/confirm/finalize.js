const Return = require('../../../models/Return');

/**
 * يحدّث حالة المرتجع ويربطه بالقيد.
 */
async function finalize(client, companyId, returnId, entryId) {
  console.log('[confirm:5] finalize START');

  await Return.updateStatus(companyId, returnId, 'confirmed', client);
  console.log('[confirm:5] status = confirmed');

  await Return.linkJournalEntry(companyId, returnId, entryId, client);
  console.log('[confirm:5] journal linked');

  console.log('[confirm:5] finalize DONE');
}

module.exports = { finalize };