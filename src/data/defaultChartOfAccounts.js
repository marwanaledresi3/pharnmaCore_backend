/**
 * شجرة الحسابات الافتراضية لكل شركة جديدة
 * parent_code: كود الحساب الأب (null = حساب رئيسي)
 * account_type: asset | liability | equity | revenue | expense
 */
module.exports = [
  // ============ ASSETS ============
  { code: '1000', name: 'الأصول',                    type: 'asset',     parent: null },
  { code: '1100', name: 'الأصول المتداولة',           type: 'asset',     parent: '1000' },
  { code: '1110', name: 'النقدية وما يعادلها',         type: 'asset',     parent: '1100' },
  { code: '1111', name: 'الصندوق',                   type: 'asset',     parent: '1110' },
  { code: '1112', name: 'البنك',                     type: 'asset',     parent: '1110' },
  { code: '1120', name: 'الذمم المدينة (العملاء)',     type: 'asset',     parent: '1100' },
  { code: '1130', name: 'المخزون',                   type: 'asset',     parent: '1100' },
  { code: '1140', name: 'مصروفات مدفوعة مقدماً',       type: 'asset',     parent: '1100' },
  { code: '1200', name: 'الأصول الثابتة',             type: 'asset',     parent: '1000' },
  { code: '1210', name: 'الأثاث والمعدات',            type: 'asset',     parent: '1200' },
  { code: '1220', name: 'مجمع إهلاك الأثاث والمعدات',  type: 'asset',     parent: '1200' },

  // ============ LIABILITIES ============
  { code: '2000', name: 'الخصوم',                    type: 'liability', parent: null },
  { code: '2100', name: 'الخصوم المتداولة',           type: 'liability', parent: '2000' },
  { code: '2110', name: 'الذمم الدائنة (الموردون)',    type: 'liability', parent: '2100' },
  { code: '2120', name: 'ضريبة القيمة المضافة المستحقة', type: 'liability', parent: '2100' },
  { code: '2130', name: 'الرواتب المستحقة',           type: 'liability', parent: '2100' },
  { code: '2140', name: 'مصروفات مستحقة',             type: 'liability', parent: '2100' },

  // ============ EQUITY ============
  { code: '3000', name: 'حقوق الملكية',              type: 'equity',    parent: null },
  { code: '3100', name: 'رأس المال',                 type: 'equity',    parent: '3000' },
  { code: '3200', name: 'الأرباح المحتجزة',           type: 'equity',    parent: '3000' },
  { code: '3300', name: 'المسحوبات الشخصية',          type: 'equity',    parent: '3000' },

  // ============ REVENUE ============
  { code: '4000', name: 'الإيرادات',                 type: 'revenue',   parent: null },
  { code: '4100', name: 'إيرادات المبيعات',          type: 'revenue',   parent: '4000' },
  { code: '4200', name: 'إيرادات الخدمات',           type: 'revenue',   parent: '4000' },
  { code: '4900', name: 'خصم المبيعات',              type: 'revenue',   parent: '4000' },

  // ============ EXPENSE ============
  { code: '5000', name: 'المصروفات',                 type: 'expense',   parent: null },
  { code: '5100', name: 'تكلفة المبيعات (COGS)',      type: 'expense',   parent: '5000' },
  { code: '5200', name: 'الرواتب والأجور',           type: 'expense',   parent: '5000' },
  { code: '5300', name: 'الإيجار',                   type: 'expense',   parent: '5000' },
  { code: '5400', name: 'الكهرباء والمياه',          type: 'expense',   parent: '5000' },
  { code: '5500', name: 'الاتصالات',                 type: 'expense',   parent: '5000' },
  { code: '5600', name: 'مصروفات تشغيلية أخرى',      type: 'expense',   parent: '5000' },
  { code: '5900', name: 'مصروفات متنوعة',            type: 'expense',   parent: '5000' },
];