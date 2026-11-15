// services/pdfService2.js
/**
 * خدمة PDF — المنسّق.
 * كل القوالب في services/pdf/templates/.
 */
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

  /**
   * توافق خلفي: توجيه حسب docType.
   */
  generate: async (opts) => {
    switch (opts.docType) {
      case 'sale_invoice':
      case 'purchase_invoice':
        return pdfTemplates.generateInvoice(opts);
      case 'sale_return':
      case 'purchase_return':
        return pdfTemplates.generateReturn(opts);
      case 'receipt_voucher':
      case 'payment_voucher':
        return pdfTemplates.generateVoucher(opts);
      case 'statement':
        return pdfTemplates.generateStatement(opts);
      case 'delivery_note':
        return pdfTemplates.generateDeliveryNote(opts);
      case 'trial_balance':
        return pdfTemplates.generateTrialBalance(opts);
      case 'expense':
        return pdfTemplates.generateExpense(opts);
      case 'purchase_order':
        return pdfTemplates.generatePurchaseOrder(opts);
      case 'sales_order':
        return pdfTemplates.generateSalesOrder(opts);
      default:
        throw new Error(`Unsupported docType: ${opts.docType}`);
    }
  },
};

module.exports = PdfService;