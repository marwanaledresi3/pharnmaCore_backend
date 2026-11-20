#!/usr/bin/env node
// scripts/seed-fixed-assets.js
//
// بيانات الأصول الثابتة الافتراضية:
//   - تصنيفات الأصول (asset_categories) وربطها بحسابات الشجرة (1210..1214 / 1221 / 5250)
//
// الاستخدام:
//   node scripts/seed-fixed-assets.js --company <uuid>
//   node scripts/seed-fixed-assets.js --all
//
// Idempotent — يمكن تشغيله مراراً بدون تكرار.

require('dotenv').config();
const { pool } = require('../config/pool');

const DEFAULT_CATEGORIES = [
  {
    code: 'BLD',
    name: 'الأراضي والمباني',
    depreciation_method: 'straight_line',
    useful_life_years: 25,
    salvage_value_percent: 10,
    asset_account_code: '1210',
    accum_account_code: '1221',
    expense_account_code: '5250',
  },
  {
    code: 'MCH',
    name: 'الآلات والمعدات',
    depreciation_method: 'straight_line',
    useful_life_years: 8,
    salvage_value_percent: 5,
    asset_account_code: '1211',
    accum_account_code: '1221',
    expense_account_code: '5250',
  },
  {
    code: 'VEH',
    name: 'السيارات ووسائل النقل',
    depreciation_method: 'straight_line',
    useful_life_years: 5,
    salvage_value_percent: 10,
    asset_account_code: '1212',
    accum_account_code: '1221',
    expense_account_code: '5250',
  },
  {
    code: 'FRN',
    name: 'الأثاث والتجهيزات المكتبية',
    depreciation_method: 'straight_line',
    useful_life_years: 7,
    salvage_value_percent: 5,
    asset_account_code: '1213',
    accum_account_code: '1221',
    expense_account_code: '5250',
  },
  {
    code: 'IT',
    name: 'أجهزة الحاسوب والبرمجيات',
    depreciation_method: 'declining_balance',
    useful_life_years: 3,
    salvage_value_percent: 0,
    asset_account_code: '1214',
    accum_account_code: '1221',
    expense_account_code: '5250',
  },
];

const log = (msg) => console.log(`[seed-fa] ${msg}`);
const ok = (msg) => console.log(`[seed-fa] ✅ ${msg}`);

const seedCompanyCategories = async (client, companyId) => {
  const { rows: accs } = await client.query(
    `SELECT id, code FROM chart_of_accounts WHERE company_id = $1`,
    [companyId]
  );
  const accMap = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  let inserted = 0;
  let skipped = 0;

  for (const cat of DEFAULT_CATEGORIES) {
    const exists = await client.query(
      `SELECT id FROM asset_categories WHERE company_id = $1 AND (code = $2 OR name = $3) LIMIT 1`,
      [companyId, cat.code, cat.name]
    );
    if (exists.rowCount) {
      skipped++;
      continue;
    }

    await client.query(
      `INSERT INTO asset_categories (
         company_id, code, name, depreciation_method, useful_life_years,
         salvage_value_percent, asset_account_id,
         accumulated_depreciation_account_id, depreciation_expense_account_id,
         is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)`,
      [
        companyId,
        cat.code,
        cat.name,
        cat.depreciation_method,
        cat.useful_life_years,
        cat.salvage_value_percent,
        accMap[cat.asset_account_code] || null,
        accMap[cat.accum_account_code] || null,
        accMap[cat.expense_account_code] || null,
      ]
    );
    inserted++;
  }

  log(`تصنيفات الأصول: ${inserted} جديد، ${skipped} موجود مسبقاً`);
  return { inserted, skipped };
};

const runForCompany = async (companyId) => {
  const client = await pool.connect();
  let tx = false;
  try {
    await client.query('BEGIN');
    tx = true;

    const comp = await client.query(
      `SELECT id, name FROM companies WHERE id = $1 AND is_active = TRUE`,
      [companyId]
    );
    if (!comp.rowCount) {
      throw new Error(`الشركة ${companyId} غير موجودة أو غير نشطة`);
    }

    log(`\n═══ Company: ${comp.rows[0].name} (${companyId}) ═══`);
    const stats = await seedCompanyCategories(client, companyId);

    await client.query('COMMIT');
    tx = false;
    return stats;
  } catch (err) {
    if (tx) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--company');
  const companyId = idx >= 0 ? args[idx + 1] : null;
  const all = args.includes('--all');

  if (!companyId && !all) {
    console.error(`
الاستخدام:
  node scripts/seed-fixed-assets.js --company <uuid>
  node scripts/seed-fixed-assets.js --all
    `);
    process.exit(1);
  }

  try {
    if (companyId) {
      await runForCompany(companyId);
    } else {
      const { rows } = await pool.query(
        `SELECT id, name FROM companies WHERE is_active = TRUE ORDER BY created_at`
      );
      for (const c of rows) {
        await runForCompany(c.id);
      }
    }
    ok('اكتمل seed الأصول الثابتة بنجاح');
    process.exit(0);
  } catch (err) {
    console.error('[seed-fixed-assets] ❌ خطأ:', err.message);
    process.exit(1);
  } finally {
    pool.end().catch(() => {});
  }
};

main();