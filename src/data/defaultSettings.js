//data/defaultSettings.js
/**
 * جميع الإعدادات الافتراضية للشركة الجديدة
 * مُنظَّمة حسب القسم (prefix)
 *
 * ⚠️ عند إضافة مفتاح جديد:
 * 1. أضفه هنا (للشركات الجديدة)
 * 2. أضف migration (للشركات الموجودة)
 * 3. أضفه إلى SETTINGS_SCHEMA في settingsService.js (للتحقق)
 */

module.exports = [
  // ═══════════════════════════════════════════════════
  // 1) عام (General)
  // ═══════════════════════════════════════════════════
  { key: 'timezone',                 value: 'Asia/Aden' },
  { key: 'date_format',              value: 'YYYY-MM-DD' },
  { key: 'fiscal_year_start',        value: '01-01' },

  // ═══════════════════════════════════════════════════
  // 2) الفواتير (Invoicing)
  // ═══════════════════════════════════════════════════
  { key: 'invoice_prefix',           value: 'INV-' },
  { key: 'invoice_next_number',      value: 1 },
  { key: 'invoice_show_logo',        value: true },
  { key: 'invoice_show_tax_number',  value: true },
  { key: 'invoice_show_barcode',     value: true },
  { key: 'invoice_show_signature',   value: true },
  { key: 'invoice_footer',           value: 'شكراً لتعاملكم معنا' },
  { key: 'invoice_terms',            value: 'البضاعة المباعة لا تُرد ولا تُستبدل بعد 7 أيام.' },
  { key: 'invoice_due_days',         value: 30 },
  { key: 'invoice_template',         value: 'standard' },   // standard | modern | minimal
  { key: 'invoice_currency_display', value: 'symbol' },     // symbol | code | both

  // ═══════════════════════════════════════════════════
  // 3) الترقيم (Numbering)
  // ═══════════════════════════════════════════════════
  { key: 'numbering_purchase_order_prefix', value: 'PO-' },
  { key: 'numbering_sales_order_prefix',    value: 'SO-' },
  { key: 'numbering_payment_receipt_prefix', value: 'REC-' },
  { key: 'numbering_payment_voucher_prefix', value: 'PAY-' },
  { key: 'numbering_expense_prefix',        value: 'EXP-' },
  { key: 'numbering_return_prefix',         value: 'RET-' },
  { key: 'numbering_journal_prefix',        value: 'JE-' },
  { key: 'numbering_padding',               value: 5 },       // 0001
  { key: 'numbering_reset_yearly',          value: false },

  // ═══════════════════════════════════════════════════
  // 4) المخزون (Inventory)
  // ═══════════════════════════════════════════════════
  { key: 'inventory_method',              value: 'fifo' },    // fifo | lifo | average
  { key: 'inventory_allow_negative',      value: false },
  { key: 'inventory_low_stock_threshold', value: 10 },
  { key: 'inventory_expiry_notify_days',  value: 30 },
  { key: 'inventory_expiry_warning_days', value: 90 },
  { key: 'inventory_require_batch_on_sale', value: true },
  { key: 'inventory_auto_reserve_on_approve', value: true },
  { key: 'inventory_show_expired_in_sale', value: false },

  // ═══════════════════════════════════════════════════
  // 5) الضرائب (Tax)
  // ═══════════════════════════════════════════════════
  { key: 'tax_default_rate',          value: 15 },
  { key: 'tax_inclusive_pricing',     value: false },
  { key: 'tax_calculation_method',    value: 'line' },        // line | invoice
  { key: 'tax_show_on_invoice',       value: true },

  // ═══════════════════════════════════════════════════
  // 6) الإشعارات (Notifications)
  // ═══════════════════════════════════════════════════
  { key: 'notify_new_order',          value: true },
  { key: 'notify_payment_received',   value: true },
  { key: 'notify_low_stock',          value: true },
  { key: 'notify_expiry',             value: true },
  { key: 'notify_daily_summary',      value: true },
  { key: 'notify_weekly_report',      value: false },
  { key: 'notify_channel_email',      value: false },
  { key: 'notify_channel_sms',        value: false },
  { key: 'notify_channel_whatsapp',   value: false },

  // ═══════════════════════════════════════════════════
  // 7) الطباعة والـ PDF (Printing)
  // ═══════════════════════════════════════════════════
  { key: 'pdf_paper_size',            value: 'A4' },          // A4 | A5 | Letter
  { key: 'pdf_orientation',           value: 'portrait' },    // portrait | landscape
  { key: 'pdf_font',                  value: 'Cairo' },
  { key: 'pdf_font_size',             value: 12 },
  { key: 'pdf_show_watermark',        value: false },
  { key: 'pdf_watermark_text',        value: 'مسودة' },
  { key: 'pdf_show_page_numbers',     value: true },
  { key: 'pdf_header_text',           value: '' },

  // ═══════════════════════════════════════════════════
  // 8) اللغة والتوطين (Localization)
  // ═══════════════════════════════════════════════════
  { key: 'locale_language',           value: 'ar' },          // ar | en
  { key: 'locale_number_format',      value: '1,234.56' },
  { key: 'locale_decimal_places',     value: 2 },
  { key: 'locale_currency_position',  value: 'suffix' },      // prefix | suffix
  { key: 'locale_week_start_day',     value: 'saturday' },    // saturday | sunday | monday
  { key: 'locale_calendar',           value: 'gregorian' },   // gregorian | hijri

  // ═══════════════════════════════════════════════════
  // 9) المدفوعات (Payments)
  // ═══════════════════════════════════════════════════
  { key: 'payment_allow_partial',     value: true },
  { key: 'payment_allow_overpayment', value: false },
  { key: 'payment_default_terms_days', value: 30 },
  { key: 'payment_auto_apply_credit', value: true },

  { key: 'payment_cash_account_id',   value: null },
  { key: 'payment_bank_account_id',   value: null },

  // ═══════════════════════════════════════════════════
  // 10) العملاء والموردون (Partners)
  // ═══════════════════════════════════════════════════
  { key: 'partners_customer_default_terms', value: 30 },
  { key: 'partners_supplier_default_terms', value: 30 },
  { key: 'partners_customer_credit_check',  value: true },
  { key: 'partners_require_tax_number',     value: false },

  // ═══════════════════════════════════════════════════
  // 11) الأمان (Security) — Owner فقط
  // ═══════════════════════════════════════════════════
  { key: 'security_password_min_length',      value: 8 },
  { key: 'security_password_require_upper',   value: true },
  { key: 'security_password_require_number',  value: true },
  { key: 'security_session_timeout_minutes',  value: 60 },
  { key: 'security_max_login_attempts',       value: 5 },
  { key: 'security_require_2fa',              value: false },

  // ═══════════════════════════════════════════════════
  // 12) المحاسبة المتقدمة (Accounting)
  // ═══════════════════════════════════════════════════
  { key: 'accounting_auto_post_journal',   value: true },
  { key: 'accounting_allow_manual_journal', value: true },
  { key: 'accounting_require_approval',    value: false },
  { key: 'accounting_rounding_method',     value: 'nearest' }, // nearest | up | down
  { key: 'accounting_cost_center_enabled', value: false },

  // ═══════════════════════════════════════════════════
  // 13) B2B والبوابات (B2B)
  // ═══════════════════════════════════════════════════
  { key: 'b2b_enabled',                value: true },
  { key: 'b2b_auto_approve_connections', value: false },
  { key: 'b2b_portal_show_prices',     value: true },
  { key: 'b2b_portal_show_invoices',   value: true },


    // ═══════════════════════════════════════════════════
  // 14) أذون التحويل (Stock Transfers)
  // ═══════════════════════════════════════════════════
  { key: 'numbering_stock_transfer_prefix', value: 'TRF-' },
  { key: 'stock_transfer_require_confirm',  value: true },
  { key: 'stock_transfer_auto_journal',     value: false },  // لا يُنشئ قيد محاسبي (لأن المخزون نفسه)

    // ═══════════════════════════════════════════════════
    // 15) تسويات الجرد (Stock Adjustments)
    // ═══════════════════════════════════════════════════
    { key: 'numbering_stock_adjustment_prefix', value: 'ADJ-' },
    { key: 'stock_adjustment_require_approval', value: true },   // تسوية تتطلب موافقة قبل التأكيد
    { key: 'stock_adjustment_auto_journal',     value: true },   // إنشاء قيد محاسبي تلقائياً
    { key: 'stock_adjustment_cogs_account_code', value: '511' }, // حساب تكلفة المبيعات
    { key: 'stock_adjustment_variance_account_code', value: '518' }, // حساب فروقات الجرد

    // ═══════════════════════════════════════════════════
    // 16) إشعارات مدين/دائن (Credit/Debit Notes)
    // ═══════════════════════════════════════════════════
    { key: 'numbering_credit_note_prefix', value: 'CN-' },
    { key: 'numbering_debit_note_prefix',  value: 'DN-' },
    { key: 'notes_require_approval',       value: true },
    { key: 'notes_auto_journal',           value: true },
    { key: 'notes_sales_return_account_code',    value: '411' },  // مرتجع مبيعات
    { key: 'notes_purchase_return_account_code', value: '511' },  // مرتجع مشتريات
    { key: 'notes_other_revenue_account_code',   value: '411' },  // إيرادات أخرى (لإشعار مدين)
    { key: 'notes_other_expense_account_code',   value: '518' },  // مصاريف أخرى (لإشعار مدين)

      // ═══════════════════════════════════════════════════
  // 17) مذكرات التسليم (Delivery Notes)
  // ═══════════════════════════════════════════════════
  { key: 'numbering_delivery_note_prefix', value: 'DN-' },
  { key: 'delivery_note_auto_deduct_stock', value: true },
  { key: 'delivery_note_require_signature', value: false },
  { key: 'delivery_note_auto_invoice', value: false },

    ...require('./defaultSettings-hr'),
];