// services/leaveService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const settingsService = require('./settingsService');
const {
  sendHrNotification,
  notifyManagers,
} = require('./hr/notificationHelper');

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const daysBetween = (startDate, endDate) => {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (isNaN(s) || isNaN(e)) throw new ApiError(400, 'Invalid dates');
  if (e < s) throw new ApiError(400, 'end_date cannot be before start_date');
  const ms = e.getTime() - s.getTime();
  return round1(ms / (1000 * 60 * 60 * 24) + 1);
};

// ═══════════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════════
const createRequest = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let started = false;
  let request = null;
  let empInfo = null;
  let ltInfo = null;

  try {
    await client.query('BEGIN');
    started = true;

    const { employee_id, leave_type_id, start_date, end_date, reason } = payload;

    // 1) الموظف
    const emp = await client.query(
      `SELECT id, full_name, user_id, status FROM employees
        WHERE id = $1 AND company_id = $2`,
      [employee_id, companyId]
    );
    if (!emp.rowCount) throw new ApiError(404, 'Employee not found');
    if (['terminated', 'resigned'].includes(emp.rows[0].status)) {
      throw new ApiError(400, `Cannot request leave for employee with status: ${emp.rows[0].status}`);
    }
    empInfo = emp.rows[0];

    // 2) نوع الإجازة
    const lt = await client.query(
      `SELECT id, name, requires_approval, annual_days, is_paid, is_sick_leave
         FROM leave_types
        WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [leave_type_id, companyId]
    );
    if (!lt.rowCount) throw new ApiError(404, 'Leave type not found or inactive');
    ltInfo = lt.rows[0];

    // 3) حساب الأيام
    const daysCount = daysBetween(start_date, end_date);

    // 4) جلب الإعدادات
    const settings = await settingsService.getMany(companyId, [
      'hr_leave_max_consecutive_days',
      'hr_leave_min_notice_days',
      'hr_leave_max_pending_requests',
      'hr_leave_allow_overlap',
      'hr_leave_require_attachment',
      'hr_leave_auto_approve_sick',
    ], client);

    // 5) فحص max consecutive
    const maxConsecutive = Number(settings.hr_leave_max_consecutive_days ?? 30);
    if (maxConsecutive > 0 && daysCount > maxConsecutive) {
      throw new ApiError(
        400,
        `الحد الأقصى ${maxConsecutive} يوم متتالي — الطلب ${daysCount} يوم`
      );
    }

    // 6) فحص min notice
    const minNotice = Number(settings.hr_leave_min_notice_days ?? 0);
    if (minNotice > 0 && ltInfo.requires_approval) {
      const daysNotice = Math.floor(
        (new Date(start_date) - new Date()) / (1000 * 60 * 60 * 24)
      );
      if (daysNotice < minNotice) {
        throw new ApiError(
          400,
          `يجب تقديم الطلب قبل ${minNotice} يوم على الأقل من تاريخ البداية`
        );
      }
    }

    // 7) فحص max pending
    const maxPending = Number(settings.hr_leave_max_pending_requests ?? 0);
    if (maxPending > 0) {
      const pendingRes = await client.query(
        `SELECT COUNT(*)::int AS c FROM leave_requests
          WHERE employee_id = $1 AND status = 'pending'`,
        [employee_id]
      );
      if (pendingRes.rows[0].c >= maxPending) {
        throw new ApiError(
          400,
          `لديك ${pendingRes.rows[0].c} طلب معلق — الحد الأقصى ${maxPending}`
        );
      }
    }

    // 8) فحص التداخل
    if (!settings.hr_leave_allow_overlap) {
      const overlap = await client.query(
        `SELECT 1 FROM leave_requests
          WHERE employee_id = $1
            AND status IN ('pending', 'approved')
            AND start_date <= $3
            AND end_date >= $2
          LIMIT 1`,
        [employee_id, start_date, end_date]
      );
      if (overlap.rowCount) {
        throw new ApiError(400, 'يوجد طلب إجازة متداخل مع هذه الفترة');
      }
    }

    // 9) auto-approve للمرضية (اختياري)
    const isSick = ltInfo.is_sick_leave === true;
    const autoApprove = settings.hr_leave_auto_approve_sick && isSick;
    const initialStatus = autoApprove ? 'approved' : 'pending';

    // 10) إنشاء الطلب
    const r = await client.query(
      `INSERT INTO leave_requests (
         company_id, employee_id, leave_type_id,
         start_date, end_date, days_count, reason, status,
         approved_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        companyId, employee_id, leave_type_id,
        start_date, end_date, daysCount, reason || null,
        initialStatus,
        autoApprove ? new Date() : null,
      ]
    );
    request = r.rows[0];

    await client.query('COMMIT');
    started = false;

    // ⬇️ إشعارات
    try {
      await notifyManagers({
        companyId,
        settingKey: 'hr_notify_leave_request',
        type: 'hr.leave_request',
        title: '📅 طلب إجازة جديد',
        message: `${empInfo.full_name} طلب إجازة ${ltInfo.name} من ${start_date} إلى ${end_date} (${daysCount} يوم)`,
        referenceType: 'leave_request',
        referenceId: request.id,
        metadata: {
          employee_id,
          employee_name: empInfo.full_name,
          leave_type_id,
          leave_type_name: ltInfo.name,
          days_count: daysCount,
          auto_approved: autoApprove,
        },
        excludeUserId: userId,
        uniqueKey: `leave_request:${request.id}`,
      });

      // إذا auto-approve، أبلغ الموظف مباشرة
      if (autoApprove && empInfo.user_id) {
        await sendHrNotification({
          companyId,
          settingKey: 'hr_notify_leave_approved',
          userId: empInfo.user_id,
          type: 'hr.leave_approved',
          title: '✅ تم اعتماد إجازتك تلقائياً',
          message: `تم اعتماد إجازتك ${ltInfo.name} من ${start_date} إلى ${end_date} (${daysCount} يوم)`,
          referenceType: 'leave_request',
          referenceId: request.id,
          metadata: { days_count: daysCount, auto_approved: true },
          uniqueKey: `leave_approved:${request.id}`,
        });
      }
    } catch (e) {
      console.error('[leaveService] notify after create failed:', e.message);
    }

    return request;
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[leaveService.create] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════════════
const approve = async (companyId, userId, requestId, payload = {}) => {
  const client = await pool.connect();
  let started = false;
  let req = null;
  let updated = null;

  try {
    await client.query('BEGIN');
    started = true;

    const lock = await client.query(
      `SELECT lr.*, e.full_name AS employee_name, e.user_id AS employee_user_id
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
        WHERE lr.id = $1 AND lr.company_id = $2
        FOR UPDATE`,
      [requestId, companyId]
    );
    req = lock.rows[0];
    if (!req) throw new ApiError(404, 'Leave request not found');
    if (req.status !== 'pending') {
      throw new ApiError(400, `Cannot approve request in status: ${req.status}`);
    }

    const r = await client.query(
      `UPDATE leave_requests
          SET status = 'approved',
              approved_by = $1,
              approved_at = NOW(),
              rejection_reason = COALESCE($2, rejection_reason)
        WHERE id = $3
        RETURNING *`,
      [userId, payload.rejection_reason || null, requestId]
    );
    updated = r.rows[0];

    await client.query('COMMIT');
    started = false;

    // ⬇️ إشعار للموظف
    try {
      if (req.employee_user_id) {
        await sendHrNotification({
          companyId,
          settingKey: 'hr_notify_leave_approved',
          userId: req.employee_user_id,
          type: 'hr.leave_approved',
          title: '✅ تم اعتماد إجازتك',
          message: `تم اعتماد إجازتك من ${req.start_date} إلى ${req.end_date} (${req.days_count} يوم)`,
          referenceType: 'leave_request',
          referenceId: requestId,
          metadata: { days_count: req.days_count },
          uniqueKey: `leave_approved:${requestId}`,
        });
      }
    } catch (e) {
      console.error('[leaveService] approve notify failed:', e.message);
    }

    return updated;
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[leaveService.approve] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// REJECT
// ═══════════════════════════════════════════════════════════════
const reject = async (companyId, userId, requestId, payload = {}) => {
  const client = await pool.connect();
  let started = false;
  let req = null;
  let updated = null;

  try {
    await client.query('BEGIN');
    started = true;

    const lock = await client.query(
      `SELECT lr.*, e.full_name AS employee_name, e.user_id AS employee_user_id
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
        WHERE lr.id = $1 AND lr.company_id = $2
        FOR UPDATE`,
      [requestId, companyId]
    );
    req = lock.rows[0];
    if (!req) throw new ApiError(404, 'Leave request not found');
    if (req.status !== 'pending') {
      throw new ApiError(400, `Cannot reject request in status: ${req.status}`);
    }

    const r = await client.query(
      `UPDATE leave_requests
          SET status = 'rejected',
              approved_by = $1,
              approved_at = NOW(),
              rejection_reason = $2
        WHERE id = $3
        RETURNING *`,
      [userId, payload.rejection_reason || null, requestId]
    );
    updated = r.rows[0];

    await client.query('COMMIT');
    started = false;

    // ⬇️ إشعار للموظف
    try {
      if (req.employee_user_id) {
        await sendHrNotification({
          companyId,
          settingKey: 'hr_notify_leave_approved',
          userId: req.employee_user_id,
          type: 'hr.leave_rejected',
          title: '❌ تم رفض طلب الإجازة',
          message: `تم رفض طلب إجازتك${payload.rejection_reason ? ' — ' + payload.rejection_reason : ''}`,
          referenceType: 'leave_request',
          referenceId: requestId,
          metadata: { rejection_reason: payload.rejection_reason || null },
          uniqueKey: `leave_rejected:${requestId}`,
        });
      }
    } catch (e) {
      console.error('[leaveService] reject notify failed:', e.message);
    }

    return updated;
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[leaveService.reject] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════════════
const cancel = async (companyId, requestId, payload = {}) => {
  const client = await pool.connect();
  let started = false;
  let req = null;
  let updated = null;

  try {
    await client.query('BEGIN');
    started = true;

    const lock = await client.query(
      `SELECT lr.*, e.full_name AS employee_name, e.user_id AS employee_user_id
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
        WHERE lr.id = $1 AND lr.company_id = $2
        FOR UPDATE`,
      [requestId, companyId]
    );
    req = lock.rows[0];
    if (!req) throw new ApiError(404, 'Leave request not found');
    if (!['pending', 'approved'].includes(req.status)) {
      throw new ApiError(400, `Cannot cancel request in status: ${req.status}`);
    }

    const r = await client.query(
      `UPDATE leave_requests
          SET status = 'cancelled',
              rejection_reason = COALESCE($1, rejection_reason)
        WHERE id = $2
        RETURNING *`,
      [payload.cancel_reason || null, requestId]
    );
    updated = r.rows[0];

    await client.query('COMMIT');
    started = false;

    // ⬇️ إشعار للموظف
    try {
      if (req.employee_user_id) {
        await sendHrNotification({
          companyId,
          settingKey: 'hr_notify_leave_approved',
          userId: req.employee_user_id,
          type: 'hr.leave_cancelled',
          title: '🚫 تم إلغاء طلب الإجازة',
          message: `تم إلغاء طلب الإجازة${payload.cancel_reason ? ' — ' + payload.cancel_reason : ''}`,
          referenceType: 'leave_request',
          referenceId: requestId,
          metadata: { cancel_reason: payload.cancel_reason || null },
          uniqueKey: `leave_cancelled:${requestId}`,
        });
      }
    } catch (e) {
      console.error('[leaveService] cancel notify failed:', e.message);
    }

    return updated;
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[leaveService.cancel] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { createRequest, approve, reject, cancel, daysBetween };