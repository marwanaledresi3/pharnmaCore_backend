const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/expenseService');
const Expense = require('../models/Expense');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Expense.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const exp = await Expense.findById(req.user.company_id, req.params.id);
  if (!exp) throw new ApiError(404, 'Expense not found');
  res.json({ success: true, data: exp });
});

const create = asyncHandler(async (req, res) => {
  const result = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: result });
});

const pay = asyncHandler(async (req, res) => {
  const result = await service.pay(req.user.company_id, req.user.id, req.params.id, req.body);
  res.json({ success: true, data: result });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: result });
});
const remove = asyncHandler(async (req, res) => {
  await service.remove(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: { deleted: true } });
});
module.exports = { list, getOne, create, pay, cancel,remove };