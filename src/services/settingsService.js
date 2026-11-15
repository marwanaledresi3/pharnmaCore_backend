const { pool } = require('../config/pool');

/**
 * ═══════════════════════════════════════════════════════════
 * SETTINGS SCHEMA
 * ═══════════════════════════════════════════════════════════
 * تعريف نوع كل مفتاح + قواعد التحقق
 * ⚠️ أي مفتاح جديد يجب إضافته هنا
 */
const SETTINGS_SCHEMA = {
  // ── General ──
  timezone:                 { type: 'string', required: true },
  date_format:              { type: 'string', enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] },
  fiscal_year_start:        { type: 'string', pattern: /^\d{2}-\d{2}$/ },

  // ── Invoicing ──
  invoice_prefix:           { type: 'string', maxLength: 10 },
  invoice_next_number:      { type: 'number', min: 1 },
  invoice_show_logo:        { type: 'boolean' },
  invoice_show_tax_number:  { type: 'boolean' },
  invoice_show_barcode:     { type: 'boolean' },
  invoice_show_signature:   { type: 'boolean' },
  invoice_footer:           { type: 'string', maxLength: 500 },
  invoice_terms:            { type: 'string', maxLength: 2000 },
  invoice_due_days:         { type: 'number', min: 0, max: 365 },
  invoice_template:         { type: 'string', enum: ['standard', 'modern', 'minimal'] },
  invoice_currency_display: { type: 'string', enum: ['symbol', 'code', 'both'] },

  // ── Numbering ──
  numbering_purchase_order_prefix: { type: 'string', maxLength: 10 },
  numbering_sales_order_prefix:    { type: 'string', maxLength: 10 },
  numbering_payment_receipt_prefix: { type: 'string', maxLength: 10 },
  numbering_payment_voucher_prefix: { type: 'string', maxLength: 10 },
  numbering_expense_prefix:        { type: 'string', maxLength: 10 },
  numbering_return_prefix:         { type: 'string', maxLength: 10 },
  numbering_journal_prefix:        { type: 'string', maxLength: 10 },
  numbering_padding:               { type: 'number', min: 1, max: 10 },
  numbering_reset_yearly:          { type: 'boolean' },

  // ── Inventory ──
  inventory_method:              { type: 'string', enum: ['fifo', 'lifo', 'average'] },
  inventory_allow_negative:      { type: 'boolean' },
  inventory_low_stock_threshold: { type: 'number', min: 0 },
  inventory_expiry_notify_days:  { type: 'number', min: 0, max: 365 },
  inventory_expiry_warning_days: { type: 'number', min: 0, max: 365 },
  inventory_require_batch_on_sale:   { type: 'boolean' },
  inventory_auto_reserve_on_approve: { type: 'boolean' },
  inventory_show_expired_in_sale:    { type: 'boolean' },

  // ── Tax ──
  tax_default_rate:        { type: 'number', min: 0, max: 100 },
  tax_inclusive_pricing:   { type: 'boolean' },
  tax_calculation_method:  { type: 'string', enum: ['line', 'invoice'] },
  tax_show_on_invoice:     { type: 'boolean' },

  // ── Notifications ──
  notify_new_order:        { type: 'boolean' },
  notify_payment_received: { type: 'boolean' },
  notify_low_stock:        { type: 'boolean' },
  notify_expiry:           { type: 'boolean' },
  notify_daily_summary:    { type: 'boolean' },
  notify_weekly_report:    { type: 'boolean' },
  notify_channel_email:    { type: 'boolean' },
  notify_channel_sms:      { type: 'boolean' },
  notify_channel_whatsapp: { type: 'boolean' },

  // ── PDF ──
  pdf_paper_size:        { type: 'string', enum: ['A4', 'A5', 'Letter'] },
  pdf_orientation:       { type: 'string', enum: ['portrait', 'landscape'] },
  pdf_font:              { type: 'string', maxLength: 50 },
  pdf_font_size:         { type: 'number', min: 6, max: 24 },
  pdf_show_watermark:    { type: 'boolean' },
  pdf_watermark_text:    { type: 'string', maxLength: 100 },
  pdf_show_page_numbers: { type: 'boolean' },
  pdf_header_text:       { type: 'string', maxLength: 500 },

  // ── Locale ──
  locale_language:          { type: 'string', enum: ['ar', 'en'] },
  locale_number_format:     { type: 'string', maxLength: 30 },
  locale_decimal_places:    { type: 'number', min: 0, max: 6 },
  locale_currency_position: { type: 'string', enum: ['prefix', 'suffix'] },
  locale_week_start_day:    { type: 'string', enum: ['saturday', 'sunday', 'monday'] },
  locale_calendar:          { type: 'string', enum: ['gregorian', 'hijri'] },

  // ── Payments ──
  payment_allow_partial:      { type: 'boolean' },
  payment_allow_overpayment:  { type: 'boolean' },
  payment_default_terms_days: { type: 'number', min: 0, max: 365 },
  payment_auto_apply_credit:  { type: 'boolean' },

  // ✅ جديد: UUID أو null
  payment_cash_account_id: {
    type: 'uuid',
    nullable: true,
    description: 'UUID حساب الصندوق. null = استخدم 1111 الافتراضي.',
  },
  payment_bank_account_id: {
    type: 'uuid',
    nullable: true,
    description: 'UUID حساب البنك. null = استخدم 1112 الافتراضي.',
  },

  // ── Partners ──
  partners_customer_default_terms: { type: 'number', min: 0, max: 365 },
  partners_supplier_default_terms: { type: 'number', min: 0, max: 365 },
  partners_customer_credit_check:  { type: 'boolean' },
  partners_require_tax_number:     { type: 'boolean' },

  // ── Security ──
  security_password_min_length:     { type: 'number', min: 6, max: 128 },
  security_password_require_upper:  { type: 'boolean' },
  security_password_require_number: { type: 'boolean' },
  security_session_timeout_minutes: { type: 'number', min: 5, max: 10080 },
  security_max_login_attempts:      { type: 'number', min: 1, max: 100 },
  security_require_2fa:             { type: 'boolean' },

  // ── Accounting ──
  accounting_auto_post_journal:    { type: 'boolean' },
  accounting_allow_manual_journal: { type: 'boolean' },
  accounting_require_approval:     { type: 'boolean' },
  accounting_rounding_method:      { type: 'string', enum: ['nearest', 'up', 'down'] },
  accounting_cost_center_enabled:  { type: 'boolean' },

  // ── B2B ──
  b2b_enabled:                  { type: 'boolean' },
  b2b_auto_approve_connections: { type: 'boolean' },
  b2b_portal_show_prices:       { type: 'boolean' },
  b2b_portal_show_invoices:     { type: 'boolean' },
};

/**
 * تجميع المفاتيح حسب القسم
 */
const GROUP_BY_PREFIX = (key) => {
  const idx = key.indexOf('_');
  return idx > 0 ? key.substring(0, idx) : 'general';
};

/**
 * التحقق من قيمة إعداد واحد
 * @returns {{ valid: boolean, error?: string }}
 */
const validateSetting = (key, value) => {
  const rule = SETTINGS_SCHEMA[key];
  if (!rule) {
    return { valid: false, error: `Unknown setting key: ${key}` };
  }

  const t = rule.type;

  if (t === 'boolean') {
    if (typeof value !== 'boolean') {
      return { valid: false, error: `${key} must be boolean` };
    }
  } else if (t === 'number') {
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, error: `${key} must be a number` };
    }
    if (rule.min !== undefined && value < rule.min) {
      return { valid: false, error: `${key} must be >= ${rule.min}` };
    }
    if (rule.max !== undefined && value > rule.max) {
      return { valid: false, error: `${key} must be <= ${rule.max}` };
    }
  } else if (t === 'string') {
    if (typeof value !== 'string') {
      return { valid: false, error: `${key} must be a string` };
    }
    if (rule.maxLength && value.length > rule.maxLength) {
      return { valid: false, error: `${key} exceeds max length ${rule.maxLength}` };
    }
    if (rule.enum && !rule.enum.includes(value)) {
      return { valid: false, error: `${key} must be one of: ${rule.enum.join(', ')}` };
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      return { valid: false, error: `${key} has invalid format` };
    }
  }

  return { valid: true };
};

/**
 * جلب كل الإعدادات لشركة (مسطّحة)
 */
const getAll = async (companyId, client = pool) => {
  const { rows } = await client.query(
    `SELECT key, value FROM settings WHERE company_id = $1 ORDER BY key`,
    [companyId]
  );
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
};

/**
 * جلب إعداد واحد (مع قيمة افتراضية)
 */
const get = async (companyId, key, defaultValue = null, client = pool) => {
  const { rows } = await client.query(
    `SELECT value FROM settings WHERE company_id = $1 AND key = $2`,
    [companyId, key]
  );
  return rows[0] ? rows[0].value : defaultValue;
};

/**
 * جلب عدة إعدادات دفعة واحدة
 */
const getMany = async (companyId, keys, client = pool) => {
  const { rows } = await client.query(
    `SELECT key, value FROM settings WHERE company_id = $1 AND key = ANY($2::text[])`,
    [companyId, keys]
  );
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
};

/**
 * تحديث إعداد واحد أو عدة إعدادات (upsert)
 * @param {Object} updates - { key: value, ... }
 * @returns {Promise<{ updated: string[], errors: Array<{key, error}> }>}
 */
const updateMany = async (companyId, updates, client = pool) => {
  const updated = [];
  const errors = [];

  // 1) تحقق من كل القيم
  for (const [key, value] of Object.entries(updates)) {
    const check = validateSetting(key, value);
    if (!check.valid) {
      errors.push({ key, error: check.error });
    }
  }

  if (errors.length > 0) {
    return { updated: [], errors };
  }

  // 2) upsert
  for (const [key, value] of Object.entries(updates)) {
    await client.query(
      `INSERT INTO settings (company_id, key, value)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (company_id, key)
       DO UPDATE SET value = EXCLUDED.value`,
      [companyId, key, JSON.stringify(value)]
    );
    updated.push(key);
  }

  return { updated, errors: [] };
};

/**
 * حذف إعداد (نادراً ما يُستخدم — للإعدادات التي تعود للافتراضي)
 */
const remove = async (companyId, key, client = pool) => {
  const { rowCount } = await client.query(
    `DELETE FROM settings WHERE company_id = $1 AND key = $2`,
    [companyId, key]
  );
  return rowCount > 0;
};

/**
 * جلب الإعدادات مجمّعة حسب القسم
 * @returns {Promise<Object>} - { invoicing: {...}, inventory: {...}, ... }
 */
const getGrouped = async (companyId) => {
  const flat = await getAll(companyId);
  const grouped = {};

  for (const [key, value] of Object.entries(flat)) {
    const group = GROUP_BY_PREFIX(key);
    if (!grouped[group]) grouped[group] = {};
    // إزالة البادئة من اسم الحقل (invoicing → invoice_ يبقى كما هو)
    grouped[group][key] = value;
  }

  return grouped;
};

/**
 * تهيئة الإعدادات الافتراضية لشركة جديدة
 */
const initDefaults = async (client, companyId, overrides = {}) => {
  const defaults = require('../data/defaultSettings');

  for (const item of defaults) {
    const value = overrides[item.key] !== undefined
      ? overrides[item.key]
      : item.value;

    await client.query(
      `INSERT INTO settings (company_id, key, value)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (company_id, key) DO NOTHING`,
      [companyId, item.key, JSON.stringify(value)]
    );
  }
};

module.exports = {
  SETTINGS_SCHEMA,
  validateSetting,
  getAll,
  get,
  getMany,
  updateMany,
  remove,
  getGrouped,
  initDefaults,
};