// controllers/LeaveRequestController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/leaveService');
const { pool } = require('../config/pool');
const { isRestrictedToOwn } = require('../middlewares/authMiddleware');

// ═══════════════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════════════
const VIEW_ALL = 'leave_requests.view_all';

const requireEmployeeId = (req) => {
  if (!req.user?.employee_id) {
    throw new ApiError(403, 'هذا الحساب غير مرتبط بموظف — لا يمكن الوصول لطلبات الإجازة');
  }
  return req.user.employee_id;
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-requests
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const { leave_type_id, status, date_from, date_to, page = 1, limit = 20 } = req.query;

  const params = [req.user.company_id];
  const conds = ['lr.company_id = $1'];

  let employee_id = req.query.employee_id;
  if (isRestrictedToOwn(req, VIEW_ALL)) {
    employee_id = requireEmployeeId(req);
  }
  if (employee_id) {
    params.push(employee_id);
    conds.push(`lr.employee_id = $${params.length}`);
  }

  if (leave_type_id) { params.push(leave_type_id); conds.push(`lr.leave_type_id = $${params.length}`); }
  if (status)        { params.push(status);        conds.push(`lr.status = $${params.length}`); }
  if (date_from)     { params.push(date_from);     conds.push(`lr.end_date >= $${params.length}`); }
  if (date_to)       { params.push(date_to);       conds.push(`lr.start_date <= $${params.length}`); }

  const offset = (Number(page) - 1) * Number(limit);
  params.push(limit, offset);

  const rows = await pool.query(
    `SELECT lr.*,
            e.employee_number, e.full_name,
            lt.name AS leave_type_name, lt.is_paid,
            u.name AS approved_by_name
       FROM leave_requests lr
       JOIN employees  e  ON e.id  = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u  ON u.id  = lr.approved_by
      WHERE ${conds.join(' AND ')}
      ORDER BY lr.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM leave_requests lr WHERE ${conds.join(' AND ')}`,
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
// GET /leave-requests/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT lr.*,
            e.employee_number, e.full_name,
            lt.name AS leave_type_name, lt.is_paid,
            u.name AS approved_by_name
       FROM leave_requests lr
       JOIN employees  e  ON e.id  = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u  ON u.id  = lr.approved_by
      WHERE lr.id = $1 AND lr.company_id = $2`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave request not found');

  const record = r.rows[0];
  if (isRestrictedToOwn(req, VIEW_ALL) && record.employee_id !== req.user.employee_id) {
    throw new ApiError(403, 'You can only view your own leave requests');
  }

  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };

  if (isRestrictedToOwn(req, VIEW_ALL)) {
    payload.employee_id = requireEmployeeId(req);
  }

  const record = await service.createRequest(req.user.company_id, req.user.id, payload);
  res.status(201).json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests/:id/approve
// ═══════════════════════════════════════════════════════════════════════════
const approve = asyncHandler(async (req, res) => {
  if (isRestrictedToOwn(req, VIEW_ALL)) {
    throw new ApiError(403, 'You cannot approve leave requests');
  }

  const record = await service.approve(req.user.company_id, req.user.id, req.params.id, req.body || {});
  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests/:id/reject
// ═══════════════════════════════════════════════════════════════════════════
const reject = asyncHandler(async (req, res) => {
  if (isRestrictedToOwn(req, VIEW_ALL)) {
    throw new ApiError(403, 'You cannot reject leave requests');
  }

  const record = await service.reject(req.user.company_id, req.user.id, req.params.id, req.body || {});
  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
const cancel = asyncHandler(async (req, res) => {
  if (isRestrictedToOwn(req, VIEW_ALL)) {
    const own = await pool.query(
      `SELECT 1 FROM leave_requests
        WHERE id = $1 AND employee_id = $2 AND company_id = $3 LIMIT 1`,
      [req.params.id, req.user.employee_id, req.user.company_id]
    );
    if (!own.rowCount) {
      throw new ApiError(403, 'You can only cancel your own leave requests');
    }
  }

  const record = await service.cancel(req.user.company_id, req.params.id, req.body || {});
  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /leave-requests/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  if (isRestrictedToOwn(req, VIEW_ALL)) {
    const own = await pool.query(
      `SELECT 1 FROM leave_requests
        WHERE id = $1 AND employee_id = $2 AND company_id = $3 AND status = 'pending'
        LIMIT 1`,
      [req.params.id, req.user.employee_id, req.user.company_id]
    );
    if (!own.rowCount) {
      throw new ApiError(403, 'You can only delete your own pending requests');
    }
  }

  const r = await pool.query(
    `DELETE FROM leave_requests
      WHERE id = $1 AND company_id = $2 AND status = 'pending'
      RETURNING id`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) {
    throw new ApiError(404, 'Leave request not found or not in pending status');
  }
  res.json({ success: true, message: 'Leave request deleted' });
});

module.exports = { list, getOne, create, approve, reject, cancel, remove };