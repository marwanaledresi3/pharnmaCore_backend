#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * SEED DEPARTMENTS — لكل الشركات
 * ═══════════════════════════════════════════════════════════════
 *
 * يزرع الأقسام في جدول `departments` لكل شركة موجودة في `companies`.
 * Idempotent: يمكن تشغيله أكثر من مرة بأمان.
 *
 * - يمر على كل شركة (أو شركة محددة عبر --company-id)
 * - يضيف أقسام جديدة لكل شركة
 * - يُحدّث name / parent_id للأقسام الموجودة
 * - لا يحذف شيئاً
 *
 * الاستخدام:
 *   node scripts/seed-departments.js                 # كل الشركات
 *   node scripts/seed-departments.js --dry-run       # معاينة فقط
 *   node scripts/seed-departments.js --verbose       # تفاصيل
 *   node scripts/seed-departments.js --company-id=1  # شركة واحدة فقط
 *
 * ملاحظة: يتطلب UNIQUE(company_id, code) على جدول departments:
 *   ALTER TABLE departments
 *     ADD CONSTRAINT departments_company_code_unique UNIQUE (company_id, code);
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

const ONLY_COMPANY_ID = getArg('company-id'); // اختياري

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
// ⚠️ المصدر الوحيد للحقيقة — أقسام كل شركة
// ═══════════════════════════════════════════════════════════════
//
// code       : مفتاح فريد داخل الشركة (ON CONFLICT company_id+code)
// name       : الاسم العربي
// parent_code: كود القسم الأب (اختياري) — يُترجم إلى parent_id
//
// ⚠️ عدّل هذه القائمة حسب أقسام شركتك الفعلية.

const DEPARTMENTS = [
  // ─── الإدارة العليا ───
  { code: 'management',       name: 'الإدارة العامة',       parent_code: null },
  { code: 'administration',   name: 'الشؤون الإدارية',       parent_code: 'management' },
  { code: 'hr',               name: 'الموارد البشرية',       parent_code: 'management' },
  { code: 'legal',            name: 'الشؤون القانونية',      parent_code: 'management' },
  { code: 'it',               name: 'تقنية المعلومات',       parent_code: 'management' },

  // ─── المالية ───
  { code: 'finance',          name: 'الإدارة المالية',       parent_code: 'management' },
  { code: 'accounting',       name: 'المحاسبة',              parent_code: 'finance' },
  { code: 'treasury',         name: 'الخزينة',               parent_code: 'finance' },
  { code: 'payables',         name: 'الحسابات الدائنة',      parent_code: 'finance' },
  { code: 'receivables',      name: 'الحسابات المدينة',      parent_code: 'finance' },
  { code: 'audit',            name: 'التدقيق الداخلي',       parent_code: 'finance' },
  { code: 'tax',              name: 'الضرائب',               parent_code: 'finance' },

  // ─── المبيعات والتسويق ───
  { code: 'sales',            name: 'المبيعات',              parent_code: null },
  { code: 'marketing',        name: 'التسويق',               parent_code: 'sales' },
  { code: 'customer_service', name: 'خدمة العملاء',          parent_code: 'sales' },
  { code: 'crm',              name: 'إدارة علاقات العملاء',   parent_code: 'sales' },

  // ─── المشتريات ───
  { code: 'purchasing',       name: 'المشتريات',             parent_code: null },
  { code: 'procurement',      name: 'التوريد',               parent_code: 'purchasing' },
  { code: 'supplier_mgmt',    name: 'إدارة الموردين',        parent_code: 'purchasing' },

  // ─── المخازن واللوجستيات ───
  { code: 'warehousing',      name: 'المستودعات',            parent_code: null },
  { code: 'inventory',        name: 'إدارة المخزون',         parent_code: 'warehousing' },
  { code: 'logistics',        name: 'اللوجستيات',            parent_code: 'warehousing' },
  { code: 'shipping',         name: 'الشحن',                 parent_code: 'warehousing' },

  // ─── الإنتاج ───
  { code: 'production',       name: 'الإنتاج',               parent_code: null },
  { code: 'quality_control',  name: 'مراقبة الجودة',         parent_code: 'production' },
  { code: 'maintenance',      name: 'الصيانة',               parent_code: 'production' },

  // ─── العمليات والفروع ───
  { code: 'operations',       name: 'العمليات',              parent_code: null },
  { code: 'branches',         name: 'الفروع',                parent_code: 'operations' },

  // ─── الأصول والعهد ───
  { code: 'fixed_assets',     name: 'الأصول الثابتة',        parent_code: 'finance' },
  { code: 'custody',          name: 'العهد',                 parent_code: 'finance' },
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

// ترتيب: الآباء (الجذور) أولاً ثم الأبناء
const SORTED_DEPARTMENTS = [...DEPARTMENTS].sort((a, b) => {
  const aRoot = a.parent_code ? 1 : 0;
  const bRoot = b.parent_code ? 1 : 0;
  return aRoot - bRoot;
});

// ═══════════════════════════════════════════════════════════════
// Seed one company
// ═══════════════════════════════════════════════════════════════

async function seedForCompany(client, company) {
  log(`${colors.bright}🏢 ${company.name}${colors.reset} ${colors.dim}(id=${company.id})${colors.reset}`);

  // ─── 1) جلب أقسام الشركة الحالية ───
  const { rows: existing } = await client.query(
    `SELECT id, code, name, parent_id, manager_id, is_active
       FROM departments
      WHERE company_id = $1`,
    [company.id]
  );

  const existingByCode = new Map();
  const codeToId = new Map();
  for (const e of existing) {
    if (e.code) {
      existingByCode.set(e.code, e);
      codeToId.set(e.code, e.id);
    }
  }

  // ─── 2) تحليل ───
  const stats = {
    toInsert: [],
    toUpdate: [],
    unchanged: 0,
    inDbOnly: [],
    missingParents: [],
  };

  for (const d of SORTED_DEPARTMENTS) {
    // حل parent_id
    let parentId = null;
    if (d.parent_code) {
      parentId = codeToId.get(d.parent_code) ?? null;
      if (parentId === null) {
        stats.missingParents.push({ dept: d, parent_code: d.parent_code });
        continue;
      }
    }

    const ex = existingByCode.get(d.code);
    if (!ex) {
      stats.toInsert.push({ ...d, parent_id: parentId });
    } else {
      const same =
        ex.name === d.name &&
        ex.parent_id === parentId &&
        (ex.is_active ?? true) === true;
      if (same) {
        stats.unchanged++;
      } else {
        stats.toUpdate.push({ old: ex, new: { ...d, parent_id: parentId } });
      }
    }
  }

  // أقسام في DB ليست في المصدر
  const sourceCodes = new Set(DEPARTMENTS.map((d) => d.code));
  for (const ex of existing) {
    if (ex.code && !sourceCodes.has(ex.code)) {
      stats.inDbOnly.push(ex);
    }
  }

  // ─── 3) ملخص قبل التنفيذ ───
  log(
    `   ${colors.green}+${stats.toInsert.length}${colors.reset} ` +
    `${colors.yellow}~${stats.toUpdate.length}${colors.reset} ` +
    `${colors.dim}=${stats.unchanged}${colors.reset}` +
    (stats.inDbOnly.length ? ` ${colors.magenta}?${stats.inDbOnly.length}${colors.reset}` : '') +
    (stats.missingParents.length ? ` ${colors.red}✖${stats.missingParents.length}${colors.reset}` : '')
  );

  if (DRY_RUN) {
    if (VERBOSE) {
      for (const d of stats.toInsert) {
        log(`      ${colors.green}+ ${d.code}${colors.reset} → "${d.name}"`);
      }
      for (const u of stats.toUpdate) {
        log(`      ${colors.yellow}~ ${u.new.code}${colors.reset}`);
        if (u.old.name !== u.new.name) {
          log(`          name: "${u.old.name}" → "${u.new.name}"`);
        }
        if (u.old.parent_id !== u.new.parent_id) {
          log(`          parent_id: ${u.old.parent_id} → ${u.new.parent_id}`);
        }
      }
      for (const m of stats.missingParents) {
        log(`      ${colors.red}✖ ${m.dept.code}${colors.reset} (parent=${m.parent_code})`);
      }
    }
    return stats;
  }

  // ─── 4) تنفيذ ───
  // INSERT
  for (const d of stats.toInsert) {
    const r = await client.query(
      `INSERT INTO departments (company_id, name, code, parent_id, manager_id, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       ON CONFLICT (company_id, code) DO NOTHING
       RETURNING id`,
      [company.id, d.name, d.code, d.parent_id, null, true]
    );
    if (r.rows[0]) {
      codeToId.set(d.code, r.rows[0].id);
      logVerbose(`+ ${d.code} (id=${r.rows[0].id})`);
    } else {
      // موجود مسبقاً (سباق) — نجلب id
      const { rows } = await client.query(
        `SELECT id FROM departments WHERE company_id = $1 AND code = $2`,
        [company.id, d.code]
      );
      if (rows[0]) codeToId.set(d.code, rows[0].id);
      logVerbose(`= ${d.code} (already existed)`);
    }
  }

  // UPDATE
  for (const u of stats.toUpdate) {
    await client.query(
      `UPDATE departments
          SET name = $1,
              parent_id = $2
        WHERE company_id = $3
          AND code = $4`,
      [u.new.name, u.new.parent_id, company.id, u.new.code]
    );
    logVerbose(`~ ${u.new.code}`);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function seed() {
  const startedAt = Date.now();

  log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  🌱 Seed Departments — All Companies${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.dim}  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}${colors.reset}`);
  log(`${colors.dim}  Departments per company: ${DEPARTMENTS.length}${colors.reset}`);
  log('');

  const client = await pool.connect();
  let companies = [];
  const summary = {
    companiesProcessed: 0,
    totalInserted: 0,
    totalUpdated: 0,
    totalUnchanged: 0,
    totalInDbOnly: 0,
    totalMissingParents: 0,
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

    // ─── التنفيذ: كل شركة داخل transaction مستقلة ───
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      log(`${colors.dim}[${i + 1}/${companies.length}]${colors.reset}`, end='');
      log(''); // سطر جديد (Node لا يدعم end في console.log)

      try {
        if (!DRY_RUN) {
          await client.query('BEGIN');
        }

        const stats = await seedForCompany(client, company);

        if (!DRY_RUN) {
          await client.query('COMMIT');
        }

        summary.companiesProcessed++;
        summary.totalInserted += stats.toInsert.length;
        summary.totalUpdated += stats.toUpdate.length;
        summary.totalUnchanged += stats.unchanged;
        summary.totalInDbOnly += stats.inDbOnly.length;
        summary.totalMissingParents += stats.missingParents.length;
      } catch (err) {
        if (!DRY_RUN) {
          try {
            await client.query('ROLLBACK');
          } catch (_) {
            // ignore
          }
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
  if (summary.totalMissingParents > 0) {
    log(`  Missing parents     : ${colors.red}${summary.totalMissingParents}${colors.reset} (skipped)`);
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

  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }

  return summary;
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

seed()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((err) => {
    console.error(`\n${colors.red}❌ Seed failed:${colors.reset}`, err.message || err);
    if (VERBOSE && err.stack) {
      console.error(colors.dim, err.stack, colors.reset);
    }
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });