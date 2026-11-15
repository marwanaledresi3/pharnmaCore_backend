// controllers/ExpenseController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/expenseService');
const Expense = require('../models/Expense');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/expenses
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const {
    status,
    category,
    supplier_id,
    date_from,
    date_to,
    search,
    page,
    limit,
  } = req.query;

  const data = await Expense.list(req.user.company_id, {
    status,
    category,
    supplier_id,
    date_from,
    date_to,
    search,
    page,
    limit,
  });

  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/expenses/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const exp = await Expense.findById(req.user.company_id, req.params.id);
  if (!exp) throw new ApiError(404, 'Expense not found');
  res.json({ success: true, data: exp });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/expenses
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const result = await service.create(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/expenses/:id/pay
// ═══════════════════════════════════════════════════════════════════════════
const pay = asyncHandler(async (req, res) => {
  const result = await service.pay(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/expenses/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(
    req.user.company_id,
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/expenses/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  await service.remove(
    req.user.company_id,
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: { deleted: true } });
});

module.exports = {
  list,
  getOne,
  create,
  pay,
  cancel,
  remove,
};