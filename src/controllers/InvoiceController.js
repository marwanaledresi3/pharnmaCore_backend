const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const service = require('../services/invoiceService');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Invoice.list(req.user.company_id, req.query) });
});

const getOne = asyncHandler(async (req, res) => {
  const inv = await Invoice.findById(req.user.company_id, req.params.id);
  if (!inv) throw new ApiError(404, 'Invoice not found');
  res.json({ success: true, data: inv });
});

const createFromOrder = asyncHandler(async (req, res) => {
  const inv = await service.createFromOrder(
    req.user.company_id, req.user.id, req.params.orderId, req.body
  );
  res.status(201).json({ success: true, data: inv });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(req.user.company_id, req.params.id);
  res.json({ success: true, data: result });
});

const getPayments = asyncHandler(async (req, res) => {
  const inv = await Invoice.findById(req.user.company_id, req.params.id);
  if (!inv) throw new ApiError(404, 'Invoice not found');
  res.json({ success: true, data: inv.payments });
});

const createFromPurchaseOrder = asyncHandler(async (req, res) => {
  const inv = await service.createFromPurchaseOrder(
    req.user.company_id, req.user.id, req.params.orderId, req.body
  );
  res.status(201).json({ success: true, data: inv });
});

// أضفه إلى module.exports
module.exports = { list, getOne, createFromOrder, createFromPurchaseOrder, cancel, getPayments };