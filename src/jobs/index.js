// jobs/index.js
//
// يبدأ كل الـ jobs في التطبيق.
// استدعِها في server.js بعد تشغيل HTTP server.
//
// متغيرات البيئة:
//   DISABLE_JOBS=true          ← تعطيل كل jobs
//   ENABLE_ATTENDANCE_JOB=false ← تعطيل job واحد
//   ENABLE_PAYROLL_JOB=false    ← تعطيل job واحد

const log = (msg) => console.log(`[jobs][${new Date().toISOString()}] ${msg}`);

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const envBool = (key, defaultValue = true) => {
  const v = process.env[key];
  if (v === undefined) return defaultValue;
  return v !== 'false' && v !== '0';
};

// ═══════════════════════════════════════════════════════════════
// Jobs Registry
// ═══════════════════════════════════════════════════════════════
//
// كل job:
//   - name:    اسم للتوضيح
//   - module:  الملف المُصدَّر
//   - enabled: (bool) أو دالة
//
// ⚠️ Jobs موجودة مسبقاً (cleanupReservations, notificationJob)
//    غير مسجّلة هنا — قد تكون لها طريقتها الخاصة.
//    راجع ملفاتها وأضفها إن لم تكن مسجّلة.

// ═══════════════════════════════════════════════════════════════
// Start All
// ═══════════════════════════════════════════════════════════════

// jobs/index.js
const JOBS = [
  { name: 'attendanceAutoJob',      module: require('./attendanceAutoJob'),      enabled: envBool('ENABLE_ATTENDANCE_JOB', true) },
  { name: 'payrollAutoJob',         module: require('./payrollAutoJob'),         enabled: envBool('ENABLE_PAYROLL_JOB', true) },
  { name: 'leaveBalanceResetJob',   module: require('./leaveBalanceResetJob'),   enabled: envBool('ENABLE_LEAVE_BALANCE_RESET_JOB', true) },
  { name: 'contractExpiryJob',      module: require('./contractExpiryJob'),      enabled: envBool('ENABLE_CONTRACT_EXPIRY_JOB', true) },
  { name: 'attendanceReminderJob',  module: require('./attendanceReminderJob'),  enabled: envBool('ENABLE_ATTENDANCE_REMINDER_JOB', true) },  // 🆕
];

const startAll = async () => {   // ⬅️ يجب أن تصبح async
  if (process.env.DISABLE_JOBS === 'true') {
    log('⏸️  DISABLE_JOBS=true — skipped');
    return;
  }

  const enabledJobs = JOBS.filter(j => j.enabled);
  const disabledJobs = JOBS.filter(j => !j.enabled);

  log(`بدء ${enabledJobs.length} job(s)${disabledJobs.length ? ` (${disabledJobs.length} معطّل)` : ''}`);

  for (const job of disabledJobs) log(`⏭️  ${job.name} — معطّل`);

  for (const job of enabledJobs) {
    try {
      if (typeof job.module.start !== 'function') {
        log(`⚠️  ${job.name} — لا يحتوي start() — تخطّي`);
        continue;
      }
      // ⬇️ await لأن بعض jobs.start() أصبحت async
      await job.module.start();
      log(`✅ ${job.name} — بدأ`);
    } catch (err) {
      log(`❌ ${job.name} — فشل البدء: ${err.message}`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// Stop All
// ═══════════════════════════════════════════════════════════════

const stopAll = () => {
  log('إيقاف كل jobs...');
  for (const job of JOBS) {
    if (job.enabled && typeof job.module.stop === 'function') {
      try {
        job.module.stop();
        log(`✅ ${job.name} — توقف`);
      } catch (err) {
        log(`❌ ${job.name} — فشل التوقف: ${err.message}`);
      }
    }
  }
};

module.exports = { startAll, stopAll, JOBS };