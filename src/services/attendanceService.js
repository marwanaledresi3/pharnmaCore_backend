// services/attendanceService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// إعدادات افتراضية — يمكن نقلها إلى settingsService
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_WORK_START = '09:00';  // بداية الدوام
const DEFAULT_WORK_END   = '17:00';  // نهاية الدوام
const DEFAULT_STANDARD_HOURS = 8;    // ساعات العمل المعيارية
const LATE_GRACE_MINUTES = 15;       // سماح التأخير

// ═══════════════════════════════════════════════════════════════════════════
// حساب worked_hours, overtime_hours, late_minutes, early_leave_min
// ═══════════════════════════════════════════════════════════════════════════
const computeHours = (check_in, check_out, {
  workStart = DEFAULT_WORK_START,
  workEnd = DEFAULT_WORK_END,
  standardHours = DEFAULT_STANDARD_HOURS,
} = {}) => {
  if (!check_in || !check_out) {
    return {
      worked_hours: null,
      overtime_hours: 0,
      late_minutes: 0,
      early_leave_min: 0,
    };
  }

  const inAt  = new Date(check_in);
  const outAt = new Date(check_out);

  if (isNaN(inAt) || isNaN(outAt)) {
    throw new ApiError(400, 'Invalid check_in/check_out timestamp');
  }
  if (outAt < inAt) {
    throw new ApiError(400, 'check_out cannot be before check_in');
  }

  // ساعات العمل الفعلية
  const diffMs = outAt - inAt;
  const worked = round2(diffMs / (1000 * 60 * 60));

  // بناء وقت بداية/نهاية الدوام على نفس يوم check_in
  const [sh, sm] = workStart.split(':').map(Number);
  const [eh, em] = workEnd.split(':').map(Number);

  const workStartAt = new Date(inAt);
  workStartAt.setHours(sh, sm, 0, 0);

  const workEndAt = new Date(inAt);
  workEndAt.setHours(eh, em, 0, 0);

  // دقائق التأخير = (check_in - workStartAt) بدون السماح
  let lateMin = 0;
  if (inAt > workStartAt) {
    lateMin = Math.floor((inAt - workStartAt) / 60000) - LATE_GRACE_MINUTES;
    if (lateMin < 0) lateMin = 0;
  }

  // دقائق الانصراف المبكر = (workEndAt - check_out)
  let earlyMin = 0;
  if (outAt < workEndAt) {
    earlyMin = Math.floor((workEndAt - outAt) / 60000);
    if (earlyMin < 0) earlyMin = 0;
  }

  // العمل الإضافي = ساعات بعد نهاية الدوام
  let overtime = 0;
  if (outAt > workEndAt) {
    overtime = round2((outAt - workEndAt) / (1000 * 60 * 60));
  }

  // الحالة
  let status = 'present';
  if (lateMin > 0) status = 'late';

  return {
    worked_hours: worked,
    overtime_hours: overtime,
    late_minutes: lateMin,
    early_leave_min: earlyMin,
    _status: status, // داخلي — يُستخدم لتحديد status النهائي
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// CHECK-IN
// ═══════════════════════════════════════════════════════════════════════════
const checkIn = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { employee_id, work_date, notes } = payload;

    // فحص الموظف
    const emp = await client.query(
      `SELECT id, status FROM employees
        WHERE id = $1 AND company_id = $2`,
      [employee_id, companyId]
    );
    if (!emp.rowCount) throw new ApiError(404, 'Employee not found');
    if (['terminated', 'resigned', 'suspended'].includes(emp.rows[0].status)) {
      throw new ApiError(400, `Cannot check-in employee with status: ${emp.rows[0].status}`);
    }

    // فحص: هل يوجد سجل لهذا اليوم؟
    const existing = await client.query(
      `SELECT id, check_in FROM attendance
        WHERE employee_id = $1 AND work_date = $2`,
      [employee_id, work_date]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.check_in) {
        throw new ApiError(400, 'Already checked in for this date');
      }
      // سجل موجود بدون check_in (مثلاً أُنشئ كـ absent) → نحدّثه
      const r = await client.query(
        `UPDATE attendance
            SET check_in = NOW(), status = 'present', notes = COALESCE($1, notes)
          WHERE id = $2
          RETURNING *`,
        [notes || null, row.id]
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return r.rows[0];
    }

    // إدراج جديد
    const r = await client.query(
      `INSERT INTO attendance
         (company_id, employee_id, work_date, check_in, status, notes)
       VALUES ($1, $2, $3, NOW(), 'present', $4)
       RETURNING *`,
      [companyId, employee_id, work_date, notes || null]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return r.rows[0];
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[attendance.checkIn] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CHECK-OUT
// ═══════════════════════════════════════════════════════════════════════════
const checkOut = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { employee_id, work_date, notes } = payload;

    // جلب السجل + قفل
    const existing = await client.query(
      `SELECT * FROM attendance
        WHERE employee_id = $1 AND work_date = $2 AND company_id = $3
        FOR UPDATE`,
      [employee_id, work_date, companyId]
    );
    if (!existing.rowCount) {
      throw new ApiError(404, 'No check-in record for this date');
    }
    const row = existing.rows[0];
    if (!row.check_in) {
      throw new ApiError(400, 'Cannot check-out without check-in');
    }
    if (row.check_out) {
      throw new ApiError(400, 'Already checked out for this date');
    }

    // حساب الساعات
    const calc = computeHours(row.check_in, new Date());

    const r = await client.query(
      `UPDATE attendance
          SET check_out = NOW(),
              worked_hours = $1,
              overtime_hours = $2,
              late_minutes = $3,
              early_leave_min = $4,
              status = CASE
                WHEN $3 > 0 THEN 'late'
                ELSE 'present'
              END,
              notes = COALESCE($5, notes)
        WHERE id = $6
        RETURNING *`,
      [
        calc.worked_hours,
        calc.overtime_hours,
        calc.late_minutes,
        calc.early_leave_min,
        notes || null,
        row.id,
      ]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return r.rows[0];
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[attendance.checkOut] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT — تسجيل حضور كامل (يدوي، للمدير)
// ═══════════════════════════════════════════════════════════════════════════
const upsert = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { employee_id, work_date, check_in, check_out, status, notes } = payload;

    // فحص الموظف
    const emp = await client.query(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2`,
      [employee_id, companyId]
    );
    if (!emp.rowCount) throw new ApiError(404, 'Employee not found');

    // حساب الساعات إن أمكن
    let calc = {
      worked_hours: null,
      overtime_hours: 0,
      late_minutes: 0,
      early_leave_min: 0,
    };
    if (check_in && check_out) {
      calc = computeHours(check_in, check_out);
    }

    // تحديد الحالة النهائية
    const finalStatus = status || (check_in ? calc._status || 'present' : 'absent');

    const r = await client.query(
      `INSERT INTO attendance
         (company_id, employee_id, work_date,
          check_in, check_out, worked_hours, overtime_hours,
          late_minutes, early_leave_min, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (employee_id, work_date)
       DO UPDATE SET
         check_in        = EXCLUDED.check_in,
         check_out       = EXCLUDED.check_out,
         worked_hours    = EXCLUDED.worked_hours,
         overtime_hours  = EXCLUDED.overtime_hours,
         late_minutes    = EXCLUDED.late_minutes,
         early_leave_min = EXCLUDED.early_leave_min,
         status          = EXCLUDED.status,
         notes           = EXCLUDED.notes
       RETURNING *`,
      [
        companyId, employee_id, work_date,
        check_in || null, check_out || null,
        calc.worked_hours, calc.overtime_hours,
        calc.late_minutes, calc.early_leave_min,
        finalStatus, notes || null,
      ]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return r.rows[0];
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[attendance.upsert] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { checkIn, checkOut, upsert, computeHours };