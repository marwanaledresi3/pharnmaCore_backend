#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * MIGRATE SETTINGS
 * ═══════════════════════════════════════════════════════════════
 * 
 * يطبّق الإعدادات الافتراضية الجديدة على كل الشركات الموجودة.
 * 
 * - آمن: لا يمس القيم الموجودة (ON CONFLICT DO NOTHING)
 * - قابل للتشغيل أكثر من مرة
 * - يدعم dry-run للمعاينة
 * 
 * الاستخدام:
 *   node scripts/migrate-settings.js
 *   node scripts/migrate-settings.js --dry-run
 *   node scripts/migrate-settings.js --company <uuid>
 *   node scripts/migrate-settings.js --verbose
 */

require('dotenv').config();
const { pool } = require('../config/pool');
const settingsService = require('../services/settingsService');
const defaultSettings = require('../data/defaultSettings');

// ═══════════════════════════════════════════════════════════════
// CLI Args
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

const companyArgIdx = args.indexOf('--company');
const ONLY_COMPANY = companyArgIdx >= 0 ? args[companyArgIdx + 1] : null;

if (companyArgIdx >= 0 && !ONLY_COMPANY) {
  console.error('❌ --company requires a UUID argument');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// Helpers
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
};

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
// Main
// ═══════════════════════════════════════════════════════════════

async function migrate() {
  const startedAt = Date.now();

  log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  🔄 Settings Migration${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.dim}  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}${colors.reset}`);
  if (ONLY_COMPANY) log(`${colors.dim}  Filter: company = ${ONLY_COMPANY}${colors.reset}`);
  log('');

  // ─── 1) جلب الشركات ─────────────────────────────────────────
  let companiesQuery = `SELECT id, name, created_at FROM companies ORDER BY created_at ASC`;
  const queryParams = [];

  if (ONLY_COMPANY) {
    companiesQuery = `SELECT id, name, created_at FROM companies WHERE id = $1`;
    queryParams.push(ONLY_COMPANY);
  }

  const { rows: companies } = await pool.query(companiesQuery, queryParams);

  if (companies.length === 0) {
    log(`${colors.yellow}⚠️  No companies found.${colors.reset}\n`);
    return;
  }

  log(`📋 Found ${colors.bright}${companies.length}${colors.reset} company/companies.\n`);

  // ─── 2) إحصاءات ──────────────────────────────────────────────
  const stats = {
    companiesProcessed: 0,
    companiesUnchanged: 0,
    companiesWithErrors: 0,
    totalKeysChecked: 0,
    totalKeysInserted: 0,
    totalKeysSkipped: 0,
  };

  const allDefaultKeys = defaultSettings.map((s) => s.key);
  log(`${colors.dim}Default settings: ${allDefaultKeys.length} keys${colors.reset}\n`);

  // ─── 3) معالجة كل شركة ──────────────────────────────────────
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const idx = `[${i + 1}/${companies.length}]`;

    try {
      stats.companiesProcessed++;

      // جلب المفاتيح الموجودة
      const existing = await settingsService.getAll(company.id);
      const existingKeys = Object.keys(existing);

      // المفاتيح الناقصة
      const missingKeys = allDefaultKeys.filter((k) => !existingKeys.includes(k));
      stats.totalKeysChecked += allDefaultKeys.length;

      if (missingKeys.length === 0) {
        stats.companiesUnchanged++;
        stats.totalKeysSkipped += allDefaultKeys.length;
        log(`${idx} ${colors.dim}${company.name} — no changes${colors.reset}`);
        continue;
      }

      if (DRY_RUN) {
        // في dry-run: نحسب فقط
        stats.totalKeysInserted += missingKeys.length;
        log(
          `${idx} ${colors.yellow}[DRY]${colors.reset} ${company.name} — would add ${colors.bright}${missingKeys.length}${colors.reset} key(s)`
        );
        if (VERBOSE) {
          missingKeys.forEach((k) => logVerbose(`+ ${k}`));
        }
      } else {
        // تطبيق فعلي
        const result = await settingsService.initDefaults(pool, company.id);
        // initDefaults لا تعيد عدد المُضاف، فنحسب يدوياً
        const after = await settingsService.getAll(company.id);
        const afterKeys = Object.keys(after);
        const added = afterKeys.filter((k) => !existingKeys.includes(k)).length;

        stats.totalKeysInserted += added;

        if (added > 0) {
          log(
            `${idx} ${colors.green}✅${colors.reset} ${company.name} — added ${colors.bright}${added}${colors.reset} key(s)`
          );
          if (VERBOSE) {
            const newKeys = afterKeys.filter((k) => !existingKeys.includes(k));
            newKeys.forEach((k) => logVerbose(`+ ${k}`));
          }
        } else {
          stats.companiesUnchanged++;
          log(`${idx} ${colors.dim}${company.name} — no changes${colors.reset}`);
        }
      }
    } catch (err) {
      stats.companiesWithErrors++;
      log(
        `${idx} ${colors.red}❌${colors.reset} ${company.name} (${company.id}) — ${colors.red}${err.message}${colors.reset}`
      );
      logVerbose(err.stack);
    }
  }

  // ─── 4) التقرير النهائي ─────────────────────────────────────
  const duration = formatDuration(Date.now() - startedAt);

  log('');
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  📊 Summary${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`  Companies processed : ${colors.bright}${stats.companiesProcessed}${colors.reset}`);
  log(`  Companies unchanged : ${stats.companiesUnchanged}`);
  log(`  Companies w/ errors : ${stats.companiesWithErrors > 0 ? colors.red + stats.companiesWithErrors + colors.reset : '0'}`);
  log('');
  log(`  Keys checked        : ${stats.totalKeysChecked}`);
  log(`  Keys inserted       : ${colors.bright}${colors.green}${stats.totalKeysInserted}${colors.reset}`);
  log(`  Keys skipped        : ${stats.totalKeysSkipped}`);
  log('');
  log(`  Duration            : ${duration}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}\n`);

  if (DRY_RUN) {
    log(`${colors.yellow}💡 This was a DRY RUN. Run without --dry-run to apply changes.${colors.reset}\n`);
  }

  if (stats.companiesWithErrors > 0) {
    log(`${colors.yellow}⚠️  ${stats.companiesWithErrors} company/companies had errors. Review above.${colors.reset}\n`);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

migrate()
  .then((stats) => {
    const exitCode = stats?.companiesWithErrors > 0 ? 1 : 0;
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error(`\n${colors.red}❌ Migration failed:${colors.reset}`, err);
    console.error(colors.dim, err.stack, colors.reset);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });