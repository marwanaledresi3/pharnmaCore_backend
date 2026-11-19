// data/hrPermissions.js
/**
 * صلاحيات وحدة الموارد البشرية (HR)
 * تُدمج في scripts/seed-permissions.js عبر:
 *   ...require('../data/hrPermissions')
 *
 * ⚠️ عند إضافة صلاحية جديدة:
 * 1. أضفها هنا
 * 2. أضفها إلى defaultRoles.js (في الأدوار المناسبة)
 * 3. شغّل: node scripts/seed-permissions.js
 * 4. شغّل: node scripts/seed-roles.js (أو seed-company.js --all)
 *
 * المجموع: 37 صلاحية
 */

module.exports = [
  // ═══════════════════════════════════════════════════════════
  // 39) Departments (الأقسام) — 4
  // ═══════════════════════════════════════════════════════════
  { code: 'departments.view',   name: 'عرض الأقسام',   module: 'hr' },
  { code: 'departments.create', name: 'إنشاء قسم',     module: 'hr' },
  { code: 'departments.update', name: 'تعديل قسم',     module: 'hr' },
  { code: 'departments.delete', name: 'حذف قسم',       module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 40) Job Titles (المسميات الوظيفية) — 4
  // ═══════════════════════════════════════════════════════════
  { code: 'job_titles.view',   name: 'عرض المسميات الوظيفية', module: 'hr' },
  { code: 'job_titles.create', name: 'إنشاء مسمى وظيفي',      module: 'hr' },
  { code: 'job_titles.update', name: 'تعديل مسمى وظيفي',      module: 'hr' },
  { code: 'job_titles.delete', name: 'حذف مسمى وظيفي',        module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 41) Employees (الموظفون) — 4
  // ═══════════════════════════════════════════════════════════
  { code: 'employees.view',   name: 'عرض الموظفين',   module: 'hr' },
  { code: 'employees.create', name: 'إضافة موظف',     module: 'hr' },
  { code: 'employees.update', name: 'تعديل موظف',     module: 'hr' },
  { code: 'employees.delete', name: 'حذف موظف',       module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 42) Attendance (الحضور والانصراف) — 5
  // ═══════════════════════════════════════════════════════════
  { code: 'attendance.view',     name: 'عرض الحضور',       module: 'hr' },
  { code: 'attendance.checkin',  name: 'تسجيل حضور',       module: 'hr' },
  { code: 'attendance.checkout', name: 'تسجيل انصراف',     module: 'hr' },
  { code: 'attendance.upsert',   name: 'تسجيل حضور يدوي',  module: 'hr' },
  { code: 'attendance.delete',   name: 'حذف سجل حضور',     module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 43) Leave Types (أنواع الإجازات) — 4
  // ═══════════════════════════════════════════════════════════
  { code: 'leave_types.view',   name: 'عرض أنواع الإجازات', module: 'hr' },
  { code: 'leave_types.create', name: 'إنشاء نوع إجازة',    module: 'hr' },
  { code: 'leave_types.update', name: 'تعديل نوع إجازة',    module: 'hr' },
  { code: 'leave_types.delete', name: 'حذف نوع إجازة',      module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 44) Leave Requests (طلبات الإجازة) — 6
  // ═══════════════════════════════════════════════════════════
  { code: 'leave_requests.view',    name: 'عرض طلبات الإجازة', module: 'hr' },
  { code: 'leave_requests.create',  name: 'إنشاء طلب إجازة',   module: 'hr' },
  { code: 'leave_requests.approve', name: 'اعتماد طلب إجازة',  module: 'hr' },
  { code: 'leave_requests.reject',  name: 'رفض طلب إجازة',     module: 'hr' },
  { code: 'leave_requests.cancel',  name: 'إلغاء طلب إجازة',   module: 'hr' },
  { code: 'leave_requests.delete',  name: 'حذف طلب إجازة',     module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 45) Leave Balances (أرصدة الإجازات) — 4
  // ═══════════════════════════════════════════════════════════
  { code: 'leave_balances.view',   name: 'عرض أرصدة الإجازات', module: 'hr' },
  { code: 'leave_balances.create', name: 'إنشاء رصيد إجازة',   module: 'hr' },
  { code: 'leave_balances.update', name: 'تعديل رصيد إجازة',   module: 'hr' },
  { code: 'leave_balances.delete', name: 'حذف رصيد إجازة',     module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 46) Payroll (مسيرات الرواتب) — 4
  // ═══════════════════════════════════════════════════════════
  { code: 'payroll.view',   name: 'عرض الرواتب',    module: 'hr' },
  { code: 'payroll.create', name: 'حساب الرواتب',   module: 'hr' },
  { code: 'payroll.post',   name: 'ترحيل الرواتب',  module: 'hr' },
  { code: 'payroll.delete', name: 'حذف مسير رواتب', module: 'hr' },

  // ═══════════════════════════════════════════════════════════
  // 47) Payroll Items (بنود مسير الرواتب) — 3
  // ═══════════════════════════════════════════════════════════
  { code: 'payroll_items.update', name: 'تعديل بند رواتب', module: 'hr' },
  { code: 'payroll_items.bonus',  name: 'إضافة مكافأة',    module: 'hr' },
  { code: 'payroll_items.delete', name: 'حذف بند رواتب',   module: 'hr' },

  // ⬇️ جديدة — للتمييز بين "عرض الكل" و"عرض الذاتي"
  { code: 'leave_requests.view_all',    name: 'عرض كل طلبات الإجازة',   module: 'hr' },
  { code: 'attendance.view_all',        name: 'عرض كل سجلات الحضور',    module: 'hr' },
  { code: 'leave_balances.view_all',    name: 'عرض كل أرصدة الإجازات',  module: 'hr' },
  { code: 'payroll.view_all',           name: 'عرض كل مسيرات الرواتب', module: 'hr' },
];