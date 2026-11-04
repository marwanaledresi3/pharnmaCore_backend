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
  const result = await service.confirm(
    req.user.company_id,
    req.user.id,
    req.params.id,
    {
      deliveryToken: req.body?.delivery_token,
      usedMode: req.body?.used_mode,
    }
  );
  res.json({ success: true, data: result });
});

const cancel = asyncHandler(async (req, res) => {
  // نمرّر userId للتوثيق (مستقبلاً قد ننشئ سجل تدقيق)
  const result = await service.cancel(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: result });
});

const getIncoming = asyncHandler(async (req, res) => {
  const data = await PurchaseOrder.getIncoming(req.user.company_id);
  res.json({ success: true, data });
});

const approve = asyncHandler(async (req, res) => {
  const result = await service.approve(
    req.user.company_id,
    req.user.id,
    req.params.id,
    {
      itemAdjustments: req.body.item_adjustments || [],
      qrMode: req.body.qr_mode,
      qrTtlDays: req.body.qr_ttl_days,
    }
  );
  res.json({
    success: true,
    message: 'Purchase order approved successfully',
    data: result,
  });
});

const reject = asyncHandler(async (req, res) => {
  const result = await service.reject(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body.reason
  );
  res.json({
    success: true,
    message: 'Purchase order rejected',
    data: result,
  });
});
const previewByToken = asyncHandler(async (req, res) => {
  const data = await service.previewByToken(req.query.token);
  if (!data) throw new ApiError(404, 'Delivery token not found or expired');
  res.json({ success: true, data });
});

const confirmByToken = asyncHandler(async (req, res) => {
  const result = await service.confirmByToken(
    req.user.company_id,
    req.user.id,
    req.body.token,
    { usedMode: req.body.used_mode || 'authenticated' }
  );
  res.json({ success: true, data: result });
});


module.exports = {
  list,
  getOne,
  create,
  confirm,
  cancel,
  getIncoming,
  approve,
  reject,
  previewByToken,
  confirmByToken
};