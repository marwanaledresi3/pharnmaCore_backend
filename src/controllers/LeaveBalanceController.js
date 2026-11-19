// controllers/LeaveBalanceController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { pool } = require('../config/pool');

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const isRestricted = (req) => !req.permissions?.includes('leave_balances.view_all');
const requireEmployeeId = (req) => {
  if (!req.user?.employee_id) {
    throw new ApiError(403, 'هذا الحساب غير مرتبط بموظف');
  }
  return req.user.employee_id;
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-balances
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const { leave_type_id, year } = req.query;

  const params = [req.user.company_id];
  const conds = ['lb.company_id = $1'];

  // ⬇️ تقييد
  let employee_id = req.query.employee_id;
  if (isRestricted(req)) employee_id = requireEmployeeId(req);
  if (employee_id) {
    params.push(employee_id);
    conds.push(`lb.employee_id = $${params.length}`);
  }

  if (leave_type_id) {
    params.push(leave_type_id);
    conds.push(`lb.leave_type_id = $${params.length}`);
  }
  if (year) {
    params.push(year);
    conds.push(`lb.year = $${params.length}`);
  }

  const r = await pool.query(
    `SELECT lb.*,
            e.employee_number, e.full_name,
            lt.name AS leave_type_name,
            (lb.entitled_days + lb.carried_days - lb.used_days) AS available_days
       FROM leave_balances lb
       JOIN employees   e  ON e.id  = lb.employee_id
       JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE ${conds.join(' AND ')}
      ORDER BY e.employee_number, lt.name, lb.year DESC`,
    params
  );
  res.json({ success: true, data: r.rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-balances/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT lb.*,
            e.employee_number, e.full_name,
            lt.name AS leave_type_name,
            (lb.entitled_days + lb.carried_days - lb.used_days) AS available_days
       FROM leave_balances lb
       JOIN employees   e  ON e.id  = lb.employee_id
       JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.id = $1 AND lb.company_id = $2`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave balance not found');

  const record = r.rows[0];
  if (isRestricted(req) && record.employee_id !== req.user.employee_id) {
    throw new ApiError(403, 'You can only view your own leave balances');
  }

  res.json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-balances/employee/:employeeId
// ═══════════════════════════════════════════════════════════════════════════
const byEmployee = asyncHandler(async (req, res) => {
  // ⬇️ تقييد — الموظف يرى رصيده فقط
  if (isRestricted(req)) {
    const ownId = requireEmployeeId(req);
    if (req.params.employeeId !== ownId) {
      throw new ApiError(403, 'You can only view your own leave balances');
    }
  }

  const { year } = req.query;
  const params = [req.user.company_id, req.params.employeeId];
  let yearCond = '';
  if (year) {
    params.push(year);
    yearCond = ` AND lb.year = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT lb.*,
            lt.name AS leave_type_name,
            lt.annual_days AS default_annual_days,
            (lb.entitled_days + lb.carried_days - lb.used_days) AS available_days
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.company_id = $1 AND lb.employee_id = $2${yearCond}
      ORDER BY lb.year DESC, lt.name`,
    params
  );
  res.json({ success: true, data: r.rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-balances — إنشاء يدوي (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'You cannot create leave balances');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { employee_id, leave_type_id, year, entitled_days, used_days, carried_days } = req.body;

    const emp = await client.query(
      `SELECT 1 FROM employees WHERE id = $1 AND company_id = $2`,
      [employee_id, req.user.company_id]
    );
    if (!emp.rowCount) throw new ApiError(404, 'Employee not found');

    const lt = await client.query(
      `SELECT 1 FROM leave_types WHERE id = $1 AND company_id = $2`,
      [leave_type_id, req.user.company_id]
    );
    if (!lt.rowCount) throw new ApiError(404, 'Leave type not found');

    const dup = await client.query(
      `SELECT 1 FROM leave_balances
        WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employee_id, leave_type_id, year]
    );
    if (dup.rowCount) {
      throw new ApiError(400, 'Leave balance already exists for this employee/type/year');
    }

    const r = await client.query(
      `INSERT INTO leave_balances (
         company_id, employee_id, leave_type_id, year,
         entitled_days, used_days, carried_days
       ) VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, 0), COALESCE($7, 0))
       RETURNING *`,
      [req.user.company_id, employee_id, leave_type_id, year,
       entitled_days, used_days, carried_days]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /leave-balances/:id — تعديل (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const update = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'You cannot modify leave balances');
  }

  const allowed = ['entitled_days', 'carried_days'];
  const fields = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      params.push(req.body[k]);
      fields.push(`${k} = $${params.length}`);
    }
  }
  if (!fields.length) throw new ApiError(400, 'No updatable fields');

  params.push(req.params.id, req.user.company_id);
  const r = await pool.query(
    `UPDATE leave_balances SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 1} AND company_id = $${params.length}
      RETURNING *`,
    params
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave balance not found');
  res.json({ success: true, data: r.rows[0] });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-balances/reset/:employeeId (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const resetForYear = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'You cannot reset leave balances');
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;

    const { employee_id } = req.params;
    const { year, carry_over = true } = req.body;

    const emp = await client.query(
      `SELECT 1 FROM employees WHERE id = $1 AND company_id = $2`,
      [employee_id, req.user.company_id]
    );
    if (!emp.rowCount) throw new ApiError(404, 'Employee not found');

    const types = await client.query(
      `SELECT id, annual_days, carry_over_allowed, max_carry_over_days
         FROM leave_types WHERE company_id = $1 AND is_active = true`,
      [req.user.company_id]
    );

    const results = [];
    for (const lt of types.rows) {
      const existing = await client.query(
        `SELECT 1 FROM leave_balances
          WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
        [employee_id, lt.id, year]
      );
      if (existing.rowCount) continue;

      let carried = 0;
      if (carry_over && lt.carry_over_allowed) {
        const prev = await client.query(
          `SELECT (entitled_days + carried_days - used_days) AS available
             FROM leave_balances
            WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
          [employee_id, lt.id, year - 1]
        );
        if (prev.rowCount) {
          const available = Number(prev.rows[0].available) || 0;
          carried = Math.min(available, Number(lt.max_carry_over_days) || 0);
          carried = round1(Math.max(carried, 0));
        }
      }

      const r = await client.query(
        `INSERT INTO leave_balances (
           company_id, employee_id, leave_type_id, year,
           entitled_days, used_days, carried_days
         ) VALUES ($1, $2, $3, $4, $5, 0, $6)
         RETURNING *`,
        [req.user.company_id, employee_id, lt.id, year, lt.annual_days || 0, carried]
      );
      results.push(r.rows[0]);
    }

    await client.query('COMMIT');
    started = false;
    res.json({ success: true, data: results, created: results.length });
  } catch (err) {
    if (started) { try { await client.query('ROLLBACK'); } catch (e) {} }
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /leave-balances/:id (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'You cannot delete leave balances');
  }

  const used = await pool.query(
    `SELECT 1 FROM leave_requests lr
       JOIN leave_balances lb
         ON lb.employee_id = lr.employee_id
        AND lb.leave_type_id = lr.leave_type_id
        AND lb.year = EXTRACT(YEAR FROM lr.start_date)::int
      WHERE lb.id = $1 AND lr.status = 'approved'
      LIMIT 1`,
    [req.params.id]
  );
  if (used.rowCount) {
    throw new ApiError(400, 'Cannot delete leave balance with approved requests');
  }

  const r = await pool.query(
    `DELETE FROM leave_balances WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave balance not found');
  res.json({ success: true, message: 'Leave balance deleted' });
});

module.exports = { list, getOne, byEmployee, create, update, resetForYear, remove };