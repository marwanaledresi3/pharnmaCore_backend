// data/defaultRoles.js
/**
 * الأدوار الافتراضية لكل شركة
 * permissions: قائمة أكواد الصلاحيات المتطابقة مع seed-permissions.js
 *
 * ⚠️ عند تعديل دور: شغّل seed-roles.js أو seed-company.js --all
 * ⚠️ الأدوار is_system: true لا يمكن حذفها من الواجهة
 *
 * المجموع: 7 أدوار
 */
module.exports = [
  // ═══════════════════════════════════════════════════════════
  // 1) Owner — كل الصلاحيات
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Owner',
    description: 'Company owner with full access',
    is_system: true,
    permissions: '*',
  },

  // ═══════════════════════════════════════════════════════════
  // 2) Manager — مدير عام
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Manager',
    description: 'General manager — full operational access',
    is_system: true,
    permissions: [
      // الشركة والإعدادات والفروع
      'companies.view', 'companies.update',
      'branches.view', 'branches.create', 'branches.update', 'branches.delete',
      'settings.view', 'settings.update',
      'taxes.view', 'taxes.create', 'taxes.update', 'taxes.delete',
      'units.view', 'units.create', 'units.update', 'units.delete',

      // المستخدمون والأدوار والتدقيق
      'users.view', 'users.create', 'users.update', 'users.delete',
      'roles.view', 'roles.create', 'roles.update', 'roles.assign',
      'audit.view',

      // المالية والمحاسبة
      'currencies.view', 'currencies.create', 'currencies.update',
      'exchange_rates.view', 'exchange_rates.create', 'exchange_rates.update',
      'accounts.view', 'accounts.create', 'accounts.update',
      'journal_entries.view', 'journal_entries.create', 'journal_entries.update', 'journal_entries.post', 'journal_entries.unpost',
      'cash_registers.view', 'cash_registers.create', 'cash_registers.update', 'cash_registers.delete',
      'cash_transfers.view', 'cash_transfers.create', 'cash_transfers.cancel',
      'expenses.view', 'expenses.create', 'expenses.update', 'expenses.delete',
      'notes.view', 'notes.create', 'notes.confirm', 'notes.cancel',

      // المنتجات والمخزون
      'products.view', 'products.create', 'products.update', 'products.delete',
      'global_products.view', 'global_products.verify',
      'warehouses.view', 'warehouses.create', 'warehouses.update',
      'batches.view', 'batches.create', 'batches.update',
      'stock_movements.view', 'stock_reservations.view',
      'stock_transfers.view', 'stock_transfers.create', 'stock_transfers.confirm', 'stock_transfers.cancel',
      'stock_adjustments.view', 'stock_adjustments.create', 'stock_adjustments.confirm', 'stock_adjustments.cancel',

      // الشركاء
      'customers.view', 'customers.create', 'customers.update', 'customers.delete',
      'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.delete',

      // المبيعات والمشتريات
      'sales_orders.view', 'sales_orders.create', 'sales_orders.update', 'sales_orders.confirm', 'sales_orders.cancel',
      'delivery_notes.view', 'delivery_notes.create', 'delivery_notes.dispatch', 'delivery_notes.deliver', 'delivery_notes.invoice', 'delivery_notes.cancel',
      'purchase_orders.view', 'purchase_orders.create', 'purchase_orders.update', 'purchase_orders.approve', 'purchase_orders.reject', 'purchase_orders.confirm', 'purchase_orders.cancel',
      'goods_receipts.view', 'goods_receipts.create', 'goods_receipts.confirm', 'goods_receipts.cancel',
      'invoices.view', 'invoices.create', 'invoices.update', 'invoices.cancel',
      'returns.view', 'returns.create', 'returns.confirm', 'returns.cancel',
      'payments.view', 'payments.create', 'payments.update', 'payments.refund',

      // التقارير والمستندات و B2B
      'documents.view',
      'reports.view', 'reports.view_financial', 'reports.view_inventory', 'reports.view_sales', 'reports.view_purchases', 'reports.export',
      'b2b.view', 'b2b.connect', 'b2b.approve', 'b2b.post',
      'posts.view', 'posts.create', 'posts.delete',
      'notifications.view', 'notifications.mark', 'notifications.delete',

      // ⬇️ HR (Manager — كل شيء عدا حذف الموظفين)
      'departments.view', 'departments.create', 'departments.update', 'departments.delete',
      'job_titles.view', 'job_titles.create', 'job_titles.update', 'job_titles.delete',
      'employees.view', 'employees.create', 'employees.update',
      'attendance.view', 'attendance.checkin', 'attendance.checkout', 'attendance.upsert', 'attendance.delete',
      'leave_types.view', 'leave_types.create', 'leave_types.update', 'leave_types.delete',
      'leave_requests.view', 'leave_requests.create', 'leave_requests.approve', 'leave_requests.reject', 'leave_requests.cancel', 'leave_requests.delete',
      'leave_balances.view', 'leave_balances.create', 'leave_balances.update',
      'payroll.view', 'payroll.create', 'payroll.post',
      'payroll_items.update', 'payroll_items.bonus',

      // الأصول الثابتة
      'asset_categories.view', 'asset_categories.create', 'asset_categories.update',
      'fixed_assets.view', 'fixed_assets.create', 'fixed_assets.update', 'fixed_assets.transfer',
      'asset_depreciation.view', 'asset_depreciation.run',
      'asset_maintenance.view', 'asset_maintenance.create',
      'asset_disposals.view', 'asset_disposals.create',

      'custody.read', 'custody.create', 'custody.settle',
      'advances.read', 'advances.create', 'advances.approve', 'advances.pay',
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 3) Accountant — محاسب (موجود + إضافة عرض HR)
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Accountant',
    description: 'يدير الحسابات والفواتير والمدفوعات والمصروفات',
    is_system: false,
    permissions: [
      'companies.view',
      'branches.view',
      'currencies.view',
      'exchange_rates.view', 'exchange_rates.create', 'exchange_rates.update',
      'taxes.view',
      'accounts.view', 'accounts.create', 'accounts.update',
      'journal_entries.view', 'journal_entries.create', 'journal_entries.update', 'journal_entries.post', 'journal_entries.unpost',
      'cash_registers.view', 'cash_registers.create', 'cash_registers.update',
      'cash_transfers.view', 'cash_transfers.create', 'cash_transfers.cancel',
      'customers.view',
      'suppliers.view',
      'invoices.view', 'invoices.create', 'invoices.update', 'invoices.cancel',
      'payments.view', 'payments.create', 'payments.update', 'payments.refund',
      'expenses.view', 'expenses.create', 'expenses.update',
      'notes.view', 'notes.create', 'notes.confirm', 'notes.cancel',
      'returns.view', 'returns.confirm',
      'documents.view',
      'reports.view', 'reports.view_financial', 'reports.view_sales', 'reports.view_purchases', 'reports.export',
      'notifications.view', 'notifications.mark',

      // ⬇️ HR (Accountant — عرض فقط + رواتب)
      'employees.view',
      'payroll.view',           // لعرض كشوف الرواتب
      'payroll_items.update',   // لتعديل البنود قبل الترحيل (اختياري)
      'payroll_items.bonus',

      'asset_categories.view',
      'fixed_assets.view', 'fixed_assets.create', 'fixed_assets.update',
      'asset_depreciation.view', 'asset_depreciation.run',
      'asset_maintenance.view', 'asset_maintenance.create',
      'asset_disposals.view', 'asset_disposals.create',

      'custody.read', 'custody.settle',
      'advances.read', 'advances.approve', 'advances.pay',
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 4) HR Manager — 🆕 مدير موارد بشرية
  // ═══════════════════════════════════════════════════════════
  {
    name: 'HR Manager',
    description: 'مدير الموارد البشرية — إدارة كاملة للموظفين والحضور والإجازات والرواتب',
    is_system: false,
    permissions: [
      // عرض الشركة والإعدادات
      'companies.view',
      'branches.view',
      'settings.view',
      'documents.view',
      'notifications.view', 'notifications.mark',
      'reports.view', 'reports.view_financial', 'reports.export',

      // ⬇️ HR — إدارة كاملة
      'departments.view', 'departments.create', 'departments.update', 'departments.delete',
      'job_titles.view', 'job_titles.create', 'job_titles.update', 'job_titles.delete',
      'employees.view', 'employees.create', 'employees.update', 'employees.delete',
      'attendance.view', 'attendance.checkin', 'attendance.checkout', 'attendance.upsert', 'attendance.delete',
      'leave_types.view', 'leave_types.create', 'leave_types.update', 'leave_types.delete',
      'leave_requests.view', 'leave_requests.create', 'leave_requests.approve', 'leave_requests.reject', 'leave_requests.cancel', 'leave_requests.delete',
      'leave_balances.view', 'leave_balances.create', 'leave_balances.update', 'leave_balances.delete',
      'payroll.view', 'payroll.create', 'payroll.post', 'payroll.delete',
      'payroll_items.update', 'payroll_items.bonus', 'payroll_items.delete',

      'custody.read', 'custody.create', 'custody.settle',
      'advances.read', 'advances.create', 'advances.approve', 'advances.pay',
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 5) Employee — 🆕 موظف (ذاتي فقط)
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Employee',
    description: 'موظف — تسجيل حضوره وطلب إجازته وعرض قسيمة راتبه',
    is_system: false,
    permissions: [
      // ⬇️ HR — ذاتي فقط (انظر ملاحظة أدناه)
      'attendance.checkin',      // تسجيل حضوره
      'attendance.checkout',     // تسجيل انصرافه
      'attendance.view',         // عرض سجلاته (يُقيَّد بـ employee_id في الـ controller)
      'leave_requests.create',   // طلب إجازة
      'leave_requests.view',     // عرض طلباته (يُقيَّد بـ employee_id)
      'leave_requests.cancel',   // إلغاء طلباته (يُقيَّد بـ employee_id)
      'leave_balances.view',     // عرض رصيده (يُقيَّد بـ employee_id)
      'payroll.view',            // عرض قسيمة راتبه (يُقيَّد)
      'notifications.view', 'notifications.mark',

      'custody.read',
      'advances.read', 'advances.create',
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 6) Salesperson — بائع (بدون HR)
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Salesperson',
    description: 'يدير العملاء وأوامر البيع ومذكرات التسليم',
    is_system: false,
    permissions: [
      'products.view',
      'global_products.view',
      'units.view',
      'warehouses.view',
      'batches.view',
      'stock_reservations.view',
      'customers.view', 'customers.create', 'customers.update',
      'sales_orders.view', 'sales_orders.create', 'sales_orders.update', 'sales_orders.confirm', 'sales_orders.cancel',
      'delivery_notes.view', 'delivery_notes.create', 'delivery_notes.invoice',
      'invoices.view', 'invoices.create',
      'returns.view', 'returns.create',
      'cash_registers.view',
      'payments.view', 'payments.create',
      'documents.view',
      'reports.view', 'reports.view_sales',
      'b2b.view',
      'posts.view',
      'notifications.view', 'notifications.mark',
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 7) Purchasing — مشتريات (بدون HR)
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Purchasing',
    description: 'يدير الموردين وأوامر الشراء وأذون الاستلام',
    is_system: false,
    permissions: [
      'products.view', 'products.create', 'products.update',
      'global_products.view',
      'units.view',
      'warehouses.view',
      'batches.view',
      'suppliers.view', 'suppliers.create', 'suppliers.update',
      'purchase_orders.view', 'purchase_orders.create', 'purchase_orders.update', 'purchase_orders.approve', 'purchase_orders.reject', 'purchase_orders.confirm', 'purchase_orders.cancel',
      'goods_receipts.view', 'goods_receipts.create', 'goods_receipts.confirm',
      'invoices.view',
      'returns.view', 'returns.create',
      'cash_registers.view',
      'payments.view', 'payments.create',
      'documents.view',
      'reports.view', 'reports.view_purchases',
      'b2b.view', 'b2b.connect',
      'posts.view',
      'notifications.view', 'notifications.mark',
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 8) Warehouse — مستودع (بدون HR)
  // ═══════════════════════════════════════════════════════════
  {
    name: 'Warehouse',
    description: 'يدير المخزون والمستودعات والتحويلات والتسويات',
    is_system: false,
    permissions: [
      'products.view',
      'units.view',
      'warehouses.view', 'warehouses.update',
      'batches.view', 'batches.create', 'batches.update',
      'stock_movements.view', 'stock_reservations.view',
      'stock_transfers.view', 'stock_transfers.create', 'stock_transfers.confirm', 'stock_transfers.cancel',
      'stock_adjustments.view', 'stock_adjustments.create', 'stock_adjustments.confirm', 'stock_adjustments.cancel',
      'delivery_notes.view', 'delivery_notes.dispatch', 'delivery_notes.deliver',
      'goods_receipts.view', 'goods_receipts.create', 'goods_receipts.confirm',
      'documents.view',
      'reports.view', 'reports.view_inventory',
      'notifications.view', 'notifications.mark',

      'asset_categories.view',
      'fixed_assets.view', 'fixed_assets.transfer',
      'asset_maintenance.view', 'asset_maintenance.create',
    ],
  },
];