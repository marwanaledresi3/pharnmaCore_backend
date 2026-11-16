// controllers/CashRegisterController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const CashRegister = require('../models/CashRegister');
const cashRegisterService = require('../services/cashRegisterService');

const getCashRegisters = asyncHandler(async (req, res) => {
  const rows = await CashRegister.list(req.user.company_id, req.query);
  res.json({ success: true, data: rows });
});

const getCashRegisterById = asyncHandler(async (req, res) => {
  const register = await CashRegister.findById(null, req.user.company_id, req.params.id);
  if (!register) throw new ApiError(404, 'الصندوق غير موجود');
  res.json({ success: true, data: register });
});

const createCashRegister = asyncHandler(async (req, res) => {
  const created = await cashRegisterService.createRegister(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: created });
});

const updateCashRegister = asyncHandler(async (req, res) => {
  const updated = await cashRegisterService.updateRegister(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body
  );
  res.json({ success: true, data: updated });
});

const getCashTransfers = asyncHandler(async (req, res) => {
  const data = await CashRegister.listTransfers(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const createCashTransfer = asyncHandler(async (req, res) => {
  const transfer = await cashRegisterService.createTransfer(
    req.user.company_id,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, data: transfer });
});

const cancelCashTransfer = asyncHandler(async (req, res) => {
  const result = await cashRegisterService.cancelTransfer(
    req.user.company_id,
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: result });
});

// كشف حساب الصندوق
const getRegisterStatement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { date_from, date_to } = req.query;

  if (date_from && date_to && String(date_from) > String(date_to)) {
    throw new ApiError(
      400,
      'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية'
    );
  }

  const statement = await cashRegisterService.getRegisterStatement(
    req.user.company_id,
    id,
    { date_from, date_to }
  );

  res.json({ success: true, data: statement });
});

module.exports = {
  getCashRegisters,
  getCashRegisterById,
  createCashRegister,
  updateCashRegister,
  getCashTransfers,
  createCashTransfer,
  cancelCashTransfer,
  getRegisterStatement,
};