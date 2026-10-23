const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const PurchaseOrder = require('../models/PurchaseOrder');
const service = require('../services/purchaseOrderService');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await PurchaseOrder.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.user.company_id, req.params.id);
  if (!order) throw new ApiError(404, 'Purchase order not found');
  res.json({ success: true, data: order });
});

const create = asyncHandler(async (req, res) => {
  const order = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: order });
});

const confirm = asyncHandler(async (req, res) => {
  const result = await service.confirm(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: result });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(req.user.company_id, req.params.id);
  res.json({ success: true, data: result });
});

module.exports = { list, getOne, create, confirm, cancel };