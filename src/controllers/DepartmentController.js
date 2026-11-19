// controllers/DepartmentController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Department = require('../models/Department');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// GET /departments
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const data = await Department.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /departments/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const dept = await Department.findById(req.user.company_id, req.params.id);
  if (!dept) throw new ApiError(404, 'Department not found');
  res.json({ success: true, data: dept });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /departments
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // فحص parent_id (إن وُجد) — يجب أن يكون في نفس الشركة
    if (req.body.parent_id) {
      const parent = await client.query(
        `SELECT 1 FROM departments WHERE id = $1 AND company_id = $2`,
        [req.body.parent_id, req.user.company_id]
      );
      if (!parent.rowCount) {
        throw new ApiError(400, 'Parent department not found in this company');
      }
    }

    // فحص manager_id (إن وُجد) — يجب أن يكون موظفاً في نفس الشركة
    if (req.body.manager_id) {
      const mgr = await client.query(
        `SELECT 1 FROM employees WHERE id = $1 AND company_id = $2`,
        [req.body.manager_id, req.user.company_id]
      );
      if (!mgr.rowCount) {
        throw new ApiError(400, 'Manager employee not found in this company');
      }
    }

    const dept = await Department.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /departments/:id
// ═══════════════════════════════════════════════════════════════════════════
const update = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // فحص parent_id (إن وُجد) — ليس نفس القسم + موجود في نفس الشركة
    if (req.body.parent_id) {
      if (req.body.parent_id === req.params.id) {
        throw new ApiError(400, 'Department cannot be its own parent');
      }
      const parent = await client.query(
        `SELECT 1 FROM departments WHERE id = $1 AND company_id = $2`,
        [req.body.parent_id, req.user.company_id]
      );
      if (!parent.rowCount) {
        throw new ApiError(400, 'Parent department not found in this company');
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

    const updated = await Department.update(req.user.company_id, req.params.id, req.body);
    if (!updated) throw new ApiError(404, 'Department not found');

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
// DELETE /departments/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  // فحص: هل هناك أقسام فرعية؟
  const children = await pool.query(
    `SELECT 1 FROM departments WHERE parent_id = $1 AND company_id = $2 LIMIT 1`,
    [req.params.id, req.user.company_id]
  );
  if (children.rowCount) {
    throw new ApiError(400, 'Cannot delete department with sub-departments');
  }

  // فحص: هل هناك موظفون في هذا القسم؟
  const employees = await pool.query(
    `SELECT 1 FROM employees WHERE department_id = $1 AND company_id = $2 LIMIT 1`,
    [req.params.id, req.user.company_id]
  );
  if (employees.rowCount) {
    throw new ApiError(400, 'Cannot delete department with employees');
  }

  const ok = await Department.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Department not found');
  res.json({ success: true, message: 'Department deleted' });
});

module.exports = { list, getOne, create, update, remove };