const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Payment = require('../models/Payment');
const service = require('../services/paymentService');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Payment.list(req.user.company_id, req.query) });
});

const create = asyncHandler(async (req, res) => {
  if (!req.body.invoice_id) throw new ApiError(400, 'invoice_id is required');

  // نحدد النوع من الفاتورة نفسها
  const invType = req.body.payment_type;

  // إذا لم يُحدّد، نترك للـ service يحدد حسب invoice_type
  if (invType === 'pay') {
    const result = await service.createForPurchaseInvoice(req.user.company_id, req.user.id, req.body);
    return res.status(201).json({ success: true, data: result });
  }

  const result = await service.createForInvoice(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: result });
});

const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.user.company_id, req.params.id);
  res.json({ success: true, data: result });
});
const refundToCustomer = asyncHandler(async (req, res) => {
  const result = await service.refundToCustomer(
    req.user.company_id, req.user.id, req.body
  );
  res.status(201).json({ success: true, data: result });
});

const applyCredit = asyncHandler(async (req, res) => {
  const result = await service.applyCreditToInvoice(
    req.user.company_id, req.user.id, req.body
  );
  res.status(201).json({ success: true, data: result });
});

// أضف إلى module.exports
module.exports = { list, create, remove, refundToCustomer, applyCredit };