const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Return = require('../models/Return');
const service = require('../services/returnService');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Return.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const ret = await Return.findById(req.user.company_id, req.params.id);
  if (!ret) throw new ApiError(404, 'Return not found');
  res.json({ success: true, data: ret });
});

const createSale = asyncHandler(async (req, res) => {
  const ret = await service.createSaleReturn(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: ret });
});

const createPurchase = asyncHandler(async (req, res) => {
  const ret = await service.createPurchaseReturn(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: ret });
});

const confirm = asyncHandler(async (req, res) => {
  const result = await service.confirm(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: result });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(req.user.company_id, req.params.id);
  res.json({ success: true, data: result });
});

module.exports = { list, getOne, createSale, createPurchase, confirm, cancel };