const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Currency = require('../models/Currency');
const ExchangeRate = require('../models/ExchangeRate');
const currencyUtil = require('../utils/currency');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Currency.list() });
});

const create = asyncHandler(async (req, res) => {
  const existing = await Currency.findByCode(req.body.code);
  if (existing) throw new ApiError(409, 'Currency code already exists');
  const currency = await Currency.create(req.body);
  res.status(201).json({ success: true, data: currency });
});

const update = asyncHandler(async (req, res) => {
  const updated = await Currency.update(req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Currency not found');
  res.json({ success: true, data: updated });
});

/**
 * تحويل مبلغ من عملة إلى العملة الأساسية
 * POST /currencies/convert
 * Body: { amount, currency_id, as_of_date? }
 */
const convert = asyncHandler(async (req, res) => {
  const { amount, currency_id, as_of_date } = req.body;
  const result = await currencyUtil.toBase(
    req.user.company_id, amount, currency_id, as_of_date
  );
  res.json({ success: true, data: { ...result, amount_original: amount, currency_id } });
});

module.exports = { list, create, update, convert };