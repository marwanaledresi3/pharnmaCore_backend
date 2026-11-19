// jobs/contractExpiryJob.js
//
// يفحص يومياً عقود الموظفين المنتهية قريباً ويُرسل تنبيهات.
// يعمل في الساعة 09:00 يومياً (افتراضياً).
//
// ⚠️ يعتمد على:
//   - hr_notify_contract_expiry (bool)
//   - hr_contract_expiry_notify_days (int)
//   - employees: hire_date, termination_date, employment_type
//   - فقط الموظفين بعقود (employment_type IN ('contract', 'full_time', 'part_time'))
//   - فقط الموظفين النشطين (status IN ('active', 'on_leave'))
//
// تشغيل يدوي:
//   node -e "require('./jobs/contractExpiryJob').runAll()"
//   node -e "require('./jobs/contractExpiryJob').run('company-id')"

const cron = require('node-cron');
const { pool } = require('../config/pool');
const settingsService = require('../services/settingsService');
const { notifyManagers } = require('../services/hr/notificationHelper');

const log = (msg, meta) => {
  const ts = new Date().toISOString();
  if (meta) console.log(`[contractExpiryJob][${ts}] ${msg}`, meta);
  else       console.log(`[contractExpiryJob][${ts}] ${msg}`);
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * جلب الموظفين الذين ستنتهي عقودهم قريباً.
 * ⚠️ الموظف له تاريخ انتهاء عقد = termination_date (حالياً)
 * أو hire_date + مدة (غير محددة هنا).
 *
 * في هذا التطبيق، نفترض أن termination_date هو تاريخ انتهاء العقد
 * للموظفين بعقود مؤقتة.
 */
const findExpiringContracts = async (companyId, notifyDays) => {
  const client = await pool.connect();
  try {
    // التاريخ المستهدف: اليوم + notifyDays
    const { rows } = await client.query(
      `SELECT id, employee_number, full_name, hire_date, termination_date, employment_type
         FROM employees
        WHERE company_id = $1
          AND status IN ('active', 'on_leave')
          AND employment_type IN ('contract', 'full_time', 'part_time')
          AND termination_date IS NOT NULL
          AND termination_date >= CURRENT_DATE
          AND termination_date <= CURRENT_DATE + ($2 || ' days')::interval
        ORDER BY termination_date ASC`,
      [companyId, notifyDays]
    );
    return rows;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// Run (لشركة واحدة)
// ═══════════════════════════════════════════════════════════════

const run = async (companyId, { force = false } = {}) => {
  const client = await pool.connect();
  try {
    // 1) الإعدادات
    const settings = await settingsService.getMany(companyId, [
      'hr_notify_contract_expiry',
      'hr_contract_expiry_notify_days',
    ]);

    const enabled = settings.hr_notify_contract_expiry ?? true;
    const notifyDays = Number(settings.hr_contract_expiry_notify_days ?? 30);

    if (!enabled && !force) {
      return { companyId, notified: 0, expiring: 0, reason: 'disabled' };
    }

    // 2) جلب العقود المنتهية قريباً
    const expiring = await findExpiringContracts(companyId, notifyDays);

    if (expiring.length === 0) {
      return { companyId, notified: 0, expiring: 0, reason: 'no_expiring' };
    }

    // 3) إرسال تنبيهات
    let notified = 0;
    for (const emp of expiring) {
      const daysLeft = Math.ceil(
        (new Date(emp.termination_date) - new Date()) / (1000 * 60 * 60 * 24)
      );

      try {
        const results = await notifyManagers({
            companyId,
            settingKey: 'hr_notify_contract_expiry',
            type: 'hr.contract_expiry',
            title: '⚠️ عقد على وشك الانتهاء',
            message: `عقد الموظف ${emp.full_name} (#${emp.employee_number}) ينتهي خلال ${daysLeft} يوم (${emp.termination_date}). يرجى التجديد أو الإنهاء.`,
            referenceType: 'employee',
            referenceId: emp.id,
            metadata: {
                employee_id: emp.id,
                employee_name: emp.full_name,
                termination_date: emp.termination_date,
                days_left: daysLeft,
            },
            // uniqueKey يومي — كل يوم تنبيه جديد
            uniqueKey: `contract_expiry:${emp.id}:${new Date().toISOString().slice(0, 10)}`,
            });
            notified += results.length;
      } catch (err) {
        log(`❌ فشل إرسال تنبيه ${emp.full_name}: ${err.message}`);
      }
    }

    return {
      companyId,
      notified,
      expiring: expiring.length,
      reason: 'ok',
      employees: expiring.map((e) => ({
        name: e.full_name,
        termination_date: e.termination_date,
      })),
    };
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════════════════════════

const runAll = async ({ force = false } = {}) => {
  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  log(`بدء فحص انتهاء العقود — ${companies.length} شركة`);

  let totalNotified = 0;
  let totalExpiring = 0;
  const results = [];

  for (const co of companies) {
    try {
      const r = await run(co.id, { force });
      totalNotified += r.notified;
      totalExpiring += r.expiring;
      results.push({ company: co.name, ...r });
      if (r.expiring > 0) {
        log(`✅ ${co.name}: ${r.expiring} عقد، ${r.notified} إشعار`);
      }
    } catch (err) {
      log(`❌ ${co.name}: ${err.message}`);
      results.push({ company: co.name, error: err.message });
    }
  }

  log(`انتهى — ${totalExpiring} عقد، ${totalNotified} إشعار`);
  return { totalNotified, totalExpiring, results };
};

// ═══════════════════════════════════════════════════════════════
// Scheduler
// ═══════════════════════════════════════════════════════════════

let cronTask = null;

const start = () => {
  if (cronTask) {
    log('⚠️ scheduler يعمل بالفعل');
    return;
  }

  // يومياً الساعة 09:00
  cronTask = cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        await runAll();
      } catch (err) {
        log(`❌ scheduler error: ${err.message}`);
      }
    },
    { timezone: process.env.TZ || 'Asia/Aden' }
  );

  log('✅ scheduler بدأ — 0 9 * * * (يومياً 09:00)');
};

const stop = () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log('scheduler متوقف');
  }
};

module.exports = {
  run,
  runAll,
  start,
  stop,
};