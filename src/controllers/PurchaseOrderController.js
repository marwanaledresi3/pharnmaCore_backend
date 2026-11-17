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
  const body = {
    ...req.body,
    user_branch_id: req.user.branch_id || null,
  };

  const result = await service.create(
    req.user.company_id,
    req.user.id,
    body
  );
  res.status(201).json({ success: true, data: result });
});

const confirm = asyncHandler(async (req, res) => {
  try {
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

  } catch (err) {
    // ─── طباعة تفاصيل الخطأ كاملة ───
    console.error('err     :', err);


    // ─── رجّع تفاصيل الخطأ للعميل (مؤقتاً للتشخيص) ───
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'فشل تأكيد الطلب',
      error: {
        name:       err.name,
        code:       err.code,
        detail:     err.detail,
        hint:       err.hint,
        constraint: err.constraint,
        table:      err.table,
        where:      err.where,
      },
      // احذف هذا الجزء في الإنتاج
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
  }
});

const cancel = asyncHandler(async (req, res) => {
  // نمرّر userId للتوثيق (مستقبلاً قد ننشئ سجل تدقيق)
  const result = await service.cancel(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: result });
});

const getIncoming = asyncHandler(async (req, res) => {
  const data = await PurchaseOrder.getIncoming(req.user.company_id, {
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    date_from: req.query.date_from,
    date_to: req.query.date_to,
  });
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