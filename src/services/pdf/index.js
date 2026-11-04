
const { generateVoucher } = require('./templates/voucher');
const { generateInvoice } = require('./templates/invoice');
const { generateStatement } = require('./templates/statement');
const { generateExpense } = require('./templates/expense');

const { generateReturn } = require('./templates/return');
const { generateTrialBalance } = require('./templates/trialBalance');
const { generateDeliveryNote } = require('./templates/deliveryNote');
const { generatePurchaseOrder } = require('./templates/purchaseOrder');
const {generateSalesOrder }    = require('./templates/generateSalesOrder')
module.exports = {
  generateVoucher,
  generateInvoice,
  generateStatement,
  generateExpense,

  generateReturn,
  generateTrialBalance,
  generateDeliveryNote,
  generatePurchaseOrder,
  generateSalesOrder,
};
