const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Customer = require('../models/Customer');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Customer.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const c = await Customer.findById(req.user.company_id, req.params.id);
  if (!c) throw new ApiError(404, 'Customer not found');
  c.balance = await Customer.getBalance(req.user.company_id, c.id);
  res.json({ success: true, data: c });
});

const create = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await Customer.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: c });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const updated = await Customer.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  const check = await pool.query(
    `SELECT 1 FROM sales_orders WHERE customer_id = $1 LIMIT 1`,
    [req.params.id]
  );
  if (check.rowCount) throw new ApiError(400, 'Cannot delete customer with orders');

  const ok = await Customer.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, message: 'Customer deleted' });
});

module.exports = { list, getOne, create, update, remove };