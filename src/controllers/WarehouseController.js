const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Warehouse = require('../models/Warehouse');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Warehouse.list(req.user.company_id) });
});

const getOne = asyncHandler(async (req, res) => {
  const wh = await Warehouse.findById(req.user.company_id, req.params.id);
  if (!wh) throw new ApiError(404, 'Warehouse not found');
  res.json({ success: true, data: wh });
});

const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wh = await Warehouse.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: wh });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const updated = await Warehouse.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Warehouse not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  const check = await pool.query(
    `SELECT 1 FROM product_batches WHERE warehouse_id = $1 AND quantity > 0 LIMIT 1`,
    [req.params.id]
  );
  if (check.rowCount) throw new ApiError(400, 'Cannot delete warehouse with stock');

  const ok = await Warehouse.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Warehouse not found');
  res.json({ success: true, message: 'Warehouse deleted' });
});

module.exports = { list, getOne, create, update, remove };