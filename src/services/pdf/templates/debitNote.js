// services/pdf/templates/debitNote.js
const { generateCreditNote } = require('./creditNote');

/**
 * إشعار مدين — يعيد استخدام creditNote مع تعديل note_type
 */
const generateDebitNote = async (opts = {}) => {
  return generateCreditNote({
    ...opts,
    note: {
      ...opts.note,
      note_type: 'debit',
    },
  });
};

module.exports = { generateDebitNote };