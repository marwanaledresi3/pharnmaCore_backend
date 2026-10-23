require('dotenv').config();
const db = require('../config/db');

const PERMISSIONS = [
  // ===== Companies =====
  { code: 'companies.view',   name: 'View company',         module: 'companies' },
  { code: 'companies.update', name: 'Update company',       module: 'companies' },

  // ===== Currencies =====
  { code: 'currencies.view',   name: 'View currencies',   module: 'currencies' },
  { code: 'currencies.create', name: 'Create currency',   module: 'currencies' },
  { code: 'currencies.update', name: 'Update currency',   module: 'currencies' },
  { code: 'currencies.delete', name: 'Delete currency',   module: 'currencies' },

  // ===== Exchange Rates =====
  { code: 'exchange_rates.view',   name: 'View exchange rates', module: 'exchange_rates' },
  { code: 'exchange_rates.create', name: 'Create exchange rate', module: 'exchange_rates' },
  { code: 'exchange_rates.update', name: 'Update exchange rate', module: 'exchange_rates' },
  { code: 'exchange_rates.delete', name: 'Delete exchange rate', module: 'exchange_rates' },

  // ===== Users =====
  { code: 'users.view',     name: 'View users',     module: 'users' },
  { code: 'users.create',   name: 'Create user',    module: 'users' },
  { code: 'users.update',   name: 'Update user',    module: 'users' },
  { code: 'users.delete',   name: 'Delete user',    module: 'users' },
  { code: 'users.activate', name: 'Activate/deactivate user', module: 'users' },

  // ===== Roles =====
  { code: 'roles.view',   name: 'View roles',   module: 'roles' },
  { code: 'roles.create', name: 'Create role',  module: 'roles' },
  { code: 'roles.update', name: 'Update role',  module: 'roles' },
  { code: 'roles.delete', name: 'Delete role',  module: 'roles' },
  { code: 'roles.assign', name: 'Assign role to user', module: 'roles' },

  // ===== Chart of Accounts =====
  { code: 'accounts.view',   name: 'View accounts',   module: 'accounts' },
  { code: 'accounts.create', name: 'Create account',  module: 'accounts' },
  { code: 'accounts.update', name: 'Update account',  module: 'accounts' },
  { code: 'accounts.delete', name: 'Delete account',  module: 'accounts' },

  // ===== Tax Rates =====
  { code: 'tax_rates.view',   name: 'View tax rates',   module: 'tax_rates' },
  { code: 'tax_rates.create', name: 'Create tax rate',  module: 'tax_rates' },
  { code: 'tax_rates.update', name: 'Update tax rate',  module: 'tax_rates' },
  { code: 'tax_rates.delete', name: 'Delete tax rate',  module: 'tax_rates' },

  // ===== Journal Entries =====
  { code: 'journal_entries.view',   name: 'View journal entries', module: 'journal_entries' },
  { code: 'journal_entries.create', name: 'Create journal entry', module: 'journal_entries' },
  { code: 'journal_entries.update', name: 'Update journal entry', module: 'journal_entries' },
  { code: 'journal_entries.delete', name: 'Delete journal entry', module: 'journal_entries' },
  { code: 'journal_entries.post',   name: 'Post journal entry',   module: 'journal_entries' },
  { code: 'journal_entries.unpost', name: 'Unpost journal entry', module: 'journal_entries' },

  // ===== Products =====
  { code: 'products.view',   name: 'View products',   module: 'products' },
  { code: 'products.create', name: 'Create product',  module: 'products' },
  { code: 'products.update', name: 'Update product',  module: 'products' },
  { code: 'products.delete', name: 'Delete product',  module: 'products' },

  // ===== Warehouses =====
  { code: 'warehouses.view',   name: 'View warehouses',   module: 'warehouses' },
  { code: 'warehouses.create', name: 'Create warehouse',  module: 'warehouses' },
  { code: 'warehouses.update', name: 'Update warehouse',  module: 'warehouses' },
  { code: 'warehouses.delete', name: 'Delete warehouse',  module: 'warehouses' },

  // ===== Batches =====
  { code: 'batches.view',    name: 'View batches',    module: 'batches' },
  { code: 'batches.create',  name: 'Create batch',    module: 'batches' },
  { code: 'batches.update',  name: 'Update batch',    module: 'batches' },
  { code: 'batches.adjust',  name: 'Adjust batch quantity', module: 'batches' },

  // ===== Stock Movements =====
  { code: 'stock_movements.view',   name: 'View stock movements',   module: 'stock_movements' },
  { code: 'stock_movements.create', name: 'Create stock movement',  module: 'stock_movements' },

  // ===== Customers =====
  { code: 'customers.view',   name: 'View customers',   module: 'customers' },
  { code: 'customers.create', name: 'Create customer',  module: 'customers' },
  { code: 'customers.update', name: 'Update customer',  module: 'customers' },
  { code: 'customers.delete', name: 'Delete customer',  module: 'customers' },

  // ===== Suppliers =====
  { code: 'suppliers.view',   name: 'View suppliers',   module: 'suppliers' },
  { code: 'suppliers.create', name: 'Create supplier',  module: 'suppliers' },
  { code: 'suppliers.update', name: 'Update supplier',  module: 'suppliers' },
  { code: 'suppliers.delete', name: 'Delete supplier',  module: 'suppliers' },

  // ===== Sales Orders =====
  { code: 'sales_orders.view',    name: 'View sales orders',    module: 'sales_orders' },
  { code: 'sales_orders.create',  name: 'Create sales order',   module: 'sales_orders' },
  { code: 'sales_orders.update',  name: 'Update sales order',   module: 'sales_orders' },
  { code: 'sales_orders.delete',  name: 'Delete sales order',   module: 'sales_orders' },
  { code: 'sales_orders.confirm', name: 'Confirm sales order',  module: 'sales_orders' },
  { code: 'sales_orders.cancel',  name: 'Cancel sales order',   module: 'sales_orders' },

  // ===== Purchase Orders =====
  { code: 'purchase_orders.view',    name: 'View purchase orders',   module: 'purchase_orders' },
  { code: 'purchase_orders.create',  name: 'Create purchase order',  module: 'purchase_orders' },
  { code: 'purchase_orders.update',  name: 'Update purchase order',  module: 'purchase_orders' },
  { code: 'purchase_orders.delete',  name: 'Delete purchase order',  module: 'purchase_orders' },
  { code: 'purchase_orders.confirm', name: 'Confirm purchase order', module: 'purchase_orders' },
  { code: 'purchase_orders.cancel',  name: 'Cancel purchase order',  module: 'purchase_orders' },

  // ===== Invoices =====
  { code: 'invoices.view',   name: 'View invoices',   module: 'invoices' },
  { code: 'invoices.create', name: 'Create invoice',  module: 'invoices' },
  { code: 'invoices.update', name: 'Update invoice',  module: 'invoices' },
  { code: 'invoices.delete', name: 'Delete invoice',  module: 'invoices' },
  { code: 'invoices.cancel', name: 'Cancel invoice',  module: 'invoices' },

  // ===== Payments =====
  { code: 'payments.view',   name: 'View payments',   module: 'payments' },
  { code: 'payments.create', name: 'Create payment',  module: 'payments' },
  { code: 'payments.delete', name: 'Delete payment',  module: 'payments' },

  // ===== Reports =====
  { code: 'reports.view_financial', name: 'View financial reports', module: 'reports' },
  { code: 'reports.view_inventory', name: 'View inventory reports', module: 'reports' },
  { code: 'reports.view_sales',     name: 'View sales reports',     module: 'reports' },
  { code: 'reports.view_purchases', name: 'View purchases reports', module: 'reports' },

  // ===== Notifications =====
  { code: 'notifications.view',      name: 'View notifications',      module: 'notifications' },
  { code: 'notifications.mark_read', name: 'Mark notifications read', module: 'notifications' },

  // ===== Audit Logs =====
  { code: 'audit_logs.view', name: 'View audit logs', module: 'audit_logs' },

  // ===== Settings =====
  { code: 'settings.view',   name: 'View settings',   module: 'settings' },
  { code: 'settings.update', name: 'Update settings', module: 'settings' },
];

(async () => {
  try {
    let inserted = 0;
    for (const p of PERMISSIONS) {
      const res = await db.query(
        `INSERT INTO permissions (code, name, module)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name, module = EXCLUDED.module
         RETURNING (xmax = 0) AS inserted`,
        [p.code, p.name, p.module]
      );
      if (res.rows[0].inserted) inserted++;
    }
    console.log(`✅ Permissions seeded: ${inserted} new, ${PERMISSIONS.length} total`);
    process.exit(0);
  } catch (e) {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  }
})();