const {pool} = require('../config/pool');
const Account = require('../models/Account');
const Role = require('../models/Role');
const defaultAccounts = require('../data/defaultChartOfAccounts');
const defaultRoles = require('../data/defaultRoles');

/**
 * ينشئ كل الأساسيات لشركة جديدة داخل transaction موجودة
 * @param {Object} client - عميل PostgreSQL (من نفس الـ transaction)
 * @param {string} companyId
 * @param {Object} options - { defaultCurrencyId, createdBy }
 */
const bootstrap = async (client, companyId, options = {}) => {
  // 1) شجرة الحسابات
  const accountIds = await createDefaultChartOfAccounts(client, companyId);

  // 2) الضريبة الافتراضية (VAT 15%)
  await createDefaultTaxRate(client, companyId);

  // 3) المستودع الرئيسي
  await createDefaultWarehouse(client, companyId);

  // 4) الأدوار الافتراضية
  const roles = await createDefaultRoles(client, companyId);

  // 5) إعدادات الشركة
  await createDefaultSettings(client, companyId, options);

  return { accountIds, roles };
};

/**
 * إنشاء شجرة الحسابات بالترتيب الهرمي (الأب قبل الابن)
 */
const createDefaultChartOfAccounts = async (client, companyId) => {
  const codeToId = {};

  // نرتّب حسب عدد النقاط في parent (الحسابات الجذرية أولاً)
  const sorted = [...defaultAccounts].sort((a, b) => {
    const depthA = a.parent === null ? 0 : 1;
    const depthB = b.parent === null ? 0 : 1;
    return depthA - depthB;
  });

  for (const acc of sorted) {
    const parentId = acc.parent ? codeToId[acc.parent] : null;
    const created = await Account.create(client, companyId, {
      code: acc.code,
      name: acc.name,
      account_type: acc.type,
      parent_id: parentId,
    });
    codeToId[acc.code] = created.id;
  }

  return codeToId;
};

/**
 * ضريبة القيمة المضافة الافتراضية 15%
 */
const createDefaultTaxRate = async (client, companyId) => {
  await client.query(
    `INSERT INTO tax_rates (company_id, name, rate, is_default, is_active)
     VALUES ($1, 'VAT 15%', 15.00, TRUE, TRUE)
     ON CONFLICT (company_id, name) DO NOTHING`,
    [companyId]
  );
};

/**
 * المستودع الرئيسي
 */
const createDefaultWarehouse = async (client, companyId) => {
  await client.query(
    `INSERT INTO warehouses (company_id, name, location, is_active)
     VALUES ($1, 'المستودع الرئيسي', NULL, TRUE)
     ON CONFLICT (company_id, name) DO NOTHING`,
    [companyId]
  );
};

/**
 * الأدوار الافتراضية + إسناد الصلاحيات
 */
const createDefaultRoles = async (client, companyId) => {
  const createdRoles = {};

  for (const roleDef of defaultRoles) {
    const role = await Role.create(client, companyId, {
      name: roleDef.name,
      description: roleDef.description,
      is_system: roleDef.is_system,
    });
    createdRoles[roleDef.name] = role;

    // إسناد الصلاحيات
    if (roleDef.permissions === '*') {
      await Role.grantAllPermissions(client, role.id);
    } else if (roleDef.permissions.length) {
      const perms = await client.query(
        `SELECT id FROM permissions WHERE code = ANY($1::text[])`,
        [roleDef.permissions]
      );
      for (const p of perms.rows) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [role.id, p.id]
        );
      }
    }
  }

  return createdRoles;
};

/**
 * إعدادات الشركة الافتراضية
 */
const createDefaultSettings = async (client, companyId, options) => {
  const settings = [
  { key: 'timezone',       value: JSON.stringify('Asia/Aden') },
  { key: 'date_format',    value: JSON.stringify('YYYY-MM-DD') },
  { key: 'invoice_prefix', value: JSON.stringify('INV-') },
  { key: 'order_prefix',   value: JSON.stringify('SO-') },
  { key: 'fiscal_year_start', value: JSON.stringify('01-01') },
  { key: 'default_currency',  value: JSON.stringify(options.defaultCurrencyId || null) },
  // جديد:
  { key: 'currency_position', value: JSON.stringify('suffix') },     // prefix | suffix
  { key: 'decimal_places',    value: JSON.stringify(2) },
  { key: 'default_tax_rate',  value: JSON.stringify(15) },
  { key: 'invoice_footer',    value: JSON.stringify('شكراً لتعاملكم معنا') },
  { key: 'low_stock_notify',  value: JSON.stringify(true) },
  { key: 'expiry_notify_days', value: JSON.stringify(30) },
  { key: 'invoice_due_days',   value: JSON.stringify(30) },
];


  for (const s of settings) {
    await client.query(
      `INSERT INTO settings (company_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, key) DO NOTHING`,
      [companyId, s.key, s.value]
    );
  }
};

module.exports = { bootstrap };