const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Supplier = require('../models/Supplier');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Supplier.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const s = await Supplier.findById(req.user.company_id, req.params.id);
  if (!s) throw new ApiError(404, 'Supplier not found');
  s.balance = await Supplier.getBalance(req.user.company_id, s.id);
  res.json({ success: true, data: s });
});

const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await Supplier.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: s });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const updated = await Supplier.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Supplier not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  const check = await pool.query(
    `SELECT 1 FROM purchase_orders WHERE supplier_id = $1 LIMIT 1`,
    [req.params.id]
  );
  if (check.rowCount) throw new ApiError(400, 'Cannot delete supplier with orders');

  const ok = await Supplier.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Supplier not found');
  res.json({ success: true, message: 'Supplier deleted' });
});

module.exports = { list, getOne, create, update, remove };