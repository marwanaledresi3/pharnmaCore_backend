// jobs/attendanceAutoJob.js
//
// يسجّل غياباً تلقائياً للموظفين النشطين الذين لم يسجّلوا حضوراً.
// يعمل يومياً في وقت محدد (افتراضياً 23:59).
//
// ⚠️ يعتمد على:
//   - company.settings.hr_attendance_auto_absent (bool)
//   - company.settings.hr_attendance_auto_absent_time (HH:MM)
//   - company.settings.hr_weekend_days (array مثل ['friday'])
//   - employees.status IN ('active', 'on_leave')
//
// ⚠️ لا يُسجّل غياباً لـ:
//   - أيام العطل الأسبوعية (weekend_days)
//   - أيام الإجازات المعتمدة (leave_requests status='approved')
//   - الموظفين الذين لديهم سجل attendance status='leave'
//
// تشغيل يدوي:
//   node -e "require('./jobs/attendanceAutoJob').run({ date: '2026-01-15' })"
//   node -e "require('./jobs/attendanceAutoJob').runAll({ date: '2026-01-15' })"

const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const log = (msg, meta) => {
  const ts = new Date().toISOString();
  if (meta) console.log(`[attendanceAutoJob][${ts}] ${msg}`, meta);
  else       console.log(`[attendanceAutoJob][${ts}] ${msg}`);
};

/**
 * جلب إعدادات الشركة (defaults إذا لم تُوجد)
 */
const getCompanySettings = async (client, companyId) => {
  const { rows } = await client.query(
    `SELECT key, value FROM settings
      WHERE company_id = $1
        AND key IN (
          'hr_attendance_auto_absent',
          'hr_attendance_auto_absent_time',
          'hr_weekend_days'
        )`,
    [companyId]
  );

  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    enabled:       map.hr_attendance_auto_absent ?? true,
    runAt:         map.hr_attendance_auto_absent_time ?? '23:59',
    weekendDays:   Array.isArray(map.hr_weekend_days)
                     ? map.hr_weekend_days
                     : ['friday'],
  };
};

/**
 * تحويل اسم اليوم إلى رقم (0=Sunday...6=Saturday)
 */
const DAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const isWeekend = (dateStr, weekendDays) => {
  const d = new Date(dateStr);
  const idx = d.getUTCDay();
  return weekendDays.some(name => DAY_INDEX[name] === idx);
};

/**
 * جلب قائمة الموظفين الذين يحتاجون تسجيل غياب في تاريخ معيّن:
 *   - نشطون (active/on_leave)
 *   - لم يسجّلوا check_in
 *   - ليسوا في إجازة معتمدة
 *   - ليس لديهم سجل attendance أصلاً (أو لديهم status='absent' مسبقاً)
 */
const findEmployeesToMarkAbsent = async (client, companyId, dateStr) => {
  const { rows } = await client.query(
    `SELECT e.id AS employee_id
       FROM employees e
       LEFT JOIN attendance a
         ON a.employee_id = e.id AND a.work_date = $2
       LEFT JOIN leave_requests lr
         ON lr.employee_id = e.id
        AND lr.status = 'approved'
        AND lr.start_date <= $2
        AND lr.end_date >= $2
      WHERE e.company_id = $1
        AND e.status IN ('active', 'on_leave')
        AND a.id IS NULL                -- لا يوجد سجل
        AND lr.id IS NULL                -- لا يوجد إجازة معتمدة
      ORDER BY e.id`,
    [companyId, dateStr]
  );
  return rows.map(r => r.employee_id);
};

// ═══════════════════════════════════════════════════════════════
// Run (لشركة واحدة)
// ═══════════════════════════════════════════════════════════════

/**
 * تسجيل غياب تلقائي لشركة محددة في تاريخ معيّن.
 *
 * @param {string} companyId
 * @param {object} opts
 * @param {string} opts.date - YYYY-MM-DD (default: today)
 * @param {boolean} opts.force - (default: false) تجاهل إعداد hr_attendance_auto_absent
 * @returns {Promise<{companyId, date, inserted, skipped, reason}>}
 */
const run = async (companyId, { date, force = false } = {}) => {
  const dateStr = date || new Date().toISOString().slice(0, 10);
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
      return { companyId, date: dateStr, inserted: 0, skipped: 0, reason: 'disabled' };
    }

    // 2) يوم عطلة؟
    if (isWeekend(dateStr, settings.weekendDays)) {
      await client.query('COMMIT');
      started = false;
      return { companyId, date: dateStr, inserted: 0, skipped: 0, reason: 'weekend' };
    }

    // 3) جلب الموظفين
    const employeeIds = await findEmployeesToMarkAbsent(client, companyId, dateStr);
    if (employeeIds.length === 0) {
      await client.query('COMMIT');
      started = false;
      return { companyId, date: dateStr, inserted: 0, skipped: 0, reason: 'no_employees' };
    }

    // 4) إدراج سجلات الغياب
    let inserted = 0;
    for (const empId of employeeIds) {
      const r = await client.query(
        `INSERT INTO attendance
           (company_id, employee_id, work_date, status, notes)
         VALUES ($1, $2, $3, 'absent', 'تسجيل تلقائي — لم يسجّل حضوراً')
         ON CONFLICT (employee_id, work_date) DO NOTHING
         RETURNING id`,
        [companyId, empId, dateStr]
      );
      if (r.rowCount) inserted++;
    }

    await client.query('COMMIT');
    started = false;

    return {
      companyId,
      date: dateStr,
      inserted,
      skipped: employeeIds.length - inserted,
      reason: 'ok',
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
// Run All (لكل الشركات النشطة)
// ═══════════════════════════════════════════════════════════════

const runAll = async ({ date, force = false } = {}) => {
  const dateStr = date || new Date().toISOString().slice(0, 10);

  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  log(`بدء التشغيل — التاريخ: ${dateStr} — عدد الشركات: ${companies.length}`);

  const results = [];
  let totalInserted = 0;

  for (const co of companies) {
    try {
      const r = await run(co.id, { date: dateStr, force });
      totalInserted += r.inserted;
      results.push({ company: co.name, ...r });
      if (r.inserted > 0) {
        log(`شركة ${co.name}: ${r.inserted} غياب مسجّل`, { reason: r.reason });
      } else {
        log(`شركة ${co.name}: لا تغيير (${r.reason})`);
      }
    } catch (err) {
      log(`❌ فشل للشركة ${co.name}: ${err.message}`);
      results.push({ company: co.name, error: err.message });
    }
  }

  log(`انتهى — إجمالي: ${totalInserted} غياب`);
  return { date: dateStr, totalInserted, results };
};

// ═══════════════════════════════════════════════════════════════
// Scheduler (cron)
// ═══════════════════════════════════════════════════════════════

let cronTask = null;

/**
 * يبدأ تشغيلاً دورياً يومياً.
 * يقرأ hr_attendance_auto_absent_time من أول شركة نشطة (كساعة عامة).
 * ⚠️ إذا كانت الشركات لها أوقات مختلفة، شغّل لكل شركة على حدة.
 */
const start = () => {
  if (cronTask) {
    log('⚠️ scheduler يعمل بالفعل — تخطّي');
    return;
  }

  const cron = require('node-cron');

  // افتراضياً 23:59 كل يوم
  const schedule = '59 23 * * *';

  cronTask = cron.schedule(schedule, async () => {
    try {
      await runAll();
    } catch (err) {
      log(`❌ خطأ في scheduler: ${err.message}`);
    }
  });

  log(`✅ scheduler بدأ — ${schedule} (كل يوم 23:59)`);
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