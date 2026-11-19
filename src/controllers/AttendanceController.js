// controllers/AttendanceController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/attendanceService');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════════════
const isRestricted = (req) => {
  return !req.permissions?.includes('attendance.view_all');
};

const requireEmployeeId = (req) => {
  if (!req.user?.employee_id) {
    throw new ApiError(403, 'هذا الحساب غير مرتبط بموظف — لا يمكن الوصول لسجلات الحضور');
  }
  return req.user.employee_id;
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /attendance
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const { date_from, date_to, status, page = 1, limit = 50 } = req.query;

  const params = [req.user.company_id];
  const conds = ['a.company_id = $1'];

  // ⬇️ تقييد
  let employee_id = req.query.employee_id;
  if (isRestricted(req)) {
    employee_id = requireEmployeeId(req);
  }
  if (employee_id) {
    params.push(employee_id);
    conds.push(`a.employee_id = $${params.length}`);
  }

  if (date_from) { params.push(date_from); conds.push(`a.work_date >= $${params.length}`); }
  if (date_to)   { params.push(date_to);   conds.push(`a.work_date <= $${params.length}`); }
  if (status)    { params.push(status);    conds.push(`a.status = $${params.length}`); }

  const offset = (Number(page) - 1) * Number(limit);
  params.push(limit, offset);

  const rows = await pool.query(
    `SELECT a.*,
            e.employee_number, e.full_name,
            d.name AS department_name
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE ${conds.join(' AND ')}
      ORDER BY a.work_date DESC, e.employee_number
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM attendance a WHERE ${conds.join(' AND ')}`,
    params.slice(0, -2)
  );

  res.json({
    success: true,
    data: {
      items: rows.rows,
      pagination: {
        page: Number(page), limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /attendance/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.*, e.employee_number, e.full_name
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.id = $1 AND a.company_id = $2`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Attendance record not found');

  const record = r.rows[0];
  if (isRestricted(req) && record.employee_id !== req.user.employee_id) {
    throw new ApiError(403, 'You can only view your own attendance records');
  }

  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /attendance/check-in
// ═══════════════════════════════════════════════════════════════════════════
const checkIn = asyncHandler(async (req, res) => {
  const payload = { ...req.body };

  // ⬇️ الموظف يسجّل لنفسه فقط
  if (isRestricted(req)) {
    payload.employee_id = requireEmployeeId(req);
  }

  const record = await service.checkIn(
    req.user.company_id,
    req.user.id,
    payload
  );
  res.status(201).json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /attendance/check-out
// ═══════════════════════════════════════════════════════════════════════════
const checkOut = asyncHandler(async (req, res) => {
  const payload = { ...req.body };

  if (isRestricted(req)) {
    payload.employee_id = requireEmployeeId(req);
  }

  const record = await service.checkOut(
    req.user.company_id,
    req.user.id,
    payload
  );
  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /attendance — upsert يدوي (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const upsert = asyncHandler(async (req, res) => {
  // ⬇️ الموظف لا يستخدم هذه النقطة (يستخدم check-in/check-out)
  if (isRestricted(req)) {
    throw new ApiError(403, 'You cannot manually upsert attendance records');
  }

  const record = await service.upsert(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /attendance/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  // ⬇️ الموظف لا يحذف سجلات الحضور
  if (isRestricted(req)) {
    throw new ApiError(403, 'You cannot delete attendance records');
  }

  const r = await pool.query(
    `DELETE FROM attendance
      WHERE id = $1 AND company_id = $2
      RETURNING id`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Attendance record not found');
  res.json({ success: true, message: 'Attendance record deleted' });
});

module.exports = { list, getOne, checkIn, checkOut, upsert, remove };