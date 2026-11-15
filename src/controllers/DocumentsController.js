const asyncHandler = require('../utils/asyncHandler');
const documentsService = require('../services/documentsService');

const list = asyncHandler(async (req, res) => {
  const data = await documentsService.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const stats = asyncHandler(async (req, res) => {
  const data = await documentsService.getStats(req.user.company_id, req.query);
  res.json({ success: true, data });
});

/**
 * GET /documents/types
 * قائمة الأنواع المتاحة (للفلاتر)
 */
const types = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      types: [
        // فواتير
        { value: 'invoice_sales',      label: 'فاتورة بيع',       category: 'invoices' },
        { value: 'invoice_purchase',   label: 'فاتورة شراء',      category: 'invoices' },
        // مدفوعات
        { value: 'payment_receive',    label: 'سند قبض',          category: 'payments' },
        { value: 'payment_pay',        label: 'سند صرف',          category: 'payments' },
        { value: 'payment_refund',     label: 'سند استرداد',      category: 'payments' },
        { value: 'payment_credit_apply', label: 'تخصيص رصيد',     category: 'payments' },
        // مصروفات
        { value: 'expense',            label: 'مصروف',             category: 'expenses' },
        // مرتجعات
        { value: 'return_sale',        label: 'مرتجع بيع',        category: 'returns' },
        { value: 'return_purchase',    label: 'مرتجع شراء',       category: 'returns' },
        // إشعارات
        { value: 'note_credit',        label: 'إشعار دائن',       category: 'notes' },
        { value: 'note_debit',         label: 'إشعار مدين',        category: 'notes' },
        // مذكرات التسليم
        { value: 'delivery_note',      label: 'مذكرة تسليم',      category: 'delivery' },
        // مخزنية
        { value: 'stock_transfer',     label: 'إذن تحويل',        category: 'inventory' },
        { value: 'stock_adjustment',   label: 'تسوية جرد',         category: 'inventory' },
        // قيود
        { value: 'journal_entry',      label: 'قيد يومية',        category: 'accounting' },
      ],
      categories: [
        { value: 'invoices',   label: 'الفواتير' },
        { value: 'payments',   label: 'المدفوعات' },
        { value: 'expenses',   label: 'المصروفات' },
        { value: 'returns',    label: 'المرتجعات' },
        { value: 'notes',      label: 'الإشعارات' },
        { value: 'delivery',   label: 'مذكرات التسليم' },
        { value: 'inventory',  label: 'المخزون' },
        { value: 'accounting', label: 'المحاسبة' },
      ],
      statuses: ['draft', 'posted', 'confirmed', 'dispatched', 'delivered', 'invoiced', 'unpaid', 'partial', 'paid', 'cancelled'],
    },
  });
});

module.exports = { list, stats, types };