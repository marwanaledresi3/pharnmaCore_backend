// controllers/EmployeeController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Employee = require('../models/Employee');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// GET /employees
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const data = await Employee.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /employees/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const emp = await Employee.findById(req.user.company_id, req.params.id);
  if (!emp) throw new ApiError(404, 'Employee not found');
  res.json({ success: true, data: emp });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /employees
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // فحص department_id (إن وُجد)
    if (req.body.department_id) {
      const dept = await client.query(
        `SELECT 1 FROM departments WHERE id = $1 AND company_id = $2`,
        [req.body.department_id, req.user.company_id]
      );
      if (!dept.rowCount) {
        throw new ApiError(400, 'Department not found in this company');
      }
    }

    // فحص job_title_id (إن وُجد)
    if (req.body.job_title_id) {
      const jt = await client.query(
        `SELECT 1 FROM job_titles WHERE id = $1 AND company_id = $2`,
        [req.body.job_title_id, req.user.company_id]
      );
      if (!jt.rowCount) {
        throw new ApiError(400, 'Job title not found in this company');
      }
    }

    // فحص manager_id (إن وُجد)
    if (req.body.manager_id) {
      const mgr = await client.query(
        `SELECT 1 FROM employees WHERE id = $1 AND company_id = $2`,
        [req.body.manager_id, req.user.company_id]
      );
      if (!mgr.rowCount) {
        throw new ApiError(400, 'Manager employee not found in this company');
      }
    }

    // فحص user_id (إن وُجد) — يجب أن يكون في نفس الشركة وغير مرتبط بموظف آخر
    if (req.body.user_id) {
      const u = await client.query(
        `SELECT 1 FROM users WHERE id = $1 AND company_id = $2`,
        [req.body.user_id, req.user.company_id]
      );
      if (!u.rowCount) {
        throw new ApiError(400, 'User not found in this company');
      }
      const existing = await client.query(
        `SELECT 1 FROM employees WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
        [req.body.user_id, req.user.company_id]
      );
      if (existing.rowCount) {
        throw new ApiError(400, 'This user is already linked to another employee');
      }
    }

    const emp = await Employee.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: emp });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /employees/:id
// ═══════════════════════════════════════════════════════════════════════════
const update = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // فحص department_id (إن وُجد)
    if (req.body.department_id) {
      const dept = await client.query(
        `SELECT 1 FROM departments WHERE id = $1 AND company_id = $2`,
        [req.body.department_id, req.user.company_id]
      );
      if (!dept.rowCount) throw new ApiError(400, 'Department not found in this company');
    }

    // فحص job_title_id (إن وُجد)
    if (req.body.job_title_id) {
      const jt = await client.query(
        `SELECT 1 FROM job_titles WHERE id = $1 AND company_id = $2`,
        [req.body.job_title_id, req.user.company_id]
      );
      if (!jt.rowCount) throw new ApiError(400, 'Job title not found in this company');
    }

    // فحص manager_id (إن وُجد) — ليس نفسه
    if (req.body.manager_id) {
      if (req.body.manager_id === req.params.id) {
        throw new ApiError(400, 'Employee cannot be their own manager');
      }
      const mgr = await client.query(
        `SELECT 1 FROM employees WHERE id = $1 AND company_id = $2`,
        [req.body.manager_id, req.user.company_id]
      );
      if (!mgr.rowCount) throw new ApiError(400, 'Manager employee not found in this company');
    }

    // فحص user_id (إن وُجد)
    if (req.body.user_id) {
      const u = await client.query(
        `SELECT 1 FROM users WHERE id = $1 AND company_id = $2`,
        [req.body.user_id, req.user.company_id]
      );
      if (!u.rowCount) throw new ApiError(400, 'User not found in this company');

      const existing = await client.query(
        `SELECT id FROM employees
          WHERE user_id = $1 AND company_id = $2 AND id <> $3 LIMIT 1`,
        [req.body.user_id, req.user.company_id, req.params.id]
      );
      if (existing.rowCount) {
        throw new ApiError(400, 'This user is already linked to another employee');
      }
    }

    const updated = await Employee.update(req.user.company_id, req.params.id, req.body);
    if (!updated) throw new ApiError(404, 'Employee not found');

    await client.query('COMMIT');
    res.json({ success: true, data: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /employees/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  // فحص: هل الموظف مدير قسم؟
  const isMgr = await pool.query(
    `SELECT 1 FROM departments WHERE manager_id = $1 AND company_id = $2 LIMIT 1`,
    [req.params.id, req.user.company_id]
  );
  if (isMgr.rowCount) {
    throw new ApiError(400, 'Cannot delete employee who is a department manager. Reassign the department first.');
  }

  // فحص: هل الموظف له مسيرات رواتب؟
  const hasPayroll = await pool.query(
    `SELECT 1 FROM payroll_items WHERE employee_id = $1 LIMIT 1`,
    [req.params.id]
  );
  if (hasPayroll.rowCount) {
    throw new ApiError(400, 'Cannot delete employee with payroll history. Set status to "terminated" instead.');
  }

  // فحص: هل الموظف له حضور؟
  const hasAtt = await pool.query(
    `SELECT 1 FROM attendance WHERE employee_id = $1 LIMIT 1`,
    [req.params.id]
  );
  if (hasAtt.rowCount) {
    throw new ApiError(400, 'Cannot delete employee with attendance records. Set status to "terminated" instead.');
  }

  const ok = await Employee.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Employee not found');
  res.json({ success: true, message: 'Employee deleted' });
});

module.exports = { list, getOne, create, update, remove };