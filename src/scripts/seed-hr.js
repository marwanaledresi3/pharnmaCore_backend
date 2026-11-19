#!/usr/bin/env node
// scripts/seed-hr.js
//
// بيانات HR الافتراضية:
//   - أقسام (departments)
//   - مسميات وظيفية (job_titles)
//   - أنواع إجازات (leave_types)
//
// الاستخدام:
//   node scripts/seed-hr.js --company <uuid>       # لشركة واحدة
//   node scripts/seed-hr.js --all                  # لكل الشركات النشطة
//   node scripts/seed-hr.js --company <uuid> --reset   # حذف وإعادة إنشاء
//
// Idempotent — يمكن تشغيله مراراً بدون تكرار.

require('dotenv').config();
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// البيانات الافتراضية
// ═══════════════════════════════════════════════════════════════════════════

const DEPARTMENTS = [
  { code: 'ADMIN',    name: 'الإدارة العامة',      name_en: 'Administration' },
  { code: 'HR',       name: 'الموارد البشرية',      name_en: 'Human Resources' },
  { code: 'FIN',      name: 'المالية والمحاسبة',    name_en: 'Finance & Accounting' },
  { code: 'SALES',    name: 'المبيعات',             name_en: 'Sales' },
  { code: 'PURCHASE', name: 'المشتريات',            name_en: 'Purchasing' },
  { code: 'WH',       name: 'المستودعات',           name_en: 'Warehouses' },
  { code: 'IT',       name: 'تقنية المعلومات',      name_en: 'Information Technology' },
  { code: 'OPS',      name: 'العمليات',             name_en: 'Operations' },
  { code: 'QC',       name: 'الجودة',               name_en: 'Quality Control' },
  { code: 'CS',       name: 'خدمة العملاء',         name_en: 'Customer Service' },
];

const JOB_TITLES = [
  // Administration
  { code: 'GM',          name: 'المدير العام',              dept: 'ADMIN' },
  { code: 'EXEC_SEC',    name: 'سكرتير تنفيذي',              dept: 'ADMIN' },
  // HR
  { code: 'HR_MGR',      name: 'مدير الموارد البشرية',       dept: 'HR' },
  { code: 'HR_SPEC',     name: 'أخصائي موارد بشرية',        dept: 'HR' },
  // Finance
  { code: 'FIN_MGR',     name: 'المدير المالي',              dept: 'FIN' },
  { code: 'ACCOUNTANT',  name: 'محاسب',                      dept: 'FIN' },
  { code: 'CASHIER',     name: 'أمين صندوق',                 dept: 'FIN' },
  // Sales
  { code: 'SALES_MGR',   name: 'مدير المبيعات',              dept: 'SALES' },
  { code: 'SALES_REP',   name: 'مندوب مبيعات',               dept: 'SALES' },
  // Purchase
  { code: 'PURCH_MGR',   name: 'مدير المشتريات',             dept: 'PURCHASE' },
  { code: 'PURCH_OFF',   name: 'موظف مشتريات',               dept: 'PURCHASE' },
  // Warehouse
  { code: 'WH_MGR',      name: 'مدير المستودع',              dept: 'WH' },
  { code: 'WH_KEEPER',   name: 'أمين مستودع',                dept: 'WH' },
  // IT
  { code: 'IT_MGR',      name: 'مدير تقنية المعلومات',       dept: 'IT' },
  { code: 'IT_SUPPORT',  name: 'فني دعم فني',                dept: 'IT' },
  // Operations
  { code: 'OPS_MGR',     name: 'مدير العمليات',              dept: 'OPS' },
  { code: 'OPS_OFF',     name: 'موظف عمليات',                dept: 'OPS' },
  // QC
  { code: 'QC_MGR',      name: 'مدير الجودة',                dept: 'QC' },
  { code: 'QC_SPEC',     name: 'أخصائي جودة',                dept: 'QC' },
  // CS
  { code: 'CS_MGR',      name: 'مدير خدمة العملاء',          dept: 'CS' },
  { code: 'CS_AGENT',    name: 'ممثل خدمة عملاء',            dept: 'CS' },
];

const LEAVE_TYPES = [
  {
    code: 'ANNUAL',
    name: 'إجازة سنوية',
    annual_days: 30,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: true,
    max_carry_over_days: 10,
  },
  {
    code: 'SICK',
    name: 'إجازة مرضية',
    annual_days: 15,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'MATERNITY',
    name: 'إجازة أمومة',
    annual_days: 70,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'PATERNITY',
    name: 'إجازة أبوة',
    annual_days: 3,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'MARRIAGE',
    name: 'إجازة زواج',
    annual_days: 7,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'BEREAVEMENT',
    name: 'إجازة وفاة',
    annual_days: 5,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'HAJJ',
    name: 'إجازة حج',
    annual_days: 15,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'UNPAID',
    name: 'إجازة بدون راتب',
    annual_days: 0,
    is_paid: false,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
  {
    code: 'EMERGENCY',
    name: 'إجازة طارئة',
    annual_days: 3,
    is_paid: true,
    requires_approval: true,
    carry_over_allowed: false,
    max_carry_over_days: 0,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const log  = (msg) => console.log(`[seed-hr] ${msg}`);
const warn = (msg) => console.warn(`[seed-hr] ⚠️  ${msg}`);
const ok   = (msg) => console.log(`[seed-hr] ✅ ${msg}`);

// ═══════════════════════════════════════════════════════════════════════════
// Seed Departments
// ═══════════════════════════════════════════════════════════════════════════
const seedDepartments = async (client, companyId) => {
  let inserted = 0;
  let skipped  = 0;

  for (const dept of DEPARTMENTS) {
    const r = await client.query(
      `INSERT INTO departments (company_id, name, code, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (company_id, code) DO NOTHING
       RETURNING id`,
      [companyId, dept.name, dept.code]
    );
    if (r.rowCount) inserted++;
    else skipped++;
  }

  log(`الأقسام: ${inserted} جديد، ${skipped} موجود مسبقاً`);
  return { inserted, skipped };
};

// ═══════════════════════════════════════════════════════════════════════════
// Seed Job Titles
// ═══════════════════════════════════════════════════════════════════════════
const seedJobTitles = async (client, companyId) => {
  let inserted = 0;
  let skipped  = 0;
  let noDept   = 0;

  // خريطة: كود القسم → id
  const { rows: depts } = await client.query(
    `SELECT code, id FROM departments WHERE company_id = $1`,
    [companyId]
  );
  const deptMap = Object.fromEntries(depts.map(d => [d.code, d.id]));

  for (const jt of JOB_TITLES) {
    const deptId = deptMap[jt.dept] || null;
    if (!deptId) {
      noDept++;
      warn(`المسمى '${jt.name}' — القسم '${jt.dept}' غير موجود، سيُدرج بدون قسم`);
    }

    // لا يوجد unique على (company_id, name) في job_titles —
    // نفحص يدوياً لتجنب التكرار
    const exists = await client.query(
      `SELECT 1 FROM job_titles WHERE company_id = $1 AND name = $2 LIMIT 1`,
      [companyId, jt.name]
    );
    if (exists.rowCount) {
      skipped++;
      continue;
    }

    await client.query(
      `INSERT INTO job_titles (company_id, name, department_id, is_active)
       VALUES ($1, $2, $3, true)`,
      [companyId, jt.name, deptId]
    );
    inserted++;
  }

  log(`المسميات الوظيفية: ${inserted} جديد، ${skipped} موجود مسبقاً${noDept ? `، ${noDept} بدون قسم` : ''}`);
  return { inserted, skipped, noDept };
};

// ═══════════════════════════════════════════════════════════════════════════
// Seed Leave Types
// ═══════════════════════════════════════════════════════════════════════════
const seedLeaveTypes = async (client, companyId) => {
  let inserted = 0;
  let skipped  = 0;

  for (const lt of LEAVE_TYPES) {
    const r = await client.query(
      `INSERT INTO leave_types (
         company_id, name, code, annual_days, is_paid,
         requires_approval, carry_over_allowed, max_carry_over_days, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (company_id, code) DO NOTHING
       RETURNING id`,
      [
        companyId,
        lt.name,
        lt.code,
        lt.annual_days,
        lt.is_paid,
        lt.requires_approval,
        lt.carry_over_allowed,
        lt.max_carry_over_days,
      ]
    );
    if (r.rowCount) inserted++;
    else skipped++;
  }

  log(`أنواع الإجازات: ${inserted} جديد، ${skipped} موجود مسبقاً`);
  return { inserted, skipped };
};

// ═══════════════════════════════════════════════════════════════════════════
// Reset — حذف البيانات الافتراضية فقط (لا يمس الموظفين)
// ═══════════════════════════════════════════════════════════════════════════
const resetCompany = async (client, companyId) => {
  log(`⚠️  reset: حذف البيانات الافتراضية فقط (الأقسام/المسميات/الأنواع)`);

  // حذف المسميات
  const jtNames = JOB_TITLES.map(j => j.name);
  const rJt = await client.query(
    `DELETE FROM job_titles
      WHERE company_id = $1 AND name = ANY($2::text[])`,
    [companyId, jtNames]
  );
  log(`حُذفت ${rJt.rowCount} مسميات وظيفية`);

  // حذف الأقسام (بعد المسميات — لأن المسميات قد تُشير إليها)
  const deptCodes = DEPARTMENTS.map(d => d.code);
  const rDept = await client.query(
    `DELETE FROM departments
      WHERE company_id = $1 AND code = ANY($2::text[])`,
    [companyId, deptCodes]
  );
  log(`حُذفت ${rDept.rowCount} أقسام`);

  // حذف أنواع الإجازات (فقط غير المستخدمة)
  const ltCodes = LEAVE_TYPES.map(l => l.code);
  const rLt = await client.query(
    `DELETE FROM leave_types
      WHERE company_id = $1
        AND code = ANY($2::text[])
        AND id NOT IN (
          SELECT DISTINCT leave_type_id FROM leave_requests WHERE company_id = $1
        )
        AND id NOT IN (
          SELECT DISTINCT leave_type_id FROM leave_balances WHERE company_id = $1
        )`,
    [companyId, ltCodes]
  );
  log(`حُذفت ${rLt.rowCount} أنواع إجازات (المستخدمة لم تُمس)`);
};

// ═══════════════════════════════════════════════════════════════════════════
// Seed Company — تسلسل كامل لشركة واحدة
// ═══════════════════════════════════════════════════════════════════════════
const seedCompany = async (companyId, { reset = false } = {}) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // التحقق من الشركة
    const company = await client.query(
      `SELECT id, name FROM companies WHERE id = $1 AND is_active = true`,
      [companyId]
    );
    if (!company.rowCount) {
      throw new Error(`الشركة ${companyId} غير موجودة أو غير نشطة`);
    }

    log(`\n═══ Company: ${company.rows[0].name} (${companyId}) ═══`);

    if (reset) {
      await resetCompany(client, companyId);
    }

    // ترتيب مهم: الأقسام → المسميات (تحتاج أقسام) → الأنواع
    const deptStats = await seedDepartments(client, companyId);
    const jtStats   = await seedJobTitles(client, companyId);
    const ltStats   = await seedLeaveTypes(client, companyId);

    await client.query('COMMIT');
    transactionStarted = false;

    ok(`اكتملت الشركة: أقسام (${deptStats.inserted}+) | مسميات (${jtStats.inserted}+) | أنواع (${ltStats.inserted}+)`);
    return { companyId, deptStats, jtStats, ltStats };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[seed-hr] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════
const main = async () => {
  const args = process.argv.slice(2);

  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const hasFlag = (name) => args.includes(name);

  const companyId = getArg('--company');
  const all       = hasFlag('--all');
  const reset     = hasFlag('--reset');

  if (!companyId && !all) {
    console.error(`
الاستخدام:
  node scripts/seed-hr.js --company <uuid>          # لشركة واحدة
  node scripts/seed-hr.js --all                     # لكل الشركات النشطة
  node scripts/seed-hr.js --company <uuid> --reset  # حذف وإعادة إنشاء
    `);
    process.exit(1);
  }

  const startedAt = Date.now();
  log(`بدء تشغيل seed HR — ${new Date().toISOString()}`);

  try {
    if (companyId) {
      await seedCompany(companyId, { reset });
    } else {
      // --all
      const companies = await pool.query(
        `SELECT id, name FROM companies WHERE is_active = true ORDER BY created_at`
      );
      log(`عدد الشركات النشطة: ${companies.rowCount}`);

      if (!companies.rowCount) {
        warn('لا توجد شركات نشطة — لا شيء لتنفيذه');
        process.exit(0);
      }

      let success = 0, failed = 0;
      for (const c of companies.rows) {
        try {
          await seedCompany(c.id, { reset });
          success++;
        } catch (err) {
          console.error(`[seed-hr] ❌ فشل للشركة ${c.name} (${c.id}):`, err.message);
          failed++;
        }
      }
      log(`\nالنتيجة النهائية: ${success} نجحت، ${failed} فشلت`);
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
    ok(`\nانتهى seed-hr في ${elapsed} ثانية`);
    process.exit(0);
  } catch (err) {
    console.error('[seed-hr] ❌ خطأ فادح:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
};

main();