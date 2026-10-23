const {pool} = require('../config/pool');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const User = require('../models/User');
const Role = require('../models/Role');
const passwordUtil = require('../utils/password');

const list = asyncHandler(async (req, res) => {
  const data = await User.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const user = await User.findByIdWithRoles(req.params.id);
  if (!user || user.company_id !== req.user.company_id) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: user });
});

const create = asyncHandler(async (req, res) => {
  const { name, email, password, user_type, is_active, role_ids = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (await User.findByEmail(email)) throw new ApiError(409, 'Email already registered');

    if (role_ids.length) {
      const check = await client.query(
        `SELECT id FROM roles WHERE id = ANY($1::uuid[]) AND company_id = $2`,
        [role_ids, req.user.company_id]
      );
      if (check.rowCount !== role_ids.length) throw new ApiError(400, 'One or more roles are invalid');
    }

    const hash = await passwordUtil.hash(password);
    const user = await User.createWithRoles(client, {
      company_id: req.user.company_id,
      name,
      email,
      password_hash: hash,
      user_type,
      is_active,
      role_ids,
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
  const updated = await User.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: updated });
});

const changePassword = asyncHandler(async (req, res) => {
  const hash = await passwordUtil.hash(req.body.password);
  const ok = await User.changePassword(req.params.id, req.user.company_id, hash);
  if (!ok) throw new ApiError(404, 'User not found');
  res.json({ success: true, message: 'Password changed successfully' });
});

const changeStatus = asyncHandler(async (req, res) => {
  const updated = await User.setStatus(req.params.id, req.user.company_id, req.body.is_active);
  if (!updated) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw new ApiError(400, 'Cannot delete yourself');
  const ok = await User.delete(req.params.id, req.user.company_id);
  if (!ok) throw new ApiError(404, 'User not found');
  res.json({ success: true, message: 'User deleted' });
});

const assignRoles = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(`SELECT 1 FROM users WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.company_id]);
    if (!u.rowCount) throw new ApiError(404, 'User not found');

    if (req.body.role_ids.length) {
      const check = await client.query(
        `SELECT id FROM roles WHERE id = ANY($1::uuid[]) AND company_id = $2`,
        [req.body.role_ids, req.user.company_id]
      );
      if (check.rowCount !== req.body.role_ids.length) throw new ApiError(400, 'One or more roles are invalid');
    }

    await User.replaceRoles(client, req.params.id, req.body.role_ids);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Roles assigned' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = { list, getOne, create, update, changePassword, changeStatus, remove, assignRoles };