// controllers/JobTitleController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const JobTitle = require('../models/JobTitle');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// GET /job-titles
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await JobTitle.list(req.user.company_id) });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /job-titles/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const jt = await JobTitle.findById(req.user.company_id, req.params.id);
  if (!jt) throw new ApiError(404, 'Job title not found');
  res.json({ success: true, data: jt });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /job-titles
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

    const jt = await JobTitle.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: jt });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /job-titles/:id
// ═══════════════════════════════════════════════════════════════════════════
const update = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (req.body.department_id) {
      const dept = await client.query(
        `SELECT 1 FROM departments WHERE id = $1 AND company_id = $2`,
        [req.body.department_id, req.user.company_id]
      );
      if (!dept.rowCount) {
        throw new ApiError(400, 'Department not found in this company');
      }
    }

    const updated = await JobTitle.update(req.user.company_id, req.params.id, req.body);
    if (!updated) throw new ApiError(404, 'Job title not found');

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
// DELETE /job-titles/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  // فحص: هل هناك موظفون بهذا المسمى؟
  const employees = await pool.query(
    `SELECT 1 FROM employees WHERE job_title_id = $1 AND company_id = $2 LIMIT 1`,
    [req.params.id, req.user.company_id]
  );
  if (employees.rowCount) {
    throw new ApiError(400, 'Cannot delete job title assigned to employees');
  }

  const ok = await JobTitle.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Job title not found');
  res.json({ success: true, message: 'Job title deleted' });
});

module.exports = { list, getOne, create, update, remove };