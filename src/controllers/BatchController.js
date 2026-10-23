const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Batch = require('../models/Batch');
const Product = require('../models/Product');
const Warehouse = require('../models/Warehouse');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Batch.list(req.user.company_id, req.query) });
});

const create = asyncHandler(async (req, res) => {
  const { product_id, warehouse_id } = req.body;

  const [product, warehouse] = await Promise.all([
    Product.findById(req.user.company_id, product_id),
    Warehouse.findById(req.user.company_id, warehouse_id),
  ]);
  if (!product) throw new ApiError(400, 'Product not found');
  if (!warehouse) throw new ApiError(400, 'Warehouse not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batch = await Batch.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: batch });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = { list, create };