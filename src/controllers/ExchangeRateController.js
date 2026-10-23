const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const ExchangeRate = require('../models/ExchangeRate');
const Currency = require('../models/Currency');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ExchangeRate.list(req.user.company_id, req.query) });
});

const getCurrent = asyncHandler(async (req, res) => {
  const { currency_id, as_of_date } = req.query;
  if (!currency_id) throw new ApiError(400, 'currency_id is required');

  const rate = await ExchangeRate.getCurrent(req.user.company_id, currency_id, as_of_date);
  if (!rate) throw new ApiError(404, 'Exchange rate not found. Please add one.');

  res.json({ success: true, data: { currency_id, ...rate } });
});

const create = asyncHandler(async (req, res) => {
  const { currency_id, rate, rate_date } = req.body;

  // تحقق أن العملة ليست العملة الأساسية
  const company = await pool.query(
    `SELECT currency_id FROM companies WHERE id = $1`,
    [req.user.company_id]
  );
  if (company.rows[0].currency_id === currency_id) {
    throw new ApiError(400, 'Cannot set exchange rate for base currency (always 1)');
  }

  const cur = await Currency.findById(currency_id);
  if (!cur) throw new ApiError(400, 'Currency not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await ExchangeRate.create(client, req.user.company_id, {
      currency_id, rate, rate_date: rate_date || new Date().toISOString().slice(0, 10),
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const updated = await ExchangeRate.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Exchange rate not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  const ok = await ExchangeRate.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Exchange rate not found');
  res.json({ success: true, message: 'Exchange rate deleted' });
});

module.exports = { list, getCurrent, create, update, remove };