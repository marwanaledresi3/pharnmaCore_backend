const { pool } = require('../config/pool');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const User = require('../models/User');
const passwordUtil = require('../utils/password');

const list = asyncHandler(async (req, res) => {
  const data = await User.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const user = await User.findByIdWithRoles(req.params.id);
  if (!user || user.company_id !== req.user.company_id) {
    throw new ApiError(404, 'User not found');
  }
  res.json({ success: true, data: user });
});

const create = asyncHandler(async (req, res) => {
  const {
    name, email, password, phone, user_type = 'internal',
    is_active = true, branch_id = null, role_ids = [],
  } = req.body;

  if (!['internal', 'external'].includes(user_type)) {
    throw new ApiError(400, 'Invalid user_type');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (await User.emailExists(email, client)) {
      throw new ApiError(409, 'Email already registered');
    }

    if (branch_id) {
      const b = await client.query(
        `SELECT 1 FROM branches WHERE id = $1 AND company_id = $2`,
        [branch_id, req.user.company_id]
      );
      if (!b.rowCount) throw new ApiError(400, 'Branch not found');
    }

    if (role_ids.length) {
      const check = await client.query(
        `SELECT id FROM roles WHERE id = ANY($1::uuid[]) AND company_id = $2`,
        [role_ids, req.user.company_id]
      );
      if (check.rowCount !== role_ids.length) {
        throw new ApiError(400, 'One or more roles are invalid');
      }
    }

    const hash = await passwordUtil.hash(password);
    const user = await User.createWithRoles(client, {
      company_id: req.user.company_id,
      name, email, phone, password_hash: hash,
      user_type, is_active, branch_id, role_ids,
    });

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const { name, email, phone, user_type, branch_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (email && (await User.emailExists(email, client, req.params.id))) {
      throw new ApiError(409, 'Email already registered');
    }

    if (branch_id) {
      const b = await client.query(
        `SELECT 1 FROM branches WHERE id = $1 AND company_id = $2`,
        [branch_id, req.user.company_id]
      );
      if (!b.rowCount) throw new ApiError(400, 'Branch not found');
    }

    const updated = await User.update(req.user.company_id, req.params.id, {
      name, email, phone, user_type, branch_id,
    });
    if (!updated) throw new ApiError(404, 'User not found');

    await client.query('COMMIT');
    res.json({ success: true, data: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const changePassword = asyncHandler(async (req, res) => {
  const hash = await passwordUtil.hash(req.body.password);
  const ok = await User.changePassword(req.params.id, req.user.company_id, hash);
  if (!ok) throw new ApiError(404, 'User not found');
  res.json({ success: true, message: 'Password changed successfully' });
});

const changeStatus = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id && req.body.is_active === false) {
    throw new ApiError(400, 'Cannot deactivate yourself');
  }
  const updated = await User.setStatus(req.params.id, req.user.company_id, req.body.is_active);
  if (!updated) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    throw new ApiError(400, 'Cannot delete yourself');
  }
  const ok = await User.delete(req.params.id, req.user.company_id);
  if (!ok) throw new ApiError(404, 'User not found');
  res.json({ success: true, message: 'User deleted' });
});

const assignRoles = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(
      `SELECT 1 FROM users WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (!u.rowCount) throw new ApiError(404, 'User not found');

    await User.replaceRoles(client, req.user.company_id, req.params.id, req.body.role_ids);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Roles assigned' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = {
  list, getOne, create, update,  changePassword, changeStatus, remove, assignRoles,
};