const {pool} = require('../config/pool');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Role = require('../models/Role');
const Permission = require('../models/Permission');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Role.list(req.user.company_id) });
});

const getOne = asyncHandler(async (req, res) => {
  const role = await Role.findByIdWithPermissions(req.user.company_id, req.params.id);
  if (!role) throw new ApiError(404, 'Role not found');
  res.json({ success: true, data: role });
});

const create = asyncHandler(async (req, res) => {
  const { name, description, permission_ids = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!(await Permission.validateIds(client, permission_ids))) {
      throw new ApiError(400, 'One or more permissions are invalid');
    }

    const role = await Role.create(client, req.user.company_id, { name, description });
    if (permission_ids.length) {
      await Role.replacePermissions(client, role.id, permission_ids);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: role });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const updated = await Role.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Role not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  const ok = await Role.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Role not found or is a system role');
  res.json({ success: true, message: 'Role deleted' });
});

const assignPermissions = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const role = await Role.findById(req.user.company_id, req.params.id);
    if (!role) throw new ApiError(404, 'Role not found');
    if (role.is_system) throw new ApiError(400, 'Cannot modify permissions of a system role');

    if (!(await Permission.validateIds(client, req.body.permission_ids))) {
      throw new ApiError(400, 'One or more permissions are invalid');
    }

    await Role.replacePermissions(client, req.params.id, req.body.permission_ids);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Permissions assigned' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const listPermissions = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Permission.listGroupedByModule() });
});

module.exports = { list, getOne, create, update, remove, assignPermissions, listPermissions };