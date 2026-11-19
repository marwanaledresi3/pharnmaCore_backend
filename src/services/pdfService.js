// services/pdfService.js
const pdfTemplates = require('./pdf');

const PdfService = {
  generateInvoice: pdfTemplates.generateInvoice,
  generateVoucher: pdfTemplates.generateVoucher,
  generateStatement: pdfTemplates.generateStatement,
  generateExpense: pdfTemplates.generateExpense,
  generateReturn: pdfTemplates.generateReturn,
  generateTrialBalance: pdfTemplates.generateTrialBalance,
  generateDeliveryNote: pdfTemplates.generateDeliveryNote,
  generatePurchaseOrder: pdfTemplates.generatePurchaseOrder,
  generateSalesOrder: pdfTemplates.generateSalesOrder,

  // 🆕 HR
  generateHrReport: pdfTemplates.hrReport,
  generatePayslip: pdfTemplates.payslip,
  generatePayrollReport: pdfTemplates.payrollReport,

  generate: async (opts) => {
    switch (opts.docType) {
      case 'sale_invoice':
      case 'purchase_invoice': return pdfTemplates.generateInvoice(opts);
      case 'sale_return':
      case 'purchase_return': return pdfTemplates.generateReturn(opts);
      case 'receipt_voucher':
      case 'payment_voucher': return pdfTemplates.generateVoucher(opts);
      case 'statement': return pdfTemplates.generateStatement(opts);
      case 'delivery_note': return pdfTemplates.generateDeliveryNote(opts);
      case 'trial_balance': return pdfTemplates.generateTrialBalance(opts);
      case 'expense': return pdfTemplates.generateExpense(opts);
      case 'purchase_order': return pdfTemplates.generatePurchaseOrder(opts);
      case 'sales_order': return pdfTemplates.generateSalesOrder(opts);
      case 'credit_note': return pdfTemplates.creditNote(opts);
      case 'debit_note': return pdfTemplates.debitNote(opts);
      case 'stock_adjustment': return pdfTemplates.stockAdjustment(opts);
      case 'stock_transfer': return pdfTemplates.stockTransfer(opts);
      case 'goods_receipt': return pdfTemplates.goodsReceipt(opts);

      // 🆕 HR
      case 'hr_report': return pdfTemplates.hrReport(opts);
      case 'payslip': return pdfTemplates.payslip(opts);
      case 'payroll_report': return pdfTemplates.payrollReport(opts);

      default:
        throw new Error(`Unsupported docType: ${opts.docType}`);
    }
  },
};

module.exports = PdfService;