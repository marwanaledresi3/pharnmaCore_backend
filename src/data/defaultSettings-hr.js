// data/defaultSettings-hr.js
/**
 * إعدادات وحدة الموارد البشرية (HR)
 * تُدمج في defaultSettings.js عبر:
 *   ...require('./defaultSettings-hr')
 *
 * ⚠️ عند إضافة مفتاح جديد:
 * 1. أضفه هنا (للشركات الجديدة — يُزرع عبر seed-company.js)
 * 2. أضف migration (للشركات الموجودة)
 * 3. أضفه إلى SETTINGS_SCHEMA في settingsService.js (للتحقق)
 *
 * ⚠️ ملاحظة: fn_setup_new_company لم يعد يزرع settings — seed-company.js هو المسؤول.
 */

module.exports = [
  // ═══════════════════════════════════════════════════
  // HR — عام (General)
  // ═══════════════════════════════════════════════════
  { key: 'hr_enabled',                    value: true },
  { key: 'hr_employee_number_prefix',     value: 'EMP-' },
  { key: 'hr_employee_number_padding',    value: 4 },

  // ═══════════════════════════════════════════════════
  // HR — دوام العمل (Working Hours)
  // ═══════════════════════════════════════════════════
  { key: 'hr_work_start_time',            value: '09:00' },
  { key: 'hr_work_end_time',              value: '17:00' },
  { key: 'hr_standard_work_hours',        value: 8 },
  { key: 'hr_work_days_per_week',         value: 6 },
  { key: 'hr_weekend_days',               value: ['friday'] },
  { key: 'hr_late_grace_minutes',         value: 15 },
  { key: 'hr_overtime_rate',              value: 1.5 },

  // ═══════════════════════════════════════════════════
  // HR — الحضور (Attendance)
  // ═══════════════════════════════════════════════════
  { key: 'hr_attendance_auto_absent',     value: true },
  { key: 'hr_attendance_auto_absent_time', value: '23:59' },
  { key: 'hr_attendance_allow_remote',    value: true },
  { key: 'hr_attendance_require_location', value: false },
  { key: 'hr_attendance_require_photo',   value: false },

  // ═══════════════════════════════════════════════════
  // HR — الإجازات (Leaves)
  // ═══════════════════════════════════════════════════
  { key: 'hr_leave_default_annual_days',  value: 30 },
  { key: 'hr_leave_max_consecutive_days', value: 30 },
  { key: 'hr_leave_min_notice_days',      value: 1 },
  { key: 'hr_leave_require_attachment',   value: false },
  { key: 'hr_leave_allow_overlap',        value: false },
  { key: 'hr_leave_auto_approve_sick',    value: false },
  { key: 'hr_leave_max_pending_requests', value: 5 },

  // ═══════════════════════════════════════════════════
  // HR — الرواتب (Payroll)
  // ═══════════════════════════════════════════════════
  { key: 'hr_payroll_number_prefix',       value: 'PAY-' },
  { key: 'hr_payroll_number_padding',      value: 4 },
  { key: 'hr_payroll_payment_day',         value: 25 },
  { key: 'hr_payroll_auto_calculate',      value: false },
  { key: 'hr_payroll_auto_post_journal',   value: false },
  { key: 'hr_payroll_round_method',        value: 'nearest' },
  { key: 'hr_payroll_decimal_places',      value: 2 },

  // ═══════════════════════════════════════════════════
  // HR — التأمينات الاجتماعية (Social Insurance)
  // ═══════════════════════════════════════════════════
  { key: 'hr_social_insurance_enabled',    value: true },
  { key: 'hr_social_employee_rate',        value: 9.75 },
  { key: 'hr_social_employer_rate',        value: 12 },
  { key: 'hr_social_base',                 value: 'basic' },
  { key: 'hr_social_min_base',             value: 0 },
  { key: 'hr_social_max_base',             value: 45000 },

  // ═══════════════════════════════════════════════════
  // HR — ضريبة الدخل (Income Tax)
  // ═══════════════════════════════════════════════════
  { key: 'hr_tax_enabled',                 value: true },
  { key: 'hr_tax_exemption_threshold',     value: 3000 },
  { key: 'hr_tax_rate',                    value: 5 },
  { key: 'hr_tax_brackets',                value: [] },

  // ═══════════════════════════════════════════════════
  // HR — البدلات (Allowances)
  // ═══════════════════════════════════════════════════
  { key: 'hr_default_housing_allowance',   value: 0 },
  { key: 'hr_default_transport_allowance', value: 0 },
  { key: 'hr_default_other_allowances',    value: 0 },

  // ═══════════════════════════════════════════════════
  // HR — الإشعارات (Notifications)
  // ═══════════════════════════════════════════════════
  { key: 'hr_notify_leave_request',        value: true },
  { key: 'hr_notify_leave_approved',       value: true },
  { key: 'hr_notify_payroll_ready',        value: true },
  { key: 'hr_notify_attendance_missing',   value: true },
  { key: 'hr_notify_contract_expiry',      value: true },
  { key: 'hr_contract_expiry_notify_days', value: 30 },

  // ═══════════════════════════════════════════════════
  // HR — الترقيم (Numbering)
  // ═══════════════════════════════════════════════════
  { key: 'numbering_employee_prefix',      value: 'EMP-' },
  { key: 'numbering_payroll_prefix',       value: 'PAY-' },
  { key: 'numbering_leave_request_prefix', value: 'LR-' },
  { key: 'numbering_attendance_prefix',    value: 'ATT-' },

   // ═══════════════════════════════════════════════════
  // HR — إعادة تعيين أرصدة الإجازات (Leave Balance Reset)
  // ═══════════════════════════════════════════════════
  { key: 'hr_leave_balance_auto_reset',       value: true },   // تفعيل/تعطيل
  { key: 'hr_leave_balance_reset_month',      value: 1 },      // 1-12 (افتراضي: يناير)
  { key: 'hr_leave_balance_reset_day',        value: 1 },      // 1-28 (افتراضي: 1)
  { key: 'hr_leave_balance_reset_hour',       value: 0 },      // 0-23 (افتراضي: 00:05)
  { key: 'hr_leave_balance_carry_over',       value: true },   // ترحيل الرصيد المتبقي

  // تأكد من وجود هذا المفتاح (مضاف بالفعل في الإصدارات السابقة):
  { key: 'hr_contract_expiry_notify_days', value: 30 },

  // ═══════════════════════════════════════════════════
  // HR — التقارير (Reports)
  // ═══════════════════════════════════════════════════
  { key: 'hr_reports_default_format',              value: 'csv' },
  { key: 'hr_reports_include_company_header',      value: true },
  { key: 'hr_reports_include_logo',                value: true },
  { key: 'hr_reports_include_page_numbers',        value: true },
  { key: 'hr_reports_include_timestamp',           value: true },
  { key: 'hr_reports_default_period',              value: 'current_month' },
  { key: 'hr_reports_employees_scope',             value: 'active' },
  { key: 'hr_reports_attendance_include_weekends', value: false },
  { key: 'hr_reports_attendance_include_absent',   value: true },
  { key: 'hr_reports_leave_include_cancelled',     value: false },
  { key: 'hr_reports_payroll_include_drafts',      value: false },
];