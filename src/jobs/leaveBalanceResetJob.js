// jobs/leaveBalanceResetJob.js
//
// إعادة تعيين أرصدة الإجازات بداية كل سنة.
// يعمل تلقائياً في اليوم المحدد من السنة (افتراضياً: 1 يناير 00:05).
//
// ⚠️ يعتمد على إعدادات الشركة:
//   - hr_leave_balance_auto_reset       (bool, default: true)
//   - hr_leave_balance_reset_month      (1-12, default: 1)
//   - hr_leave_balance_reset_day        (1-28, default: 1)
//   - hr_leave_balance_reset_hour       (0-23, default: 0)
//   - hr_leave_balance_carry_over       (bool, default: true)
//
// تشغيل يدوي:
//   node -e "require('./jobs/leaveBalanceResetJob').runAll()"
//   node -e "require('./jobs/leaveBalanceResetJob').run('company-id')"
//   node -e "require('./jobs/leaveBalanceResetJob').run('company-id', { year: 2027 })"

const cron = require('node-cron');
const { pool } = require('../config/pool');
const settingsService = require('../services/settingsService');
const log = (msg, meta) => {
  const ts = new Date().toISOString();
  if (meta) console.log(`[leaveBalanceResetJob][${ts}] ${msg}`, meta);
  else       console.log(`[leaveBalanceResetJob][${ts}] ${msg}`);
};

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * جلب إعدادات الشركة المتعلقة بإعادة التعيين.
 */
const getCompanySettings = async (client, companyId) => {
  const hr = await settingsService.getHRJobSettings(companyId, client);
  return {
    enabled:   hr.leaveBalance.autoReset,
    month:     hr.leaveBalance.resetMonth,
    day:       hr.leaveBalance.resetDay,
    hour:      hr.leaveBalance.resetHour,
    carryOver: hr.leaveBalance.carryOver,
  };
};

/**
 * جلب الموظفين النشطين لشركة.
 */
const getActiveEmployees = async (client, companyId) => {
  const { rows } = await client.query(
    `SELECT id, employee_number, full_name
       FROM employees
      WHERE company_id = $1 AND status IN ('active', 'on_leave')
      ORDER BY employee_number`,
    [companyId]
  );
  return rows;
};

/**
 * جلب أنواع الإجازات النشطة.
 */
const getActiveLeaveTypes = async (client, companyId) => {
  const { rows } = await client.query(
    `SELECT id, name, annual_days, carry_over_allowed, max_carry_over_days
       FROM leave_types
      WHERE company_id = $1 AND is_active = true
      ORDER BY name`,
    [companyId]
  );
  return rows;
};

/**
 * هل يوجد رصيد للموظف/النوع/السنة بالفعل؟
 */
const balanceExists = async (client, employeeId, leaveTypeId, year) => {
  const { rows } = await client.query(
    `SELECT 1 FROM leave_balances
      WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3
      LIMIT 1`,
    [employeeId, leaveTypeId, year]
  );
  return rows.length > 0;
};

/**
 * حساب الرصيد المرحّل من السنة السابقة.
 */
const computeCarryOver = async (client, employeeId, leaveType, targetYear, carryOverEnabled) => {
  if (!carryOverEnabled) return 0;
  if (!leaveType.carry_over_allowed) return 0;

  const { rows } = await client.query(
    `SELECT (entitled_days + carried_days - used_days) AS available
       FROM leave_balances
      WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3
      LIMIT 1`,
    [employeeId, leaveType.id, targetYear - 1]
  );

  if (rows.length === 0) return 0;

  const available = Number(rows[0].available) || 0;
  const maxCarry  = Number(leaveType.max_carry_over_days) || 0;

  return round1(Math.max(0, Math.min(available, maxCarry)));
};

// ═══════════════════════════════════════════════════════════════
// Run (لشركة واحدة)
// ═══════════════════════════════════════════════════════════════

/**
 * إعادة تعيين أرصدة الإجازات لشركة محددة.
 *
 * @param {string} companyId
 * @param {object} opts
 * @param {number} opts.year   - السنة الجديدة (default: current year + 1)
 * @param {boolean} opts.force - (default: false) تجاهل hr_leave_balance_auto_reset
 * @returns {Promise<object>}
 */
const run = async (companyId, { year, force = false } = {}) => {
  const targetYear = year || (new Date().getFullYear() + 1);
  const client = await pool.connect();
  let started = false;

  try {
    await client.query('BEGIN');
    started = true;

    // 1) الإعدادات
    const settings = await getCompanySettings(client, companyId);

    if (!settings.enabled && !force) {
      await client.query('COMMIT');
      started = false;
      return { companyId, year: targetYear, created: 0, skipped: 0, reason: 'disabled' };
    }

    // 2) الموظفون
    const employees = await getActiveEmployees(client, companyId);
    if (employees.length === 0) {
      await client.query('COMMIT');
      started = false;
      return { companyId, year: targetYear, created: 0, skipped: 0, reason: 'no_employees' };
    }

    // 3) الأنواع
    const leaveTypes = await getActiveLeaveTypes(client, companyId);
    if (leaveTypes.length === 0) {
      await client.query('COMMIT');
      started = false;
      return { companyId, year: targetYear, created: 0, skipped: 0, reason: 'no_leave_types' };
    }

    // 4) الحلقة
    let created = 0;
    let skipped = 0;
    const details = [];

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const exists = await balanceExists(client, emp.id, lt.id, targetYear);
        if (exists) {
          skipped++;
          continue;
        }

        const carried = await computeCarryOver(
          client, emp.id, lt, targetYear, settings.carryOver
        );

        await client.query(
          `INSERT INTO leave_balances (
             company_id, employee_id, leave_type_id, year,
             entitled_days, used_days, carried_days
           ) VALUES ($1, $2, $3, $4, $5, 0, $6)`,
          [companyId, emp.id, lt.id, targetYear, lt.annual_days || 0, carried]
        );

        created++;
        details.push({
          employee: emp.full_name,
          leave_type: lt.name,
          entitled: lt.annual_days,
          carried,
        });
      }
    }

    await client.query('COMMIT');
    started = false;

    return {
      companyId,
      year: targetYear,
      created,
      skipped,
      total_employees: employees.length,
      total_leave_types: leaveTypes.length,
      reason: 'ok',
      details: details.slice(0, 10), // نُعيد عينة صغيرة فقط
    };
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { log(`ROLLBACK failed: ${e.message}`); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// Run All (لكل الشركات)
// ═══════════════════════════════════════════════════════════════

const runAll = async ({ year, force = false } = {}) => {
  const targetYear = year || (new Date().getFullYear() + 1);

  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  log(`بدء إعادة تعيين الأرصدة — السنة: ${targetYear} — ${companies.length} شركة`);

  const results = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const co of companies) {
    try {
      const r = await run(co.id, { year: targetYear, force });
      totalCreated += r.created;
      totalSkipped += r.skipped;
      results.push({ company: co.name, ...r });

      if (r.created > 0) {
        log(`✅ ${co.name}: ${r.created} رصيد جديد، ${r.skipped} موجود (${r.reason})`);
      } else {
        log(`⏭️  ${co.name}: لا تغيير (${r.reason})`);
      }
    } catch (err) {
      log(`❌ ${co.name}: ${err.message}`);
      results.push({ company: co.name, error: err.message });
    }
  }

  log(`انتهى — أُنشئ ${totalCreated}، تُخطّي ${totalSkipped}`);
  return { year: targetYear, totalCreated, totalSkipped, results };
};

// ═══════════════════════════════════════════════════════════════
// Scheduler
// ═══════════════════════════════════════════════════════════════

let cronTasks = [];

/**
 * يقرأ إعدادات كل شركة، ويُنشئ cron task لكل شركة.
 *
 * ⚠️ كل شركة قد تكون لها إعدادات مختلفة (شهر/يوم/ساعة).
 * لذا نُنشئ cron task منفصل لكل شركة.
 */
const start = async () => {
  if (cronTasks.length > 0) {
    log('⚠️ scheduler يعمل بالفعل — توقف');
    return;
  }

  // جلب إعدادات كل الشركات النشطة
  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  const client = await pool.connect();
  try {
    for (const co of companies) {
      const settings = await getCompanySettings(client, co.id);

      if (!settings.enabled) {
        log(`⏭️  ${co.name}: معطّل (auto_reset = false)`);
        continue;
      }

      // بناء cron expression: دقيقة ساعة يوم شهر * (كل سنة تلقائياً)
      const schedule = `5 ${settings.hour} ${settings.day} ${settings.month} *`;

      const task = cron.schedule(
        schedule,
        async () => {
          const year = new Date().getFullYear() + 1;
          log(`▶️  ${co.name}: بدء إعادة التعيين للسنة ${year}...`);
          try {
            const r = await run(co.id, { year, force: false });
            log(`✅ ${co.name}: ${r.created} رصيد جديد، ${r.skipped} موجود`);
          } catch (err) {
            log(`❌ ${co.name}: ${err.message}`);
          }
        },
        { timezone: process.env.TZ || 'Asia/Aden' }
      );

      cronTasks.push({ companyId: co.id, companyName: co.name, task, schedule });
      log(`✅ ${co.name}: scheduled — ${schedule} (${settings.month}/${settings.day} ${settings.hour}:05)`);
    }
  } finally {
    client.release();
  }

  log(`✅ scheduler بدأ — ${cronTasks.length} مهمة`);
};

const stop = () => {
  if (cronTasks.length === 0) return;
  for (const t of cronTasks) {
    try { t.task.stop(); }
    catch (e) { log(`⚠️  فشل إيقاف ${t.companyName}: ${e.message}`); }
  }
  cronTasks = [];
  log('scheduler متوقف');
};

/**
 * إعادة تحميل الإعدادات (بعد تغيير أي إعداد من الواجهة).
 */
const reload = async () => {
  log('إعادة تحميل scheduler...');
  stop();
  await start();
};

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  run,
  runAll,
  start,
  stop,
  reload,
  // للاختبار
  getCompanySettings, 
  computeCarryOver ,
};