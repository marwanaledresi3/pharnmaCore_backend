const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const service = require('../services/deliveryNoteService');
const { pool } = require('../config/pool');
const StockAdjustment = require('../models/stockAdjustment');

const list = asyncHandler(async (req, res) => {
  const data = await service.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const dn = await service.getById(client, req.user.company_id, req.params.id);
    if (!dn) throw new ApiError(404, 'Delivery note not found');
    res.json({ success: true, data: dn });
  } finally {
    client.release();
  }
});

const create = asyncHandler(async (req, res) => {
  const dn = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: dn });
});

const dispatch = asyncHandler(async (req, res) => {
  const dn = await service.dispatch(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: dn });
});

const markDelivered = asyncHandler(async (req, res) => {
  const dn = await service.markDelivered(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body
  );
  res.json({ success: true, data: dn });
});

const convertToInvoice = asyncHandler(async (req, res) => {
  const result = await service.convertToInvoice(
    req.user.company_id,
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: result });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(
    req.user.company_id,
    req.user.id,
    req.params.id,
    req.body.reason
  );
  res.json({ success: true, data: result });
});

/**
 * GET /delivery-notes/warehouse-products/:warehouseId
 * جلب المنتجات المتاحة في مستودع (لاختيار البنود)
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

  res.json({ success: true, data: { items } });
});

module.exports = { list, getOne, create, dispatch, markDelivered, convertToInvoice, cancel , getWarehouseProducts};