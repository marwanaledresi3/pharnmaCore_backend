const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Product = require('../models/Product');
const {pool} = require('../config/pool');

const list = asyncHandler(async (req, res) => {
  const data = await Product.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.user.company_id, req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');
  res.json({ success: true, data: product });
});

// جلب مخزون جميع المنتجات أو منتج واحد
const getStock = asyncHandler(async (req, res) => {
  const targetCompanyId = req.params.id;   // ← الشركة المستهدفة (المورد)
  const productId = req.query.productId;

  // ⚠️ تحقق: هل المستخدم مرتبط بهذه الشركة؟
  if (targetCompanyId !== req.user.company_id) {
    const connected = await pool.query(
      `SELECT 1 FROM suppliers
       WHERE company_id = $1 AND source_company_id = $2
       UNION
       SELECT 1 FROM customers
       WHERE company_id = $1 AND source_company_id = $2`,
      [req.user.company_id, targetCompanyId]
    );
    if (!connected.rowCount) {
      throw new ApiError(403, 'Not connected to this company');
    }
  }

  if (productId) {
    const product = await Product.findById(targetCompanyId, productId);
    if (!product) throw new ApiError(404, 'Product not found');

    const stock = await Product.getStock(targetCompanyId, product.id);
    return res.json({
      success: true,
      data: { product, ...stock },
    });
  }

  const stock = await Product.getAllStock(targetCompanyId);
  return res.json({ success: true, data: stock });
});


const getBatches = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Product.getBatches(req.user.company_id, req.params.id) });
});

const create = asyncHandler(async (req, res) => {
  if (await Product.existsBySku(req.user.company_id, req.body.sku)) {
    throw new ApiError(409, 'SKU already exists');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const product = await Product.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const update = asyncHandler(async (req, res) => {
  if (req.body.sku) {
    const existing = await Product.findById(req.user.company_id, req.params.id);
    if (!existing) throw new ApiError(404, 'Product not found');
    if (existing.sku !== req.body.sku && await Product.existsBySku(req.user.company_id, req.body.sku)) {
      throw new ApiError(409, 'SKU already exists');
    }
  }
  const updated = await Product.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Product not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  // منع الحذف إذا كان هناك batches
  const check = await pool.query(
    `SELECT 1 FROM product_batches WHERE product_id = $1 AND quantity > 0 LIMIT 1`,
    [req.params.id]
  );
  if (check.rowCount) throw new ApiError(400, 'Cannot delete product with stock');

  const ok = await Product.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Product not found');
  res.json({ success: true, message: 'Product deleted' });
});

module.exports = { list, getOne, getStock, create, update, remove,getBatches };