// controllers/PaymentController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Payment = require('../models/Payment');
const service = require('../services/paymentService');

// ═══════════════════════════════════════════════════════════════════════════
// GET /payments
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  const data = await Payment.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /payments
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  const body = {
    ...req.body,
    user_branch_id: req.user.branch_id || null,
  };

  // ─── 1) سند يدوي (بدون فاتورة) ─────────────────────────────────────
  if (!body.invoice_id) {
    if (!body.description || !String(body.description).trim()) {
      throw new ApiError(400, 'البيان مطلوب');
    }
    if (!body.payment_type) {
      throw new ApiError(400, 'payment_type is required for manual payments');
    }
    if (body.payment_type === 'receive' && !body.customer_id) {
      throw new ApiError(400, 'customer_id is required');
    }
    if (body.payment_type === 'pay' && !body.supplier_id) {
      throw new ApiError(400, 'supplier_id is required');
    }

    const result = await service.createManualPayment(
      req.user.company_id,
      req.user.id,
      body
    );
    return res.status(201).json({ success: true, data: result });
  }

  // ─── 2) فاتورة شراء (pay) ──────────────────────────────────────────
  if (body.payment_type === 'pay') {
    const result = await service.createForPurchaseInvoice(
      req.user.company_id,
      req.user.id,
      body
    );
    return res.status(201).json({ success: true, data: result });
  }

  // ─── 3) فاتورة بيع (receive) — default ─────────────────────────────
  const result = await service.createForInvoice(
    req.user.company_id,
    req.user.id,
    body
  );
  res.status(201).json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /payments/:id
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(
    req.user.company_id,
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /payments/refund
// ═══════════════════════════════════════════════════════════════════════════
const refundToCustomer = asyncHandler(async (req, res) => {
  const result = await service.refundToCustomer(
    req.user.company_id,
    req.user.id,
    {
      ...req.body,
      user_branch_id: req.user.branch_id || null,
    }
  );
  res.status(201).json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /payments/apply-credit
// ═══════════════════════════════════════════════════════════════════════════
const applyCredit = asyncHandler(async (req, res) => {
  const result = await service.applyCreditToInvoice(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: result });
});

module.exports = {
  list,
  create,
  remove,
  refundToCustomer,
  applyCredit,
};