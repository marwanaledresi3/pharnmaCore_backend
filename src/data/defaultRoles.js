/**
 * الأدوار الافتراضية لكل شركة
 * permissions: قائمة أكواد الصلاحيات المتطابقة مع seed-permissions.js
 */
module.exports = [
  {
    name: 'Owner',
    description: 'Company owner with full access',
    is_system: true,
    permissions: '*', // كل الصلاحيات
  },
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

      // الشركاء (العملاء والموردون)
      'customers.view', 'customers.create', 'customers.update', 'customers.delete',
      'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.delete',

      // المبيعات والمشتريات والعمليات اللوجستية
      'sales_orders.view', 'sales_orders.create', 'sales_orders.update', 'sales_orders.confirm', 'sales_orders.cancel',
      'delivery_notes.view', 'delivery_notes.create', 'delivery_notes.dispatch', 'delivery_notes.deliver', 'delivery_notes.invoice', 'delivery_notes.cancel',
      'purchase_orders.view', 'purchase_orders.create', 'purchase_orders.update', 'purchase_orders.approve', 'purchase_orders.reject', 'purchase_orders.confirm', 'purchase_orders.cancel',
      'goods_receipts.view', 'goods_receipts.create', 'goods_receipts.confirm', 'goods_receipts.cancel',
      'invoices.view', 'invoices.create', 'invoices.update', 'invoices.cancel',
      'returns.view', 'returns.create', 'returns.confirm', 'returns.cancel',
      'payments.view', 'payments.create', 'payments.update', 'payments.refund',

      // التقارير والمستندات وشبكة B2B والإشعارات
      'documents.view',
      'reports.view', 'reports.view_financial', 'reports.view_inventory', 'reports.view_sales', 'reports.view_purchases', 'reports.export',
      'b2b.view', 'b2b.connect', 'b2b.approve', 'b2b.post',
      'posts.view', 'posts.create', 'posts.delete',
      'notifications.view', 'notifications.mark', 'notifications.delete',
    ],
  },
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
    ],
  },
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
      'payments.view', 'payments.create',
      'documents.view',
      'reports.view', 'reports.view_sales',
      'b2b.view',
      'posts.view',
      'notifications.view', 'notifications.mark',
    ],
  },
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
      'payments.view', 'payments.create',
      'documents.view',
      'reports.view', 'reports.view_purchases',
      'b2b.view', 'b2b.connect',
      'posts.view',
      'notifications.view', 'notifications.mark',
    ],
  },
  {
    name: 'Warehouse',
    description: 'يدير المخزون والمستودعات والتحويلات والتسويات والاستلام والتسليم',
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
    ],
  },
];