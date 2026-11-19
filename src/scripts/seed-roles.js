#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * SEED ROLES & PERMISSIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * يزرع الأدوار الافتراضية لكل الشركات ويربطها بالصلاحيات في `role_permissions`.
 * Idempotent: يمكن تشغيله أكثر من مرة بأمان.
 *
 * الاستخدام:
 *   node scripts/seed-roles.js
 *   node scripts/seed-roles.js --dry-run
 *   node scripts/seed-roles.js --verbose
 */

require('dotenv').config();
const { pool } = require('../config/pool');
const defaultRoles = require('../data/defaultRoles'); // مسار ملف الأدوار الافتراضية

// ═══════════════════════════════════════════════════════════════
// CLI Args & Colors
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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
// Main Seed Function
// ═══════════════════════════════════════════════════════════════

async function seedRoles() {
  const startedAt = Date.now();

  log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.bright}${colors.cyan}  🌱 Seed Roles & Permissions Mapping${colors.reset}`);
  log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  log(`${colors.dim}  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}${colors.reset}\n`);

  const client = await pool.connect();
  try {
    // 1) جلب جميع الشركات في النظام
    const { rows: companies } = await client.query(`SELECT id, name FROM companies WHERE is_active = true`);
    if (companies.length === 0) {
      log(`${colors.yellow}⚠️ No active companies found in database. Aborting role seeding.${colors.reset}\n`);
      return;
    }

    log(`🏢 Found active companies: ${colors.bright}${companies.length}${colors.reset}`);

    // 2) جلب جميع الصلاحيات الموجودة في جدول permissions وخريطة للأكواد مقابل الـ IDs
    const { rows: allPermissions } = await client.query(`SELECT id, code FROM permissions`);
    const permMap = new Map();
    for (const p of allPermissions) {
      permMap.set(p.code, p.id);
    }

    log(`📋 Total permissions available in DB: ${colors.bright}${allPermissions.length}${colors.reset}\n`);

    if (!DRY_RUN) {
      await client.query('BEGIN');
    }

    let totalRolesProcessed = 0;
    let totalAssignments = 0;

    // 3) المرور على كل شركة وتطبيق الأدوار الافتراضية
    for (const company of companies) {
      log(` 📁 Processing company: ${colors.bright}${company.name}${colors.reset} (${company.id})`);

      for (const roleDef of defaultRoles) {
        // أ) إدخال أو تحديث الدور في جدول roles
        let roleId;
        if (!DRY_RUN) {
          const roleResult = await client.query(
            `INSERT INTO roles (company_id, name, description, is_system)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (company_id, name) 
             DO UPDATE SET description = EXCLUDED.description, is_system = EXCLUDED.is_system
             RETURNING id`,
            [company.id, roleDef.name, roleDef.description, roleDef.is_system]
          );
          roleId = roleResult.rows[0].id;
        }

        logVerbose(`   - Role: ${roleDef.name} (${roleDef.is_system ? 'System' : 'Custom'})`);

        // ب) تحديد الصلاحيات المطلوبة لهذا الدور
        let targetPermissionIds = [];
        if (roleDef.permissions === '*') {
          // إذا كانت '*' يعني كل الصلاحيات المتاحة
          targetPermissionIds = allPermissions.map((p) => p.id);
        } else if (Array.isArray(roleDef.permissions)) {
          for (const code of roleDef.permissions) {
            const pId = permMap.get(code);
            if (pId) {
              targetPermissionIds.push(pId);
            } else {
              logVerbose(`     ⚠️ Warning: Permission code "${code}" not found in DB permissions table.`);
            }
          }
        }

        // ج) ربط الصلاحيات بالدور في جدول role_permissions (Idempotent)
        if (!DRY_RUN && roleId) {
          // حذف الربط القديم لتنظيفه أو الاعتماد على ON CONFLICT DO NOTHING للإضافة الذكية
          for (const pId of targetPermissionIds) {
            await client.query(
              `INSERT INTO role_permissions (role_id, permission_id)
               VALUES ($1, $2)
               ON CONFLICT (role_id, permission_id) DO NOTHING`,
              [roleId, pId]
            );
            totalAssignments++;
          }
        }

        totalRolesProcessed++;
        logVerbose(`     -> Assigned ${targetPermissionIds.length} permissions.`);
      }
    }

    if (!DRY_RUN) {
      await client.query('COMMIT');
    }

    const duration = formatDuration(Date.now() - startedAt);

    log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
    log(`${colors.bright}${colors.cyan}  📊 Summary${colors.reset}`);
    log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
    log(`  Companies processed : ${colors.green}${companies.length}${colors.reset}`);
    log(`  Roles processed     : ${colors.green}${totalRolesProcessed}${colors.reset}`);
    log(`  Permission links    : ${colors.green}${totalAssignments}${colors.reset}`);
    log(`  Duration            : ${duration}`);
    log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}\n`);

    if (DRY_RUN) {
      log(`${colors.yellow}💡 This was a DRY RUN. Run without --dry-run to apply changes to database.${colors.reset}\n`);
    }

  } catch (err) {
    if (!DRY_RUN) {
      await client.query('ROLLBACK');
    }
    console.error(`\n${colors.red}❌ Role seeding failed:${colors.reset}`, err);
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

seedRoles()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(colors.dim, err.stack, colors.reset);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });