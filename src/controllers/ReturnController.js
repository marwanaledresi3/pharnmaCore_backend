// controllers/ReturnController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Return = require('../models/Return');
const service = require('../services/returnService');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/returns
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const {
    return_type,
    status,
    invoice_id,
    date_from,
    date_to,
    search,
    page,
    limit,
  } = req.query;

  const data = await Return.list(req.user.company_id, {
    return_type,
    status,
    invoice_id,
    date_from,
    date_to,
    search,
    page,
    limit,
  });

  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/returns/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const ret = await Return.findById(req.user.company_id, req.params.id);
  if (!ret) throw new ApiError(404, 'Return not found');
  res.json({ success: true, data: ret });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/returns/sales
// ═══════════════════════════════════════════════════════════════════════════
const createSale = asyncHandler(async (req, res) => {
  const ret = await service.createSaleReturn(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: ret });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/returns/purchase
// ═══════════════════════════════════════════════════════════════════════════
const createPurchase = asyncHandler(async (req, res) => {
  const ret = await service.createPurchaseReturn(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: ret });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/returns/:id/confirm
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
// POST /api/returns/:id/cancel
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
  createSale,
  createPurchase,
  confirm,
  cancel,
};