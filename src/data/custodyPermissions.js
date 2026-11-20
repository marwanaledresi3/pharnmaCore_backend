// data/custodyPermissions.js
/**
 * صلاحيات وحدة العهد والسلف (Custody & Advances)
 * تُدمج في scripts/seed-permissions.js عبر:
 *   ...require('../data/custodyPermissions')
 *
 * عند إضافة أو تعديل صلاحية:
 * 1. أضفها هنا
 * 2. أضفها إلى defaultRoles.js (في الأدوار المناسبة)
 * 3. شغّل: node scripts/seed-permissions.js
 * 4. شغّل: node scripts/seed-roles.js
 */

module.exports = [
  // العهد وأنواعها
  { code: 'custody.read',   name: 'عرض العهد وأنواعها', module: 'custody' },
  { code: 'custody.create', name: 'إنشاء العهد وأنواعها', module: 'custody' },
  { code: 'custody.settle', name: 'تسوية حركات العهد',   module: 'custody' },

  // السلف والأقساط
  { code: 'advances.read',    name: 'عرض السلف والأقساط',         module: 'advances' },
  { code: 'advances.create',  name: 'إنشاء طلبات السلف',         module: 'advances' },
  { code: 'advances.approve', name: 'اعتماد أو رفض وإلغاء السلف', module: 'advances' },
  { code: 'advances.pay',     name: 'سداد أقساط السلف',           module: 'advances' },
];