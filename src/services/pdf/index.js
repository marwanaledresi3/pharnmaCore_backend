
const { generateVoucher } = require('./templates/voucher');
const { generateInvoice } = require('./templates/invoice');
const { generateStatement } = require('./templates/statement');
const { generateExpense } = require('./templates/expense');

const { generateReturn } = require('./templates/return');
const { generateTrialBalance } = require('./templates/trialBalance');
const { generateDeliveryNote } = require('./templates/deliveryNote');
const { generatePurchaseOrder } = require('./templates/purchaseOrder');
const {generateSalesOrder }    = require('./templates/generateSalesOrder');


const { generateCreditNote } = require('./templates/creditNote');
const { generateDebitNote } = require('./templates/debitNote');
const { generateGoodsReceipt } = require('./templates/goodsReceipt');
const { generateStockTransfer } = require('./templates/stockTransfer');
const { generateStockAdjustment } = require('./templates/stockAdjustment');

const { generateHrReport } = require('./templates/hrReport');
const { generatePayslip } = require('./templates/payslip');
const { generatePayrollReport } = require('./templates/payrollReport');

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

  creditNote: generateCreditNote,
  debitNote: generateDebitNote,
  goodsReceipt: generateGoodsReceipt,
  stockTransfer: generateStockTransfer,
  stockAdjustment: generateStockAdjustment,

  hrReport: generateHrReport,
  payslip: generatePayslip,
  payrollReport: generatePayrollReport,
};
