// controllers/LeaveTypeController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-types
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const { is_active } = req.query;
  const params = [req.user.company_id];
  const conds = ['company_id = $1'];

  if (is_active !== undefined) {
    params.push(is_active);
    conds.push(`is_active = $${params.length}`);
  }

  const r = await pool.query(
    `SELECT id, name, code, annual_days, is_paid, requires_approval,
            carry_over_allowed, max_carry_over_days, is_active, created_at
       FROM leave_types
      WHERE ${conds.join(' AND ')}
      ORDER BY name`,
    params
  );
  res.json({ success: true, data: r.rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-types/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT * FROM leave_types WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave type not found');
  res.json({ success: true, data: r.rows[0] });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-types
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // فحص تكرار code (إن وُجد) — القيد UNIQUE في DB سيرفض، لكن نعطي رسالة أوضح
    if (req.body.code) {
      const dup = await client.query(
        `SELECT 1 FROM leave_types WHERE company_id = $1 AND code = $2`,
        [req.user.company_id, req.body.code]
      );
      if (dup.rowCount) {
        throw new ApiError(400, `Leave type with code '${req.body.code}' already exists`);
      }
    }

    const r = await client.query(
      `INSERT INTO leave_types (
         company_id, name, code, annual_days, is_paid,
         requires_approval, carry_over_allowed, max_carry_over_days, is_active
       ) VALUES (
         $1, $2, $3, COALESCE($4, 0), COALESCE($5, true),
         COALESCE($6, true), COALESCE($7, false), COALESCE($8, 0), COALESCE($9, true)
       )
       RETURNING *`,
      [
        req.user.company_id,
        req.body.name,
        req.body.code || null,
        req.body.annual_days,
        req.body.is_paid,
        req.body.requires_approval,
        req.body.carry_over_allowed,
        req.body.max_carry_over_days,
        req.body.is_active,
      ]
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
// PATCH /leave-types/:id
// ═══════════════════════════════════════════════════════════════════════════
const update = asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'code', 'annual_days', 'is_paid',
    'requires_approval', 'carry_over_allowed',
    'max_carry_over_days', 'is_active',
  ];
  const fields = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      params.push(req.body[k]);
      fields.push(`${k} = $${params.length}`);
    }
  }
  if (!fields.length) throw new ApiError(400, 'No fields to update');

  params.push(req.params.id, req.user.company_id);
  const r = await pool.query(
    `UPDATE leave_types SET ${fields.join(', ')}
      WHERE id = $${params.length - 1} AND company_id = $${params.length}
      RETURNING *`,
    params
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave type not found');
  res.json({ success: true, data: r.rows[0] });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /leave-types/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  // فحص: هل هناك طلبات إجازة تستخدم هذا النوع؟
  const used = await pool.query(
    `SELECT 1 FROM leave_requests WHERE leave_type_id = $1 AND company_id = $2 LIMIT 1`,
    [req.params.id, req.user.company_id]
  );
  if (used.rowCount) {
    throw new ApiError(400, 'Cannot delete leave type used by requests. Deactivate it instead.');
  }

  // فحص: هل هناك أرصدة؟
  const balances = await pool.query(
    `SELECT 1 FROM leave_balances WHERE leave_type_id = $1 AND company_id = $2 LIMIT 1`,
    [req.params.id, req.user.company_id]
  );
  if (balances.rowCount) {
    throw new ApiError(400, 'Cannot delete leave type with balances. Deactivate it instead.');
  }

  const r = await pool.query(
    `DELETE FROM leave_types WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Leave type not found');
  res.json({ success: true, message: 'Leave type deleted' });
});

module.exports = { list, getOne, create, update, remove };