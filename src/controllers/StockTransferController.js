const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const StockTransferService = require('../services/stockTransferService');
const StockTransfer = require('../models/stockTransfer');
const list = asyncHandler(async (req, res) => {
  try {
    const data = await StockTransfer.list(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Error fetching stock transfers:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Internal server error while fetching stock transfers' 
    });
  }
});

const getOne = asyncHandler(async (req, res) => {
  const { pool } = require('../config/pool');
  const client = await pool.connect();
  try {
    const transfer = await StockTransferService.getById(client, req.user.company_id, req.params.id);
    if (!transfer) throw new ApiError(404, 'Transfer not found');
    res.json({ success: true, data: transfer });
  } finally {
    client.release();
  }
});

const create = asyncHandler(async (req, res) => {
  const transfer = await StockTransferService.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: transfer });
});

const confirm = asyncHandler(async (req, res) => {
  const transfer = await StockTransferService.confirm(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: transfer });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await StockTransferService.cancel(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body.reason
  );
  res.json({ success: true, data: result });
});

module.exports = { list, getOne, create, confirm, cancel };