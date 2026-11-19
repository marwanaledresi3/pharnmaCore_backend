// jobs/attendanceReminderJob.js
//
// يُرسل تذكيراً للموظفين الذين لم يسجّلوا حضورهم قبل نهاية اليوم.
// يعمل يومياً الساعة 17:30 (افتراضياً — قبل نهاية الدوام المعتاد).
//
// ⚠️ يعتمد على:
//   - hr_attendance_auto_absent (bool) — إذا معطل، لا تذكير
//   - hr_attendance_auto_absent_time (HH:MM) — يستخدم لحساب وقت التذكير
//   - hr_weekend_days (array) — يتخطى العطل
//   - hr_notify_attendance_missing (bool)
//   - employees.status IN ('active', 'on_leave')
//   - leave_requests المعتمدة
//
// تشغيل يدوي:
//   node -e "require('./jobs/attendanceReminderJob').runAll()"

const cron = require('node-cron');
const { pool } = require('../config/pool');
const settingsService = require('../services/settingsService');
const { sendHrNotification } = require('../services/hr/notificationHelper');

const log = (msg, meta) => {
  const ts = new Date().toISOString();
  if (meta) console.log(`[attendanceReminderJob][${ts}] ${msg}`, meta);
  else       console.log(`[attendanceReminderJob][${ts}] ${msg}`);
};

const DAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const isWeekend = (dateStr, weekendDays) => {
  const d = new Date(dateStr);
  const idx = d.getUTCDay();
  return weekendDays.some(name => DAY_INDEX[name] === idx);
};

// ═══════════════════════════════════════════════════════════════
// جلب الموظفين الذين يحتاجون تذكيراً
// ═══════════════════════════════════════════════════════════════
const findEmployeesNeedingReminder = async (client, companyId, dateStr) => {
  const { rows } = await client.query(
    `SELECT e.id, e.full_name, e.employee_number, e.user_id
       FROM employees e
       LEFT JOIN attendance a
         ON a.employee_id = e.id AND a.work_date = $2
       LEFT JOIN leave_requests lr
         ON lr.employee_id = e.id
        AND lr.status = 'approved'
        AND lr.start_date <= $2
        AND lr.end_date >= $2
      WHERE e.company_id = $1
        AND e.status = 'active'
        AND e.user_id IS NOT NULL            -- فقط من لديه حساب
        AND a.id IS NULL                     -- لم يسجّل
        AND lr.id IS NULL                    -- ليس في إجازة
      ORDER BY e.employee_number`,
    [companyId, dateStr]
  );
  return rows;
};

// ═══════════════════════════════════════════════════════════════
// Run (لشركة واحدة)
// ═══════════════════════════════════════════════════════════════
const run = async (companyId, { date, force = false } = {}) => {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    // 1) الإعدادات
    const settings = await settingsService.getMany(companyId, [
      'hr_attendance_auto_absent',
      'hr_weekend_days',
      'hr_notify_attendance_missing',
    ]);

    const autoAbsentEnabled = settings.hr_attendance_auto_absent ?? true;
    const notifyEnabled = settings.hr_notify_attendance_missing ?? true;
    const weekendDays = Array.isArray(settings.hr_weekend_days)
      ? settings.hr_weekend_days
      : ['friday'];

    // إذا كان auto_absent معطلاً أو notify معطلاً → تخطي
    if ((!autoAbsentEnabled || !notifyEnabled) && !force) {
      return { companyId, date: dateStr, sent: 0, reason: 'disabled' };
    }

    // 2) يوم عطلة؟
    if (isWeekend(dateStr, weekendDays)) {
      return { companyId, date: dateStr, sent: 0, reason: 'weekend' };
    }

    // 3) جلب الموظفين
    const employees = await findEmployeesNeedingReminder(client, companyId, dateStr);
    if (employees.length === 0) {
      return { companyId, date: dateStr, sent: 0, reason: 'all_checked_in' };
    }

    // 4) إرسال تذكيرات
    let sent = 0;
    for (const emp of employees) {
      try {
        await sendHrNotification({
          companyId,
          settingKey: 'hr_notify_attendance_missing',
          userId: emp.user_id,
          type: 'hr.attendance_reminder',
          title: '⏰ لم تسجّل حضورك اليوم',
          message: `مرحباً ${emp.full_name}، لم نسجّل حضورك اليوم (${dateStr}). يرجى تسجيله قبل نهاية اليوم.`,
          referenceType: 'employee',
          referenceId: emp.id,
          metadata: {
            employee_id: emp.id,
            employee_number: emp.employee_number,
            work_date: dateStr,
          },
          // uniqueKey يومي — لا تكرار في نفس اليوم
          uniqueKey: `attendance_reminder:${emp.id}:${dateStr}`,
        });
        sent++;
      } catch (err) {
        log(`❌ فشل تذكير ${emp.full_name}: ${err.message}`);
      }
    }

    return {
      companyId,
      date: dateStr,
      sent,
      total_pending: employees.length,
      reason: 'ok',
    };
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════════════════════════
const runAll = async ({ date, force = false } = {}) => {
  const dateStr = date || new Date().toISOString().slice(0, 10);

  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  log(`بدء تذكيرات الحضور — ${dateStr} — ${companies.length} شركة`);

  let totalSent = 0;
  let totalPending = 0;
  const results = [];

  for (const co of companies) {
    try {
      const r = await run(co.id, { date: dateStr, force });
      totalSent += r.sent;
      totalPending += r.total_pending || 0;
      results.push({ company: co.name, ...r });

      if (r.sent > 0) {
        log(`✅ ${co.name}: ${r.sent} تذكير (${r.total_pending} بدون حضور)`);
      } else if (r.reason !== 'disabled' && r.reason !== 'weekend') {
        log(`ℹ️  ${co.name}: لا تذكيرات (${r.reason})`);
      }
    } catch (err) {
      log(`❌ ${co.name}: ${err.message}`);
      results.push({ company: co.name, error: err.message });
    }
  }

  log(`انتهى — ${totalSent} تذكير، ${totalPending} موظف بدون حضور`);
  return { date: dateStr, totalSent, totalPending, results };
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

  // يومياً 17:30 (قبل auto-absent job الذي يعمل 23:59)
  cronTask = cron.schedule(
    '30 17 * * *',
    async () => {
      try {
        await runAll();
      } catch (err) {
        log(`❌ scheduler error: ${err.message}`);
      }
    },
    { timezone: process.env.TZ || 'Asia/Aden' }
  );

  log('✅ scheduler بدأ — 30 17 * * * (يومياً 17:30)');
};

const stop = () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log('scheduler متوقف');
  }
};

module.exports = { run, runAll, start, stop };