// data/fixedAssetsPermissions.js
/**
 * صلاحيات وحدة الأصول الثابتة (Fixed Assets)
 * تُدمج في scripts/seed-permissions.js عبر:
 *   ...require('../data/fixedAssetsPermissions')
 */

module.exports = [
  // تصنيفات الأصول
  { code: 'asset_categories.view',   name: 'عرض تصنيفات الأصول', module: 'fixed_assets' },
  { code: 'asset_categories.create', name: 'إنشاء تصنيف أصول',   module: 'fixed_assets' },
  { code: 'asset_categories.update', name: 'تعديل تصنيف أصول',   module: 'fixed_assets' },
  { code: 'asset_categories.delete', name: 'حذف تصنيف أصول',     module: 'fixed_assets' },

  // الأصول الثابتة
  { code: 'fixed_assets.view',     name: 'عرض الأصول الثابتة', module: 'fixed_assets' },
  { code: 'fixed_assets.create',   name: 'إضافة أصل ثابت',     module: 'fixed_assets' },
  { code: 'fixed_assets.update',   name: 'تعديل أصل ثابت',     module: 'fixed_assets' },
  { code: 'fixed_assets.delete',   name: 'حذف أصل ثابت',       module: 'fixed_assets' },
  { code: 'fixed_assets.transfer', name: 'نقل عهدة أصل ثابت',  module: 'fixed_assets' },

  // الإهلاك
  { code: 'asset_depreciation.view', name: 'عرض سجلات الإهلاك', module: 'fixed_assets' },
  { code: 'asset_depreciation.run',  name: 'تشغيل وحساب الإهلاك', module: 'fixed_assets' },

  // الصيانة
  { code: 'asset_maintenance.view',   name: 'عرض صيانة الأصول', module: 'fixed_assets' },
  { code: 'asset_maintenance.create', name: 'تسجيل صيانة أصل',   module: 'fixed_assets' },

  // التخلص والبيع
  { code: 'asset_disposals.view',   name: 'عرض استبعاد الأصول', module: 'fixed_assets' },
  { code: 'asset_disposals.create', name: 'استبعاد/بيع أصل',    module: 'fixed_assets' },
];