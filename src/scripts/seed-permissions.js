#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * SEED PERMISSIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * يزرع كل الصلاحيات في جدول `permissions`.
 * Idempotent: يمكن تشغيله أكثر من مرة بأمان.
 *
 * - يضيف صلاحيات جديدة
 * - يُحدّث اسم/وحدة الصلاحيات الموجودة (لتصحيح الأخطاء)
 * - لا يحذف شيئاً
 *
 * الاستخدام:
 *   node scripts/seed-permissions.js
 *   node scripts/seed-permissions.js --dry-run
 *   node scripts/seed-permissions.js --verbose
 */

require('dotenv').config();
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════
// CLI Args
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// ═══════════════════════════════════════════════════════════════
// Colors
// ═══════════════════════════════════════════════════════════════

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

// ═══════════════════════════════════════════════════════════════
// ⚠️ هذا هو المصدر الوحيد للحقيقة — كل الصلاحيات
// ═══════════════════════════════════════════════════════════════

const PERMISSIONS = [
  // ═══════════════════════════════════════════════════════════
  // 1) Auth (المصادقة)
  // ═══════════════════════════════════════════════════════════
  { code: 'auth.login',           name: 'تسجيل الدخول',              module: 'auth' },
  { code: 'auth.logout',          name: 'تسجيل الخروج',              module: 'auth' },
  { code: 'auth.refresh',         name: 'تحديث الجلسة',              module: 'auth' },
  { code: 'auth.change_password', name: 'تغيير كلمة المرور',         module: 'auth' },

  // ═══════════════════════════════════════════════════════════
  // 2) Companies (الشركات)
  // ═══════════════════════════════════════════════════════════
  { code: 'companies.view',   name: 'عرض الشركات',           module: 'companies' },
  { code: 'companies.create', name: 'إنشاء شركة',            module: 'companies' },
  { code: 'companies.update', name: 'تعديل بيانات الشركة',   module: 'companies' },
  { code: 'companies.delete', name: 'حذف شركة',              module: 'companies' },

  // ═══════════════════════════════════════════════════════════
  // 3) Settings (الإعدادات)
  // ═══════════════════════════════════════════════════════════
  { code: 'settings.view',   name: 'عرض الإعدادات',      module: 'settings' },
  { code: 'settings.update', name: 'تعديل الإعدادات',    module: 'settings' },

  // ═══════════════════════════════════════════════════════════
  // 4) Users (المستخدمون)
  // ═══════════════════════════════════════════════════════════
  { code: 'users.view',    name: 'عرض المستخدمين',    module: 'users' },
  { code: 'users.create',  name: 'إنشاء مستخدم',      module: 'users' },
  { code: 'users.update',  name: 'تعديل مستخدم',      module: 'users' },
  { code: 'users.delete',  name: 'حذف مستخدم',        module: 'users' },

  // ═══════════════════════════════════════════════════════════
  // 5) Roles & Permissions (الأدوار والصلاحيات)
  // ═══════════════════════════════════════════════════════════
  { code: 'roles.view',    name: 'عرض الأدوار',         module: 'roles' },
  { code: 'roles.create',  name: 'إنشاء دور',           module: 'roles' },
  { code: 'roles.update',  name: 'تعديل دور',           module: 'roles' },
  { code: 'roles.delete',  name: 'حذف دور',             module: 'roles' },
  { code: 'roles.assign',  name: 'إسناد الأدوار',       module: 'roles' },

  // ═══════════════════════════════════════════════════════════
  // 6) Branches (الفروع)
  // ═══════════════════════════════════════════════════════════
  { code: 'branches.view',   name: 'عرض الفروع',      module: 'branches' },
  { code: 'branches.create', name: 'إنشاء فرع',       module: 'branches' },
  { code: 'branches.update', name: 'تعديل فرع',       module: 'branches' },
  { code: 'branches.delete', name: 'حذف فرع',         module: 'branches' },

  // ═══════════════════════════════════════════════════════════
  // 7) Customers (العملاء)
  // ═══════════════════════════════════════════════════════════
  { code: 'customers.view',   name: 'عرض العملاء',     module: 'customers' },
  { code: 'customers.create', name: 'إنشاء عميل',      module: 'customers' },
  { code: 'customers.update', name: 'تعديل عميل',      module: 'customers' },
  { code: 'customers.delete', name: 'حذف عميل',        module: 'customers' },

  // ═══════════════════════════════════════════════════════════
  // 8) Suppliers (الموردون)
  // ═══════════════════════════════════════════════════════════
  { code: 'suppliers.view',   name: 'عرض الموردين',    module: 'suppliers' },
  { code: 'suppliers.create', name: 'إنشاء مورد',      module: 'suppliers' },
  { code: 'suppliers.update', name: 'تعديل مورد',      module: 'suppliers' },
  { code: 'suppliers.delete', name: 'حذف مورد',        module: 'suppliers' },

  // ═══════════════════════════════════════════════════════════
  // 9) Products (المنتجات)
  // ═══════════════════════════════════════════════════════════
  { code: 'products.view',   name: 'عرض المنتجات',     module: 'products' },
  { code: 'products.create', name: 'إنشاء منتج',       module: 'products' },
  { code: 'products.update', name: 'تعديل منتج',       module: 'products' },
  { code: 'products.delete', name: 'حذف منتج',         module: 'products' },

  // ═══════════════════════════════════════════════════════════
  // 10) Warehouses (المستودعات)
  // ═══════════════════════════════════════════════════════════
  { code: 'warehouses.view',   name: 'عرض المستودعات',   module: 'warehouses' },
  { code: 'warehouses.create', name: 'إنشاء مستودع',     module: 'warehouses' },
  { code: 'warehouses.update', name: 'تعديل مستودع',     module: 'warehouses' },
  { code: 'warehouses.delete', name: 'حذف مستودع',       module: 'warehouses' },

  // ═══════════════════════════════════════════════════════════
  // 11) Invoices (الفواتير)
  // ═══════════════════════════════════════════════════════════
  { code: 'invoices.view',   name: 'عرض الفواتير',     module: 'invoices' },
  { code: 'invoices.create', name: 'إنشاء فاتورة',     module: 'invoices' },
  { code: 'invoices.update', name: 'تعديل فاتورة',     module: 'invoices' },
  { code: 'invoices.cancel', name: 'إلغاء فاتورة',     module: 'invoices' },
  { code: 'invoices.delete', name: 'حذف فاتورة',       module: 'invoices' },

  // ═══════════════════════════════════════════════════════════
  // 12) Sales Orders (أوامر البيع)
  // ═══════════════════════════════════════════════════════════
  { code: 'sales_orders.view',    name: 'عرض أوامر البيع',     module: 'sales_orders' },
  { code: 'sales_orders.create',  name: 'إنشاء أمر بيع',       module: 'sales_orders' },
  { code: 'sales_orders.update',  name: 'تعديل أمر بيع',       module: 'sales_orders' },
  { code: 'sales_orders.confirm', name: 'تأكيد أمر بيع',       module: 'sales_orders' },
  { code: 'sales_orders.cancel',  name: 'إلغاء أمر بيع',       module: 'sales_orders' },
  { code: 'sales_orders.delete',  name: 'حذف أمر بيع',         module: 'sales_orders' },

  // ═══════════════════════════════════════════════════════════
  // 13) Purchase Orders (أوامر الشراء)
  // ═══════════════════════════════════════════════════════════
  { code: 'purchase_orders.view',    name: 'عرض أوامر الشراء',    module: 'purchase_orders' },
  { code: 'purchase_orders.create',  name: 'إنشاء أمر شراء',      module: 'purchase_orders' },
  { code: 'purchase_orders.update',  name: 'تعديل أمر شراء',      module: 'purchase_orders' },
  { code: 'purchase_orders.approve', name: 'موافقة أمر شراء',     module: 'purchase_orders' },
  { code: 'purchase_orders.reject',  name: 'رفض أمر شراء',        module: 'purchase_orders' },
  { code: 'purchase_orders.confirm', name: 'تأكيد أمر شراء',      module: 'purchase_orders' },
  { code: 'purchase_orders.cancel',  name: 'إلغاء أمر شراء',      module: 'purchase_orders' },
  { code: 'purchase_orders.delete',  name: 'حذف أمر شراء',        module: 'purchase_orders' },

  // ═══════════════════════════════════════════════════════════
  // 14) Payments (المدفوعات)
  // ═══════════════════════════════════════════════════════════
  { code: 'payments.view',   name: 'عرض المدفوعات',   module: 'payments' },
  { code: 'payments.create', name: 'إنشاء دفعة',      module: 'payments' },
  { code: 'payments.update', name: 'تعديل دفعة',      module: 'payments' },
  { code: 'payments.delete', name: 'حذف دفعة',        module: 'payments' },
  { code: 'payments.refund', name: 'استرداد دفعة',    module: 'payments' },

  // ═══════════════════════════════════════════════════════════
  // 15) Expenses (المصروفات)
  // ═══════════════════════════════════════════════════════════
  { code: 'expenses.view',   name: 'عرض المصروفات',   module: 'expenses' },
  { code: 'expenses.create', name: 'إنشاء مصروف',     module: 'expenses' },
  { code: 'expenses.update', name: 'تعديل مصروف',     module: 'expenses' },
  { code: 'expenses.delete', name: 'حذف مصروف',       module: 'expenses' },

  // ═══════════════════════════════════════════════════════════
  // 16) Returns (المرتجعات)
  // ═══════════════════════════════════════════════════════════
  { code: 'returns.view',    name: 'عرض المرتجعات',   module: 'returns' },
  { code: 'returns.create',  name: 'إنشاء مرتجع',     module: 'returns' },
  { code: 'returns.confirm', name: 'تأكيد مرتجع',     module: 'returns' },
  { code: 'returns.cancel',  name: 'إلغاء مرتجع',     module: 'returns' },
  { code: 'returns.delete',  name: 'حذف مرتجع',       module: 'returns' },

  // ═══════════════════════════════════════════════════════════
  // 17) Journal Entries (القيود اليومية)
  // ═══════════════════════════════════════════════════════════
  { code: 'journal_entries.view',   name: 'عرض القيود',       module: 'journal_entries' },
  { code: 'journal_entries.create', name: 'إنشاء قيد',        module: 'journal_entries' },
  { code: 'journal_entries.update', name: 'تعديل قيد',        module: 'journal_entries' },
  { code: 'journal_entries.post',   name: 'ترحيل قيد',        module: 'journal_entries' },
  { code: 'journal_entries.unpost', name: 'إلغاء ترحيل',      module: 'journal_entries' },
  { code: 'journal_entries.delete', name: 'حذف قيد',          module: 'journal_entries' },

  // ═══════════════════════════════════════════════════════════
  // 18) Accounts (شجرة الحسابات)
  // ═══════════════════════════════════════════════════════════
  { code: 'accounts.view',   name: 'عرض الحسابات',     module: 'accounts' },
  { code: 'accounts.create', name: 'إنشاء حساب',       module: 'accounts' },
  { code: 'accounts.update', name: 'تعديل حساب',       module: 'accounts' },
  { code: 'accounts.delete', name: 'حذف حساب',         module: 'accounts' },

  // ═══════════════════════════════════════════════════════════
  // 19) Currencies (العملات)
  // ═══════════════════════════════════════════════════════════
  { code: 'currencies.view',   name: 'عرض العملات',     module: 'currencies' },
  { code: 'currencies.create', name: 'إنشاء عملة',      module: 'currencies' },
  { code: 'currencies.update', name: 'تعديل عملة',      module: 'currencies' },
  { code: 'currencies.delete', name: 'حذف عملة',        module: 'currencies' },

  // ═══════════════════════════════════════════════════════════
  // 20) Exchange Rates (أسعار الصرف)
  // ═══════════════════════════════════════════════════════════
  { code: 'exchange_rates.view',   name: 'عرض أسعار الصرف',   module: 'exchange_rates' },
  { code: 'exchange_rates.create', name: 'إنشاء سعر صرف',     module: 'exchange_rates' },
  { code: 'exchange_rates.update', name: 'تعديل سعر صرف',     module: 'exchange_rates' },
  { code: 'exchange_rates.delete', name: 'حذف سعر صرف',       module: 'exchange_rates' },

  // ═══════════════════════════════════════════════════════════
  // 21) Units (وحدات القياس)
  // ═══════════════════════════════════════════════════════════
  { code: 'units.view',   name: 'عرض الوحدات',     module: 'units' },
  { code: 'units.create', name: 'إنشاء وحدة',      module: 'units' },
  { code: 'units.update', name: 'تعديل وحدة',      module: 'units' },
  { code: 'units.delete', name: 'حذف وحدة',        module: 'units' },

  // ═══════════════════════════════════════════════════════════
  // 22) Reports (التقارير)
  // ═══════════════════════════════════════════════════════════
  { code: 'reports.view',             name: 'عرض التقارير',          module: 'reports' },
  { code: 'reports.view_financial',   name: 'عرض التقارير المالية',  module: 'reports' },
  { code: 'reports.view_inventory',   name: 'عرض تقارير المخزون',    module: 'reports' },
  { code: 'reports.view_sales',       name: 'عرض تقارير المبيعات',   module: 'reports' },
  { code: 'reports.view_purchases',   name: 'عرض تقارير المشتريات',  module: 'reports' },
  { code: 'reports.export',           name: 'تصدير التقارير',        module: 'reports' },

  // ═══════════════════════════════════════════════════════════
  // 23) B2B (شبكة الأعمال)
  // ═══════════════════════════════════════════════════════════
  { code: 'b2b.view',     name: 'عرض سوق B2B',       module: 'b2b' },
  { code: 'b2b.connect',  name: 'طلب اتصال',         module: 'b2b' },
  { code: 'b2b.approve',  name: 'موافقة اتصال',      module: 'b2b' },
  { code: 'b2b.post',     name: 'نشر إعلان',         module: 'b2b' },

  // ═══════════════════════════════════════════════════════════
  // 24) Notifications (الإشعارات)
  // ═══════════════════════════════════════════════════════════
  { code: 'notifications.view',   name: 'عرض الإشعارات',   module: 'notifications' },
  { code: 'notifications.mark',   name: 'تحديد كمقروء',    module: 'notifications' },
  { code: 'notifications.delete', name: 'حذف إشعار',       module: 'notifications' },

  // ═══════════════════════════════════════════════════════════
  // 25) Documents (المستندات الموحدة) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'documents.view', name: 'عرض المستندات', module: 'documents' },

  // ═══════════════════════════════════════════════════════════
  // 26) Stock Transfers (أذون التحويل) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'stock_transfers.view',    name: 'عرض أذون التحويل',    module: 'stock_transfers' },
  { code: 'stock_transfers.create',  name: 'إنشاء أذون التحويل',   module: 'stock_transfers' },
  { code: 'stock_transfers.confirm', name: 'تأكيد أذون التحويل',   module: 'stock_transfers' },
  { code: 'stock_transfers.cancel',  name: 'إلغاء أذون التحويل',   module: 'stock_transfers' },

  // ═══════════════════════════════════════════════════════════
  // 27) Stock Adjustments (تسويات الجرد) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'stock_adjustments.view',    name: 'عرض تسويات الجرد',    module: 'stock_adjustments' },
  { code: 'stock_adjustments.create',  name: 'إنشاء تسويات الجرد',  module: 'stock_adjustments' },
  { code: 'stock_adjustments.confirm', name: 'تأكيد تسويات الجرد',  module: 'stock_adjustments' },
  { code: 'stock_adjustments.cancel',  name: 'إلغاء تسويات الجرد',  module: 'stock_adjustments' },

  // ═══════════════════════════════════════════════════════════
  // 28) Notes (إشعارات مدين/دائن) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'notes.view',    name: 'عرض الإشعارات',   module: 'notes' },
  { code: 'notes.create',  name: 'إنشاء الإشعارات', module: 'notes' },
  { code: 'notes.confirm', name: 'تأكيد الإشعارات', module: 'notes' },
  { code: 'notes.cancel',  name: 'إلغاء الإشعارات', module: 'notes' },

  // ═══════════════════════════════════════════════════════════
  // 29) Delivery Notes (مذكرات التسليم) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'delivery_notes.view',     name: 'عرض مذكرات التسليم',    module: 'delivery_notes' },
  { code: 'delivery_notes.create',   name: 'إنشاء مذكرات التسليم',  module: 'delivery_notes' },
  { code: 'delivery_notes.dispatch', name: 'صرف مذكرات التسليم',    module: 'delivery_notes' },
  { code: 'delivery_notes.deliver',  name: 'تأكيد التسليم',          module: 'delivery_notes' },
  { code: 'delivery_notes.invoice',  name: 'تحويل لفاتورة',          module: 'delivery_notes' },
  { code: 'delivery_notes.cancel',   name: 'إلغاء مذكرات التسليم',   module: 'delivery_notes' },

  // ═══════════════════════════════════════════════════════════
  // 30) Goods Receipts (أذون الاستلام) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'goods_receipts.view',    name: 'عرض أذون الاستلام',   module: 'goods_receipts' },
  { code: 'goods_receipts.create',  name: 'إنشاء أذون الاستلام',  module: 'goods_receipts' },
  { code: 'goods_receipts.confirm', name: 'تأكيد أذون الاستلام',  module: 'goods_receipts' },
  { code: 'goods_receipts.cancel',  name: 'إلغاء أذون الاستلام',  module: 'goods_receipts' },

  // ═══════════════════════════════════════════════════════════
  // 31) Batches (دفعات المخزون) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'batches.view',   name: 'عرض الدفعات',     module: 'inventory' },
  { code: 'batches.create', name: 'إنشاء دفعة',      module: 'inventory' },
  { code: 'batches.update', name: 'تعديل دفعة',      module: 'inventory' },
  { code: 'batches.delete', name: 'حذف دفعة',        module: 'inventory' },

  // ═══════════════════════════════════════════════════════════
  // 32) Stock Movements & Reservations (حركة وحجوزات المخزون) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'stock_movements.view',    name: 'عرض حركات المخزون', module: 'inventory' },
  { code: 'stock_reservations.view', name: 'عرض حجوزات المخزون', module: 'inventory' },

  // ═══════════════════════════════════════════════════════════
  // 33) Taxes (الضرائب) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'taxes.view',   name: 'عرض الضرائب',     module: 'settings' },
  { code: 'taxes.create', name: 'إنشاء ضريبة',     module: 'settings' },
  { code: 'taxes.update', name: 'تعديل ضريبة',     module: 'settings' },
  { code: 'taxes.delete', name: 'حذف ضريبة',       module: 'settings' },

  // ═══════════════════════════════════════════════════════════
  // 34) Global Products (المنتجات العالمية) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'global_products.view',   name: 'عرض المنتجات العالمية', module: 'products' },
  { code: 'global_products.verify', name: 'اعتماد منتج عالمي',      module: 'products' },

  // ═══════════════════════════════════════════════════════════
  // 35) Audit Logs (سجل التدقيق) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'audit.view', name: 'عرض سجل التدقيق', module: 'audit' },

  // ═══════════════════════════════════════════════════════════
  // 36) Company Posts / Social (منشورات الشبكة) 🆕
  // ═══════════════════════════════════════════════════════════
  { code: 'posts.view',   name: 'عرض المنشورات', module: 'b2b' },
  { code: 'posts.create', name: 'نشر منشور',    module: 'b2b' },
  { code: 'posts.delete', name: 'حذف منشور',    module: 'b2b' },
];

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function log(...args) {
  console.log(...args);
}

function logVerbose(...args) {
  if (VERBOSE) console.log(`${colors.dim}  ${args.join(' ')}${colors.reset}`);
}

function groupByModule(permissions) {
  const grouped = {};
  for (const p of permissions) {
    if (!grouped[p.module]) grouped[p.module] = [];
    grouped[p.module].push(p);
  }
  return grouped;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function seed() {
  const startedAt = Date.now();

  log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  🌱 Seed Permissions${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.dim}  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}${colors.reset}`);
  log('');

  log(`📋 Total permissions in source: ${colors.bright}${PERMISSIONS.length}${colors.reset}`);
  log(`📦 Modules: ${colors.bright}${new Set(PERMISSIONS.map((p) => p.module)).size}${colors.reset}`);
  log('');

  // ─── 1) جلب الصلاحيات الموجودة ───
  const { rows: existing } = await pool.query(
    `SELECT id, code, name, module FROM permissions`
  );

  const existingMap = new Map();
  for (const e of existing) existingMap.set(e.code, e);

  log(`📊 Existing permissions in DB: ${colors.bright}${existing.length}${colors.reset}\n`);

  // ─── 2) تحليل ───
  const stats = {
    toInsert: [],
    toUpdate: [],
    unchanged: [],
    toDelete: [], // لا نحذف — فقط نُبلّغ
  };

  for (const p of PERMISSIONS) {
    const ex = existingMap.get(p.code);
    if (!ex) {
      stats.toInsert.push(p);
    } else if (ex.name !== p.name || ex.module !== p.module) {
      stats.toUpdate.push({ old: ex, new: p });
    } else {
      stats.unchanged.push(p);
    }
  }

  // صلاحيات في DB ليست في المصدر
  const sourceCodes = new Set(PERMISSIONS.map((p) => p.code));
  for (const ex of existing) {
    if (!sourceCodes.has(ex.code)) {
      stats.toDelete.push(ex);
    }
  }

  // ─── 3) تقرير ما قبل التنفيذ ───
  log(`${colors.bright}📊 Changes to apply:${colors.reset}`);
  log(`   ${colors.green}+ To INSERT${colors.reset} : ${stats.toInsert.length}`);
  log(`   ${colors.yellow}~ To UPDATE${colors.reset} : ${stats.toUpdate.length}`);
  log(`   ${colors.dim}= Unchanged${colors.reset} : ${stats.unchanged.length}`);
  if (stats.toDelete.length > 0) {
    log(`   ${colors.magenta}⚠ In DB only${colors.reset} : ${stats.toDelete.length} (not in source)`);
  }
  log('');

  if (DRY_RUN) {
    if (VERBOSE) {
      if (stats.toInsert.length > 0) {
        log(`${colors.green}${colors.bright}Would INSERT:${colors.reset}`);
        const grouped = groupByModule(stats.toInsert);
        for (const [mod, perms] of Object.entries(grouped)) {
          log(`  ${colors.bright}[${mod}]${colors.reset}`);
          for (const p of perms) log(`    + ${p.code} → "${p.name}"`);
        }
        log('');
      }
      if (stats.toUpdate.length > 0) {
        log(`${colors.yellow}${colors.bright}Would UPDATE:${colors.reset}`);
        for (const u of stats.toUpdate) {
          log(`  ~ ${u.new.code}`);
          if (u.old.name !== u.new.name) {
            log(`      name: "${u.old.name}" → "${u.new.name}"`);
          }
          if (u.old.module !== u.new.module) {
            log(`      module: "${u.old.module}" → "${u.new.module}"`);
          }
        }
        log('');
      }
      if (stats.toDelete.length > 0) {
        log(`${colors.magenta}${colors.bright}In DB only (NOT deleted):${colors.reset}`);
        for (const d of stats.toDelete) {
          log(`  ? ${d.code} → "${d.name}" (module: ${d.module})`);
        }
        log('');
      }
    }
    log(`${colors.yellow}💡 This was a DRY RUN. Run without --dry-run to apply.${colors.reset}\n`);
    return stats;
  }

  // ─── 4) تنفيذ ───
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // INSERT
    for (const p of stats.toInsert) {
      await client.query(
        `INSERT INTO permissions (code, name, module)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [p.code, p.name, p.module]
      );
      logVerbose(`+ ${p.code}`);
    }

    // UPDATE
    for (const u of stats.toUpdate) {
      await client.query(
        `UPDATE permissions SET name = $1, module = $2 WHERE code = $3`,
        [u.new.name, u.new.module, u.new.code]
      );
      logVerbose(`~ ${u.new.code}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ─── 5) التقرير النهائي ───
  const duration = formatDuration(Date.now() - startedAt);

  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  📊 Summary${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`  Inserted  : ${colors.green}${colors.bright}${stats.toInsert.length}${colors.reset}`);
  log(`  Updated   : ${colors.yellow}${stats.toUpdate.length}${colors.reset}`);
  log(`  Unchanged : ${stats.unchanged.length}`);
  if (stats.toDelete.length > 0) {
    log(`  In DB only: ${colors.magenta}${stats.toDelete.length}${colors.reset} (not deleted)`);
  }
  log(`  Duration  : ${duration}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}\n`);

  if (stats.toDelete.length > 0) {
    log(`${colors.yellow}⚠️  ${stats.toDelete.length} permission(s) in DB but not in source.${colors.reset}`);
    log(`${colors.yellow}   These were NOT deleted. Review if they should be removed manually.${colors.reset}\n`);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n${colors.red}❌ Seed failed:${colors.reset}`, err);
    console.error(colors.dim, err.stack, colors.reset);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });