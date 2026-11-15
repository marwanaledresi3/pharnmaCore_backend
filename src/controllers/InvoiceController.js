// controllers/InvoiceController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const service = require('../services/invoiceService');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/invoices
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const {
    status,
    invoice_type,
    customer_id,
    supplier_id,
    reference_type,
    date_from,
    date_to,
    search,
    page,
    limit,
  } = req.query;

  const data = await Invoice.list(req.user.company_id, {
    status,
    invoice_type,
    customer_id,
    supplier_id,
    reference_type,
    date_from,
    date_to,
    search,
    page,
    limit,
  });

  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/invoices/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const inv = await Invoice.findById(req.user.company_id, req.params.id);
  if (!inv) throw new ApiError(404, 'Invoice not found');
  res.json({ success: true, data: inv });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/invoices/from-order/:orderId
// ═══════════════════════════════════════════════════════════════════════════
const createFromOrder = asyncHandler(async (req, res) => {
  const inv = await service.createFromOrder(
    req.user.company_id,
    req.user.id,
    req.params.orderId,
    req.body
  );
  res.status(201).json({ success: true, data: inv });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/invoices/from-purchase-order/:orderId
// ═══════════════════════════════════════════════════════════════════════════
const createFromPurchaseOrder = asyncHandler(async (req, res) => {
  const inv = await service.createFromPurchaseOrder(
    req.user.company_id,
    req.user.id,
    req.params.orderId,
    req.body
  );
  res.status(201).json({ success: true, data: inv });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/invoices/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(
    req.user.company_id,
    req.user.id,        // ✅ FIX #1: userId ممرَّر
    req.params.id
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/invoices/:id/payments
// ═══════════════════════════════════════════════════════════════════════════
const getPayments = asyncHandler(async (req, res) => {
  const payments = await Invoice.getPayments(
    req.user.company_id,
    req.params.id
  );
  if (payments === null) {
    throw new ApiError(404, 'Invoice not found');
  }
  res.json({ success: true, data: payments });
});

module.exports = {
  list,
  getOne,
  createFromOrder,
  createFromPurchaseOrder,
  cancel,
  getPayments,
};