const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/goodsReceiptService');
const { pool } = require('../config/pool');

/**
 * GET /goods-receipts
 */
const list = asyncHandler(async (req, res) => {
  const data = await service.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

/**
 * GET /goods-receipts/:id
 */
const getOne = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const gr = await service.getById(client, req.user.company_id, req.params.id);
    if (!gr) throw new ApiError(404, 'Goods receipt not found');
    res.json({ success: true, data: gr });
  } finally {
    client.release();
  }
});

/**
 * POST /goods-receipts
 */
const create = asyncHandler(async (req, res) => {
  const gr = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: gr });
});

/**
 * POST /goods-receipts/:id/confirm
 */
const confirm = asyncHandler(async (req, res) => {
  const gr = await service.confirm(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: gr });
});

/**
 * POST /goods-receipts/:id/cancel
 */
const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body.reason
  );
  res.json({ success: true, data: result });
});

module.exports = { list, getOne, create, confirm, cancel };