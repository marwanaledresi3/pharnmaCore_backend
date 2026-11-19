// jobs/payrollAutoJob.js
//
// يحسب مسير رواتب تلقائياً كل شهر (draft فقط — لا يُرحّل).
// يعمل في آخر يوم من كل شهر (أو يوم محدد حسب الإعداد).
//
// ⚠️ يعتمد على:
//   - company.settings.hr_payroll_auto_calculate (bool)
//   - company.settings.hr_payroll_payment_day (integer, default 25)
//   - company.settings.hr_payroll_auto_post_journal (bool)
//
// ⚠️ لا يُرحّل القيود تلقائياً إلا إذا hr_payroll_auto_post_journal = true
//
// تشغيل يدوي:
//   node -e "require('./jobs/payrollAutoJob').run('comp-id', { year: 2026, month: 1 })"

const { pool } = require('../config/pool');
const payrollService = require('../services/payrollService');

const log = (msg, meta) => {
  const ts = new Date().toISOString();
  if (meta) console.log(`[payrollAutoJob][${ts}] ${msg}`, meta);
  else       console.log(`[payrollAutoJob][${ts}] ${msg}`);
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const getCompanySettings = async (client, companyId) => {
  const { rows } = await client.query(
    `SELECT key, value FROM settings
      WHERE company_id = $1
        AND key IN (
          'hr_payroll_auto_calculate',
          'hr_payroll_auto_post_journal',
          'hr_payroll_payment_day'
        )`,
    [companyId]
  );

  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    enabled:       map.hr_payroll_auto_calculate ?? false,
    autoPost:      map.hr_payroll_auto_post_journal ?? false,
    paymentDay:    Number(map.hr_payroll_payment_day ?? 25),
  };
};

/**
 * هل يوجد مسير لهذا الشهر بالفعل؟
 */
const hasRunForPeriod = async (client, companyId, year, month) => {
  const { rows } = await client.query(
    `SELECT id, status FROM payroll_runs
      WHERE company_id = $1
        AND period_year = $2
        AND period_month = $3
        AND status <> 'cancelled'
      LIMIT 1`,
    [companyId, year, month]
  );
  return rows[0] || null;
};

/**
 * هل يوجد موظفون نشطون؟
 */
const hasActiveEmployees = async (client, companyId) => {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM employees
      WHERE company_id = $1 AND status IN ('active', 'on_leave')`,
    [companyId]
  );
  return rows[0].c > 0;
};

// ═══════════════════════════════════════════════════════════════
// Run (لشركة واحدة)
// ═══════════════════════════════════════════════════════════════

/**
 * حساب مسير رواتب تلقائي لشركة محددة.
 *
 * @param {string} companyId
 * @param {object} opts
 * @param {number} opts.year
 * @param {number} opts.month
 * @param {string} opts.userId - (اختياري) user_id لـ created_by
 * @param {boolean} opts.force - (default: false) تجاهل hr_payroll_auto_calculate
 * @returns {Promise<{companyId, year, month, runId, status, reason}>}
 */
const run = async (companyId, { year, month, userId, force = false } = {}) => {
  if (!year || !month) {
    throw new Error('year و month مطلوبان');
  }

  const client = await pool.connect();
  try {
    // 1) الإعدادات
    const settings = await getCompanySettings(client, companyId);

    if (!settings.enabled && !force) {
      return { companyId, year, month, runId: null, status: 'skipped', reason: 'disabled' };
    }

    // 2) موظفون نشطون؟
    if (!(await hasActiveEmployees(client, companyId))) {
      return { companyId, year, month, runId: null, status: 'skipped', reason: 'no_employees' };
    }

    // 3) مسير موجود؟
    const existing = await hasRunForPeriod(client, companyId, year, month);
    if (existing) {
      return {
        companyId, year, month,
        runId: existing.id,
        status: 'skipped',
        reason: `already_exists:${existing.status}`,
      };
    }

    // 4) الحساب
    const paymentDate = new Date(year, month - 1, settings.paymentDay)
      .toISOString().slice(0, 10);

    // ⚠️ نُغلق client قبل استدعاء service.create (لأنه يفتح transaction خاصة به)
    client.release();

    log(`حساب مسير ${year}/${month} لشركة ${companyId}...`);
    const run = await payrollService.create(companyId, userId || null, {
      year,
      month,
      payment_date: paymentDate,
    });
    log(`✅ تم إنشاء مسير ${run.run_number} (${run.items?.length || 0} بند)`);

    // 5) ترحيل تلقائي؟
    if (settings.autoPost && userId) {
      log(`ترحيل تلقائي للمسير ${run.run_number}...`);
      await payrollService.post(companyId, run.id, userId);
      log(`✅ تم ترحيل المسير ${run.run_number}`);
    }

    return {
      companyId, year, month,
      runId: run.id,
      status: 'created',
      reason: settings.autoPost ? 'created_and_posted' : 'created',
    };
  } catch (err) {
    log(`❌ فشل: ${err.message}`);
    throw err;
  }
};

// ═══════════════════════════════════════════════════════════════
// Run All (لكل الشركات النشطة)
// ═══════════════════════════════════════════════════════════════

const runAll = async ({ year, month, userId, force = false } = {}) => {
  const now = new Date();
  const targetYear  = year  || now.getFullYear();
  const targetMonth = month || now.getMonth() + 1;

  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  log(`بدء التشغيل — ${targetYear}/${targetMonth} — عدد الشركات: ${companies.length}`);

  const results = [];
  let created = 0;
  let skipped = 0;
  let failed  = 0;

  for (const co of companies) {
    try {
      const r = await run(co.id, { year: targetYear, month: targetMonth, userId, force });
      results.push({ company: co.name, ...r });

      if (r.status === 'created')       { created++; log(`✅ ${co.name}: ${r.reason}`); }
      else if (r.status === 'skipped')  { skipped++; log(`⏭️ ${co.name}: ${r.reason}`); }
    } catch (err) {
      failed++;
      log(`❌ ${co.name}: ${err.message}`);
      results.push({ company: co.name, error: err.message });
    }
  }

  log(`انتهى — أُنشئ ${created}، تُخطّي ${skipped}، فشل ${failed}`);
  return { year: targetYear, month: targetMonth, created, skipped, failed, results };
};

// ═══════════════════════════════════════════════════════════════
// Scheduler (cron)
// ═══════════════════════════════════════════════════════════════

let cronTask = null;

/**
 * يبدأ تشغيلاً دورياً شهرياً.
 * يعمل في يوم 25 من كل شهر الساعة 08:00 (افتراضياً).
 * لحساب رواتب الشهر السابق — لأن الشهر ينتهي في آخر يوم.
 */
const start = () => {
  if (cronTask) {
    log('⚠️ scheduler يعمل بالفعل — تخطّي');
    return;
  }

  const cron = require('node-cron');

  // في يوم 25 من كل شهر، الساعة 8:00 صباحاً
  // نحسب رواتب الشهر **السابق** (لأن الحالي لم ينتهِ)
  const schedule = '0 8 25 * *';

  cronTask = cron.schedule(schedule, async () => {
    try {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      await runAll({ year: prev.getFullYear(), month: prev.getMonth() + 1 });
    } catch (err) {
      log(`❌ خطأ في scheduler: ${err.message}`);
    }
  });

  log(`✅ scheduler بدأ — ${schedule} (يوم 25 من كل شهر 8:00 — يحسب الشهر السابق)`);
};

const stop = () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log('scheduler متوقف');
  }
};

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  run,
  runAll,
  start,
  stop,
};