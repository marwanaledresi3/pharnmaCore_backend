#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * SEED JOB TITLES — لكل الشركات
 * ═══════════════════════════════════════════════════════════════
 *
 * يزرع المسميات الوظيفية في جدول `job_titles` لكل شركة موجودة.
 * Idempotent: يمكن تشغيله أكثر من مرة بأمان.
 *
 * المفتاح المنطقي للتمييز: (company_id, name)
 * - يضيف مسميات جديدة
 * - يُحدّث department_id / description / is_active للموجود
 * - لا يحذف شيئاً
 *
 * الاستخدام:
 *   node scripts/seed-job-titles.js                 # كل الشركات
 *   node scripts/seed-job-titles.js --dry-run       # معاينة
 *   node scripts/seed-job-titles.js --verbose       # تفاصيل
 *   node scripts/seed-job-titles.js --company-id=1  # شركة واحدة
 *
 * ملاحظات:
 * - يتطلب وجود الأقسام مسبقاً (شغّل seed-departments.js أولاً)
 * - يُفضّل UNIQUE(company_id, name) على job_titles:
 *     ALTER TABLE job_titles
 *       ADD CONSTRAINT job_titles_company_name_unique UNIQUE (company_id, name);
 *   بدون القيد، الكود يعمل لكن بطبقة تحقق برمجية فقط (غير آمنة ضد التزامن).
 */

require('dotenv').config();
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════
// CLI Args
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function getArg(name) {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const ONLY_COMPANY_ID = getArg('company-id');

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
// ⚠️ المصدر الوحيد للحقيقة — المسميات الوظيفية
// ═══════════════════════════════════════════════════════════════
//
// name            : اسم المسمى (مفتاح التمييز داخل الشركة)
// department_code : كود القسم من seed-departments.js (يُترجم إلى department_id)
//                   إن لم يوجد القسم → department_id = null
// description     : وصف (اختياري)

const JOB_TITLES = [
  // ─── الإدارة العليا ───
  { name: 'المدير العام',              department_code: 'management',       description: 'الرئيس التنفيذي للشركة' },
  { name: 'نائب المدير العام',          department_code: 'management',       description: null },
  { name: 'مدير إداري',                department_code: 'administration',   description: null },
  { name: 'سكرتير تنفيذي',             department_code: 'administration',   description: null },
  { name: 'مدير الموارد البشرية',       department_code: 'hr',               description: null },
  { name: 'أخصائي توظيف',              department_code: 'hr',               description: null },
  { name: 'أخصائي رواتب',              department_code: 'hr',               description: null },
  { name: 'مستشار قانوني',             department_code: 'legal',            description: null },
  { name: 'مدير تقنية المعلومات',       department_code: 'it',               description: null },
  { name: 'مهندس شبكات',               department_code: 'it',               description: null },
  { name: 'مطور برمجيات',              department_code: 'it',               description: null },
  { name: 'أخصائي دعم فني',            department_code: 'it',               description: null },

  // ─── المالية ───
  { name: 'المدير المالي',             department_code: 'finance',          description: null },
  { name: 'محاسب عام',                 department_code: 'accounting',       description: null },
  { name: 'محاسب تكاليف',              department_code: 'accounting',       description: null },
  { name: 'أمين صندوق',                department_code: 'treasury',         description: null },
  { name: 'أخصائي حسابات دائنة',       department_code: 'payables',         description: null },
  { name: 'أخصائي حسابات مدينة',       department_code: 'receivables',      description: null },
  { name: 'مدقق داخلي',                department_code: 'audit',            description: null },
  { name: 'أخصائي ضرائب',              department_code: 'tax',              description: null },

  // ─── المبيعات والتسويق ───
  { name: 'مدير المبيعات',             department_code: 'sales',            description: null },
  { name: 'مندوب مبيعات',              department_code: 'sales',            description: null },
  { name: 'مدير تسويق',                department_code: 'marketing',        description: null },
  { name: 'أخصائي تسويق رقمي',         department_code: 'marketing',        description: null },
  { name: 'ممثل خدمة عملاء',           department_code: 'customer_service', description: null },
  { name: 'أخصائي علاقات عملاء',       department_code: 'crm',              description: null },

  // ─── المشتريات ───
  { name: 'مدير المشتريات',            department_code: 'purchasing',       description: null },
  { name: 'مسؤول مشتريات',             department_code: 'purchasing',       description: null },
  { name: 'أخصائي توريد',              department_code: 'procurement',      description: null },
  { name: 'أخصائي موردين',             department_code: 'supplier_mgmt',    description: null },

  // ─── المخازن واللوجستيات ───
  { name: 'مدير المستودعات',           department_code: 'warehousing',      description: null },
  { name: 'أمين مستودع',               department_code: 'warehousing',      description: null },
  { name: 'أخصائي مخزون',              department_code: 'inventory',        description: null },
  { name: 'منسق لوجستي',               department_code: 'logistics',        description: null },
  { name: 'مسؤول شحن',                 department_code: 'shipping',         description: null },

  // ─── الإنتاج ───
  { name: 'مدير الإنتاج',              department_code: 'production',       description: null },
  { name: 'مشرف خط إنتاج',             department_code: 'production',       description: null },
  { name: 'فني إنتاج',                 department_code: 'production',       description: null },
  { name: 'مراقب جودة',                department_code: 'quality_control',  description: null },
  { name: 'فني صيانة',                 department_code: 'maintenance',      description: null },

  // ─── العمليات والفروع ───
  { name: 'مدير العمليات',             department_code: 'operations',       description: null },
  { name: 'مدير فرع',                  department_code: 'branches',         description: null },
  { name: 'مشرف فرع',                  department_code: 'branches',         description: null },

  // ─── الأصول والعهد ───
  { name: 'أخصائي أصول ثابتة',         department_code: 'fixed_assets',     description: null },
  { name: 'أمين عهدة',                 department_code: 'custody',          description: null },
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

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ═══════════════════════════════════════════════════════════════
// Seed one company
// ═══════════════════════════════════════════════════════════════

async function seedForCompany(client, company) {
  log(`${colors.bright}🏢 ${company.name}${colors.reset} ${colors.dim}(id=${company.id})${colors.reset}`);

  // ─── 1) خريطة code → id لأقسام هذه الشركة ───
  const { rows: deptRows } = await client.query(
    `SELECT id, code FROM departments
      WHERE company_id = $1 AND code IS NOT NULL`,
    [company.id]
  );
  const deptCodeToId = new Map();
  for (const d of deptRows) deptCodeToId.set(d.code, d.id);

  if (deptRows.length === 0) {
    log(`   ${colors.yellow}⚠ لا توجد أقسام لهذه الشركة — شغّل seed-departments.js أولاً${colors.reset}`);
  }

  // ─── 2) جلب المسميات الموجودة لهذه الشركة ───
  const { rows: existing } = await client.query(
    `SELECT id, name, department_id, description, is_active
       FROM job_titles
      WHERE company_id = $1`,
    [company.id]
  );
  const existingByName = new Map();
  for (const e of existing) existingByName.set(e.name, e);

  // ─── 3) تحليل ───
  const stats = {
    toInsert: [],
    toUpdate: [],
    unchanged: 0,
    inDbOnly: [],
    missingDepartments: [],
  };

  for (const jt of JOB_TITLES) {
    // حل department_id
    let departmentId = null;
    if (jt.department_code) {
      departmentId = deptCodeToId.get(jt.department_code) ?? null;
      if (departmentId === null) {
        stats.missingDepartments.push({ jt, department_code: jt.department_code });
        // نكمل بـ null بدل التخطي — المسمى يُدرج بدون قسم
      }
    }

    const ex = existingByName.get(jt.name);
    if (!ex) {
      stats.toInsert.push({ ...jt, department_id: departmentId });
    } else {
      const same =
        ex.department_id === departmentId &&
        (ex.description ?? null) === (jt.description ?? null) &&
        (ex.is_active ?? true) === true;
      if (same) {
        stats.unchanged++;
      } else {
        stats.toUpdate.push({ old: ex, new: { ...jt, department_id: departmentId } });
      }
    }
  }

  // موجودة في DB وليست في المصدر
  const sourceNames = new Set(JOB_TITLES.map((j) => j.name));
  for (const ex of existing) {
    if (!sourceNames.has(ex.name)) stats.inDbOnly.push(ex);
  }

  // ─── 4) ملخص قبل التنفيذ ───
  log(
    `   ${colors.green}+${stats.toInsert.length}${colors.reset} ` +
    `${colors.yellow}~${stats.toUpdate.length}${colors.reset} ` +
    `${colors.dim}=${stats.unchanged}${colors.reset}` +
    (stats.inDbOnly.length ? ` ${colors.magenta}?${stats.inDbOnly.length}${colors.reset}` : '') +
    (stats.missingDepartments.length ? ` ${colors.red}✖${stats.missingDepartments.length}${colors.reset}` : '')
  );

  if (DRY_RUN) {
    if (VERBOSE) {
      for (const j of stats.toInsert) {
        const d = j.department_id ? `dept_id=${j.department_id}` : 'no-dept';
        log(`      ${colors.green}+ ${j.name}${colors.reset} (${d})`);
      }
      for (const u of stats.toUpdate) {
        log(`      ${colors.yellow}~ ${u.new.name}${colors.reset}`);
        if (u.old.department_id !== u.new.department_id) {
          log(`          department_id: ${u.old.department_id} → ${u.new.department_id}`);
        }
        if ((u.old.description ?? null) !== (u.new.description ?? null)) {
          log(`          description: "${u.old.description ?? ''}" → "${u.new.description ?? ''}"`);
        }
      }
      for (const m of stats.missingDepartments) {
        log(`      ${colors.red}✖ ${m.jt.name}${colors.reset} (dept_code=${m.department_code} غير موجود → department_id=null)`);
      }
    }
    return stats;
  }

  // ─── 5) تنفيذ ───
  // INSERT
  for (const j of stats.toInsert) {
    await client.query(
      `INSERT INTO job_titles (company_id, name, department_id, description, is_active)
       VALUES ($1, $2, $3, $4, COALESCE($5, true))
       ON CONFLICT (company_id, name) DO NOTHING`,
      [company.id, j.name, j.department_id, j.description ?? null, true]
    );
    logVerbose(`+ ${j.name}`);
  }

  // UPDATE
  for (const u of stats.toUpdate) {
    await client.query(
      `UPDATE job_titles
          SET department_id = $1,
              description   = $2
        WHERE company_id = $3
          AND name = $4`,
      [u.new.department_id, u.new.description ?? null, company.id, u.new.name]
    );
    logVerbose(`~ ${u.new.name}`);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function seed() {
  const startedAt = Date.now();

  log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  🌱 Seed Job Titles — All Companies${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.dim}  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}${colors.reset}`);
  log(`${colors.dim}  Job titles per company: ${JOB_TITLES.length}${colors.reset}`);
  log('');

  const client = await pool.connect();
  let companies = [];
  const summary = {
    companiesProcessed: 0,
    totalInserted: 0,
    totalUpdated: 0,
    totalUnchanged: 0,
    totalInDbOnly: 0,
    totalMissingDepartments: 0,
    failures: [],
  };

  try {
    // ─── جلب الشركات ───
    let q = `SELECT id, name, code FROM companies`;
    let params = [];
    if (ONLY_COMPANY_ID) {
      q += ` WHERE id = $1`;
      params = [ONLY_COMPANY_ID];
    }
    q += ` ORDER BY id ASC`;

    const { rows } = await client.query(q, params);
    companies = rows;

    if (companies.length === 0) {
      log(`${colors.yellow}⚠  لا توجد شركات${ONLY_COMPANY_ID ? ` بالمعرّف ${ONLY_COMPANY_ID}` : ''}.${colors.reset}\n`);
      return summary;
    }

    log(`📊 Companies to process: ${colors.bright}${companies.length}${colors.reset}\n`);

    // ─── التنفيذ ───
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      log(`${colors.dim}[${i + 1}/${companies.length}]${colors.reset}`);
      log('');

      try {
        if (!DRY_RUN) await client.query('BEGIN');

        const stats = await seedForCompany(client, company);

        if (!DRY_RUN) await client.query('COMMIT');

        summary.companiesProcessed++;
        summary.totalInserted += stats.toInsert.length;
        summary.totalUpdated += stats.toUpdate.length;
        summary.totalUnchanged += stats.unchanged;
        summary.totalInDbOnly += stats.inDbOnly.length;
        summary.totalMissingDepartments += stats.missingDepartments.length;
      } catch (err) {
        if (!DRY_RUN) {
          try { await client.query('ROLLBACK'); } catch (_) {}
        }
        summary.failures.push({ company, error: err.message || String(err) });
        log(`   ${colors.red}❌ فشل: ${err.message || err}${colors.reset}`);
      }

      log('');
    }
  } finally {
    client.release();
  }

  // ─── التقرير النهائي ───
  const duration = formatDuration(Date.now() - startedAt);

  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  📊 Summary${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`  Companies processed : ${summary.companiesProcessed}/${companies.length}`);
  log(`  Inserted            : ${colors.green}${colors.bright}${summary.totalInserted}${colors.reset}`);
  log(`  Updated             : ${colors.yellow}${summary.totalUpdated}${colors.reset}`);
  log(`  Unchanged           : ${summary.totalUnchanged}`);
  if (summary.totalInDbOnly > 0) {
    log(`  In DB only          : ${colors.magenta}${summary.totalInDbOnly}${colors.reset} (not deleted)`);
  }
  if (summary.totalMissingDepartments > 0) {
    log(`  Missing departments : ${colors.red}${summary.totalMissingDepartments}${colors.reset} (dept_id=null)`);
  }
  if (summary.failures.length > 0) {
    log(`  ${colors.red}Failures            : ${summary.failures.length}${colors.reset}`);
    for (const f of summary.failures) {
      log(`    ❌ ${f.company.name} (id=${f.company.id}): ${f.error}`);
    }
  }
  log(`  Duration            : ${duration}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}\n`);

  if (DRY_RUN) {
    log(`${colors.yellow}💡 This was a DRY RUN. Run without --dry-run to apply.${colors.reset}\n`);
  }

  if (summary.failures.length > 0) process.exitCode = 1;
  return summary;
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

seed()
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error(`\n${colors.red}❌ Seed failed:${colors.reset}`, err.message || err);
    if (VERBOSE && err.stack) console.error(colors.dim, err.stack, colors.reset);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });