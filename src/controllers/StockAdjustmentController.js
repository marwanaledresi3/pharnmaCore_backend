const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const StockAdjustmentService = require('../services/stockAdjustmentService');
const StockAdjustment = require('../models/stockAdjustment');
const list = asyncHandler(async (req, res) => {
  const data = await StockAdjustmentService.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const { pool } = require('../config/pool');
  const client = await pool.connect();
  try {
    const adj = await StockAdjustmentService.getById(client, req.user.company_id, req.params.id);
    if (!adj) throw new ApiError(404, 'Adjustment not found');
    res.json({ success: true, data: adj });
  } finally {
    client.release();
  }
});

const create = asyncHandler(async (req, res) => {
  const adj = await StockAdjustmentService.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: adj });
});

const confirm = asyncHandler(async (req, res) => {
  const adj = await StockAdjustmentService.confirm(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: adj });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await StockAdjustmentService.cancel(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body.reason
  );
  res.json({ success: true, data: result });
});


/**
 * GET /stock-adjustments/warehouse-products/:warehouseId
 * جلب المنتجات المتاحة في مستودع (للجرد)
 */
const getWarehouseProducts = asyncHandler(async (req, res) => {
  const { warehouseId } = req.params;
  const { search } = req.query;
  const companyId = req.user.company_id;

  const items = await StockAdjustment.getWarehouseProducts(
    companyId,
    warehouseId,
    search
  );

  res.json({
    success: true,
    data: { items },
  });
});

module.exports = { list, getOne, create, confirm, cancel, getWarehouseProducts };