// services/settingsService.js
const { pool } = require('../config/pool');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SETTINGS SCHEMA
 * ═══════════════════════════════════════════════════════════════════════════
 * تعريف نوع كل مفتاح + قواعد التحقق
 * ⚠️ أي مفتاح جديد يجب إضافته هنا
 * ═══════════════════════════════════════════════════════════════════════════
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
  numbering_purchase_order_prefix:  { type: 'string', maxLength: 10 },
  numbering_sales_order_prefix:     { type: 'string', maxLength: 10 },
  numbering_payment_receipt_prefix: { type: 'string', maxLength: 10 },
  numbering_payment_voucher_prefix: { type: 'string', maxLength: 10 },
  numbering_expense_prefix:         { type: 'string', maxLength: 10 },
  numbering_return_prefix:          { type: 'string', maxLength: 10 },
  numbering_journal_prefix:         { type: 'string', maxLength: 10 },
  numbering_padding:                { type: 'number', min: 1, max: 10 },
  numbering_reset_yearly:           { type: 'boolean' },

  // ── Inventory ──
  inventory_method:                   { type: 'string', enum: ['fifo', 'lifo', 'average'] },
  inventory_allow_negative:           { type: 'boolean' },
  inventory_low_stock_threshold:      { type: 'number', min: 0 },
  inventory_expiry_notify_days:       { type: 'number', min: 0, max: 365 },
  inventory_expiry_warning_days:      { type: 'number', min: 0, max: 365 },
  inventory_require_batch_on_sale:    { type: 'boolean' },
  inventory_auto_reserve_on_approve:  { type: 'boolean' },
  inventory_show_expired_in_sale:     { type: 'boolean' },

  // ── Tax ──
  tax_default_rate:       { type: 'number', min: 0, max: 100 },
  tax_inclusive_pricing:  { type: 'boolean' },
  tax_calculation_method: { type: 'string', enum: ['line', 'invoice'] },
  tax_show_on_invoice:    { type: 'boolean' },

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
  payment_cash_account_id:    { type: 'uuid', nullable: true },
  payment_bank_account_id:    { type: 'uuid', nullable: true },

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

  // ═══════════════════════════════════════════════════════════════════════════
  // ⬇️ HR — جديد
  // ═══════════════════════════════════════════════════════════════════════════

  // ── HR — عام ──
  hr_enabled:                { type: 'boolean' },
  hr_employee_number_prefix: { type: 'string', maxLength: 10 },
  hr_employee_number_padding:{ type: 'number', min: 1, max: 10 },

  // ── HR — دوام العمل ──
  hr_work_start_time:        { type: 'string', pattern: /^\d{2}:\d{2}$/ },
  hr_work_end_time:          { type: 'string', pattern: /^\d{2}:\d{2}$/ },
  hr_standard_work_hours:    { type: 'number', min: 1, max: 24 },
  hr_work_days_per_week:     { type: 'number', min: 1, max: 7 },
  hr_weekend_days:           { type: 'array', itemType: 'string' },
  hr_late_grace_minutes:     { type: 'number', min: 0, max: 120 },
  hr_overtime_rate:          { type: 'number', min: 1, max: 5 },

  // ── HR — الحضور ──
  hr_attendance_auto_absent:       { type: 'boolean' },
  hr_attendance_auto_absent_time:  { type: 'string', pattern: /^\d{2}:\d{2}$/ },
  hr_attendance_allow_remote:      { type: 'boolean' },
  hr_attendance_require_location:  { type: 'boolean' },
  hr_attendance_require_photo:     { type: 'boolean' },

  // ── HR — الإجازات ──
  hr_leave_default_annual_days:   { type: 'number', min: 0, max: 365 },
  hr_leave_max_consecutive_days:  { type: 'number', min: 0, max: 365 },
  hr_leave_min_notice_days:       { type: 'number', min: 0, max: 90 },
  hr_leave_require_attachment:    { type: 'boolean' },
  hr_leave_allow_overlap:         { type: 'boolean' },
  hr_leave_auto_approve_sick:     { type: 'boolean' },
  hr_leave_max_pending_requests:  { type: 'number', min: 0, max: 100 },

  // ── HR — الرواتب ──
  hr_payroll_number_prefix:      { type: 'string', maxLength: 10 },
  hr_payroll_number_padding:     { type: 'number', min: 1, max: 10 },
  hr_payroll_payment_day:        { type: 'number', min: 1, max: 28 },
  hr_payroll_auto_calculate:     { type: 'boolean' },
  hr_payroll_auto_post_journal:  { type: 'boolean' },
  hr_payroll_round_method:       { type: 'string', enum: ['nearest', 'up', 'down'] },
  hr_payroll_decimal_places:     { type: 'number', min: 0, max: 6 },

  // ── HR — التأمينات الاجتماعية ──
  hr_social_insurance_enabled:  { type: 'boolean' },
  hr_social_employee_rate:      { type: 'number', min: 0, max: 100 },
  hr_social_employer_rate:      { type: 'number', min: 0, max: 100 },
  hr_social_base:               { type: 'string', enum: ['basic', 'gross'] },
  hr_social_min_base:           { type: 'number', min: 0 },
  hr_social_max_base:           { type: 'number', min: 0 },

  // ── HR — ضريبة الدخل ──
  hr_tax_enabled:              { type: 'boolean' },
  hr_tax_exemption_threshold:  { type: 'number', min: 0 },
  hr_tax_rate:                 { type: 'number', min: 0, max: 100 },
  hr_tax_brackets:             { type: 'array', itemType: 'object' },

  // ── HR — البدلات ──
  hr_default_housing_allowance:   { type: 'number', min: 0 },
  hr_default_transport_allowance: { type: 'number', min: 0 },
  hr_default_other_allowances:    { type: 'number', min: 0 },

  // ── HR — الإشعارات ──
  hr_notify_leave_request:        { type: 'boolean' },
  hr_notify_leave_approved:       { type: 'boolean' },
  hr_notify_payroll_ready:        { type: 'boolean' },
  hr_notify_attendance_missing:   { type: 'boolean' },
  hr_notify_contract_expiry:      { type: 'boolean' },
  hr_contract_expiry_notify_days: { type: 'number', min: 0, max: 365 },

  // ── HR — الترقيم ──
  numbering_employee_prefix:       { type: 'string', maxLength: 10 },
  numbering_payroll_prefix:        { type: 'string', maxLength: 10 },
  numbering_leave_request_prefix:  { type: 'string', maxLength: 10 },
  numbering_attendance_prefix:     { type: 'string', maxLength: 10 },

  // ── HR — إعادة تعيين أرصدة الإجازات ──
  hr_leave_balance_auto_reset:   { type: 'boolean' },
  hr_leave_balance_reset_month:  { type: 'number', min: 1, max: 12 },
  hr_leave_balance_reset_day:    { type: 'number', min: 1, max: 28 },
  hr_leave_balance_reset_hour:   { type: 'number', min: 0, max: 23 },
  hr_leave_balance_carry_over:   { type: 'boolean' },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — Reports
  // ═══════════════════════════════════════════════════════════════════════════
  hr_reports_default_format:               { type: 'string', enum: ['csv', 'xlsx', 'pdf'] },
  hr_reports_include_company_header:       { type: 'boolean' },
  hr_reports_include_logo:                 { type: 'boolean' },
  hr_reports_include_page_numbers:         { type: 'boolean' },
  hr_reports_include_timestamp:            { type: 'boolean' },
  hr_reports_default_period:               { type: 'string', enum: ['current_month', 'last_month', 'current_year', 'custom'] },
  hr_reports_employees_scope:              { type: 'string', enum: ['all', 'active', 'on_leave'] },
  hr_reports_attendance_include_weekends:  { type: 'boolean' },
  hr_reports_attendance_include_absent:    { type: 'boolean' },
  hr_reports_leave_include_cancelled:      { type: 'boolean' },
  hr_reports_payroll_include_drafts:       { type: 'boolean' },

  // ── Fixed Assets ──
  fa_asset_number_prefix:         { type: 'string', maxLength: 10 },
  fa_asset_number_padding:        { type: 'number', min: 1, max: 10 },
  fa_depreciation_number_prefix:  { type: 'string', maxLength: 10 },
  fa_depreciation_number_padding: { type: 'number', min: 1, max: 10 },
  fa_disposal_number_prefix:      { type: 'string', maxLength: 10 },
  fa_disposal_number_padding:     { type: 'number', min: 1, max: 10 },
  fa_auto_post_disposal:        { type: 'boolean' },

  // ── Fixed Assets ──
  fa_enabled:                     { type: 'boolean' },
  numbering_asset_prefix:         { type: 'string', maxLength: 10 },
  numbering_asset_padding:        { type: 'number', min: 1, max: 10 },
  fa_default_depreciation_method: { type: 'string', enum: ['straight_line', 'declining_balance', 'units_of_production'] },
  fa_auto_post_depreciation:      { type: 'boolean' },
};

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const GROUP_BY_PREFIX = (key) => {
  const idx = key.indexOf('_');
  return idx > 0 ? key.substring(0, idx) : 'general';
};

/**
 * التحقق من قيمة إعداد واحد
 */
const validateSetting = (key, value) => {
  const rule = SETTINGS_SCHEMA[key];
  if (!rule) return { valid: false, error: `Unknown setting key: ${key}` };

  // nullable
  if (rule.nullable && value === null) return { valid: true };

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
  } else if (t === 'uuid') {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return { valid: false, error: `${key} must be a valid UUID` };
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) {
      return { valid: false, error: `${key} must be an array` };
    }
    if (rule.itemType) {
      for (const item of value) {
        const itemType = typeof item;
        if (rule.itemType === 'string' && itemType !== 'string') {
          return { valid: false, error: `${key} items must be strings` };
        }
        if (rule.itemType === 'object' && (item === null || itemType !== 'object')) {
          return { valid: false, error: `${key} items must be objects` };
        }
      }
    }
  }

  return { valid: true };
};

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

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
 * جلب إعداد واحد — alias لـ get للتوافق.
 */
const getOne = async (companyId, key, defaultValue = null, client = pool) => {
  const { rows } = await client.query(
    `SELECT value FROM settings WHERE company_id = $1 AND key = $2`,
    [companyId, key]
  );
  return rows[0] ? rows[0].value : defaultValue;
};

/**
 * جلب إعداد واحد (الاسم الأصلي — يبقى للتوافق).
 */
const get = getOne;

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
 * تحديث إعداد واحد
 */
const set = async (companyId, key, value, client = pool) => {
  const check = validateSetting(key, value);
  if (!check.valid) {
    const err = new Error(check.error);
    err.statusCode = 400;
    throw err;
  }

  await client.query(
    `INSERT INTO settings (company_id, key, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (company_id, key)
     DO UPDATE SET value = EXCLUDED.value`,
    [companyId, key, JSON.stringify(value)]
  );
  return { key, value };
};

/**
 * تحديث دفعة — alias لـ updateMany.
 */
const setMany = async (companyId, entries, client = pool) => {
  const updates = {};
  for (const e of entries) updates[e.key] = e.value;
  return updateMany(companyId, updates, client);
};

/**
 * تحديث عدة إعدادات دفعة واحدة.
 */
const updateMany = async (companyId, updates, client = pool) => {
  const updated = [];
  const errors = [];

  for (const [key, value] of Object.entries(updates)) {
    const check = validateSetting(key, value);
    if (!check.valid) errors.push({ key, error: check.error });
  }

  if (errors.length > 0) return { updated: [], errors };

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

const remove = async (companyId, key, client = pool) => {
  const { rowCount } = await client.query(
    `DELETE FROM settings WHERE company_id = $1 AND key = $2`,
    [companyId, key]
  );
  return rowCount > 0;
};

const getGrouped = async (companyId) => {
  const flat = await getAll(companyId);
  const grouped = {};

  for (const [key, value] of Object.entries(flat)) {
    const group = GROUP_BY_PREFIX(key);
    if (!grouped[group]) grouped[group] = {};
    grouped[group][key] = value;
  }

  return grouped;
};

/**
 * تهيئة الإعدادات الافتراضية لشركة جديدة.
 */
const initDefaults = async (client, companyId, overrides = {}) => {
  const defaults = require('../data/defaultSettings');

  for (const item of defaults) {
    const value = overrides[item.key] !== undefined ? overrides[item.key] : item.value;

    await client.query(
      `INSERT INTO settings (company_id, key, value)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (company_id, key) DO NOTHING`,
      [companyId, item.key, JSON.stringify(value)]
    );
  }
};

/**
 * ⬇️ دالة مساعدة — تُستخدم من jobs HR
 * ترجع إعدادات HR المطلوبة مع قيم افتراضية آمنة.
 */
const getHRJobSettings = async (companyId, client = pool) => {
  const keys = [
    'hr_attendance_auto_absent',
    'hr_attendance_auto_absent_time',
    'hr_weekend_days',
    'hr_payroll_auto_calculate',
    'hr_payroll_auto_post_journal',
    'hr_payroll_payment_day',
    'hr_leave_balance_auto_reset',
    'hr_leave_balance_reset_month',
    'hr_leave_balance_reset_day',
    'hr_leave_balance_reset_hour',
    'hr_leave_balance_carry_over',
  ];

  const raw = await getMany(companyId, keys, client);

  return {
    attendance: {
      autoAbsent:     raw.hr_attendance_auto_absent ?? true,
      autoAbsentTime: raw.hr_attendance_auto_absent_time ?? '23:59',
      weekendDays:    Array.isArray(raw.hr_weekend_days) ? raw.hr_weekend_days : ['friday'],
    },
    payroll: {
      autoCalculate: raw.hr_payroll_auto_calculate ?? false,
      autoPost:      raw.hr_payroll_auto_post_journal ?? false,
      paymentDay:    Number(raw.hr_payroll_payment_day ?? 25),
    },
    leaveBalance: {
      autoReset:  raw.hr_leave_balance_auto_reset ?? true,
      resetMonth: Math.min(Math.max(Number(raw.hr_leave_balance_reset_month ?? 1), 1), 12),
      resetDay:   Math.min(Math.max(Number(raw.hr_leave_balance_reset_day ?? 1), 1), 28),
      resetHour:  Math.min(Math.max(Number(raw.hr_leave_balance_reset_hour ?? 0), 0), 23),
      carryOver:  raw.hr_leave_balance_carry_over ?? true,
    },
  };
};

module.exports = {
  SETTINGS_SCHEMA,
  validateSetting,
  getAll,
  get,
  getOne,
  getMany,
  set,
  setMany,
  updateMany,
  remove,
  getGrouped,
  initDefaults,
  getHRJobSettings,
};