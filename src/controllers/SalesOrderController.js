// controllers/SalesOrderController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const SalesOrder = require('../models/SalesOrder');
const service = require('../services/salesOrderService');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sales-orders
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const {
    status,
    customer_id,
    warehouse_id,       
    date_from,
    date_to,
    search,
    has_journal_entry,
    page,
    limit,
  } = req.query;

  const data = await SalesOrder.list(req.user.company_id, {
    status,
    customer_id,
    warehouse_id,
    date_from,
    date_to,
    search,
    has_journal_entry:
      has_journal_entry === undefined
        ? undefined
        : has_journal_entry === 'true',
    page,
    limit,
  });

  res.json({ success: true, data });
});
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sales-orders/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.user.company_id, req.params.id);
  if (!order) throw new ApiError(404, 'Sales order not found');
  res.json({ success: true, data: order });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sales-orders
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const order = await service.create(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: order });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sales-orders/:id/confirm
// ═══════════════════════════════════════════════════════════════════════════
const confirm = asyncHandler(async (req, res) => {
  const result = await service.confirm(
    req.user.company_id,
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sales-orders/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(
    req.user.company_id,
    req.user.id,        // ← userId (كان مفقوداً)
    req.params.id
  );
  res.json({ success: true, data: result });
});

module.exports = {
  list,
  getOne,
  create,
  confirm,
  cancel,
};