// controllers/ProductController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Product = require('../models/Product');
const ProductUnit = require('../models/ProductUnit');
const { pool } = require('../config/pool');
const {
  updateSellingPriceManually,
  recalculateSellingPrice,
} = require('../services/helpers/pricing');

// ═══════════════════════════════════════════════════════════════════════════
// List / Get
// ═══════════════════════════════════════════════════════════════════════════

const list = asyncHandler(async (req, res) => {
  // نمرّر الفلاتر الجديدة يدوياً لتفادي تمرير قيم غير متوقعة
  const {
    search,
    is_active,
    product_type,
    has_global_link,
    page,
    limit,
  } = req.query;

  const data = await Product.list(req.user.company_id, {
    search,
    is_active:
      is_active === undefined ? undefined : is_active === 'true',
    product_type,
    has_global_link:
      has_global_link === undefined ? undefined : has_global_link === 'true',
    page,
    limit,
  });

  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  try{
    const product = await Product.findById(req.user.company_id, req.params.id);
    if (!product) throw new ApiError(404, 'Product not found');
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Stock
// ═══════════════════════════════════════════════════════════════════════════

/**
 * /products/stock → مخزون كل المنتجات
 */
const getAllStock = asyncHandler(async (req, res) => {
  const data = await Product.getAllStock(req.user.company_id);
  res.json({ success: true, data });
});

/**
 * /products/:id/stock → مخزون منتج واحد
 */
const getProductStock = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.user.company_id, req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');
  const stock = await Product.getStock(req.user.company_id, req.params.id);
  res.json({ success: true, data: { product, ...stock } });
});

const getBatches = asyncHandler(async (req, res) => {
  const data = await Product.getBatches(req.user.company_id, req.params.id);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Create / Update / Delete
// ═══════════════════════════════════════════════════════════════════════════

const create = asyncHandler(async (req, res) => {
  // SKU check (يبقى كما هو — قبل الـ transaction)
  if (req.body.sku && (await Product.existsBySku(req.user.company_id, req.body.sku))) {
    throw new ApiError(409, 'SKU already exists');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const product = await Product.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');

    // رسالة إضافية إذا تمت المساهمة في الكتالوج
    const meta = {};
    if (product.catalog_contributed) {
      meta.message = 'تم اقتراح المنتج للكتالوج العالمي — بانتظار المراجعة';
      meta.catalog_status = 'pending_review';
    }

    res.status(201).json({ success: true, data: product, ...meta });
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
    if (
      existing.sku !== req.body.sku &&
      (await Product.existsBySku(req.user.company_id, req.body.sku))
    ) {
      throw new ApiError(409, 'SKU already exists');
    }
  }
  const updated = await Product.update(req.user.company_id, req.params.id, req.body);
  if (!updated) throw new ApiError(404, 'Product not found');
  res.json({ success: true, data: updated });
});

const remove = asyncHandler(async (req, res) => {
  const ok = await Product.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Product not found');
  res.json({ success: true, message: 'Product deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Global Catalog Integration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /products/:id/link-global
 * Body: { global_product_id }
 * يربط منتجاً موجوداً بمنتج عالمي (بدون نسخ بيانات)
 */
const linkToGlobal = asyncHandler(async (req, res) => {
  const { global_product_id } = req.body;
  if (!global_product_id) {
    throw new ApiError(400, 'global_product_id is required');
  }

  const updated = await Product.linkToGlobal(
    req.user.company_id,
    req.params.id,
    global_product_id
  );

  res.json({
    success: true,
    message: 'Product linked to global catalog',
    data: updated,
  });
});

/**
 * POST /products/:id/copy-from-global
 * Body: { overwrite?: boolean }
 * ينسخ الحقول التعريفية من الكتالوج إلى المنتج المحلي
 *   overwrite=false (افتراضي): يملأ الفراغ فقط
 *   overwrite=true: يطغى على القيم الحالية
 */
const copyFromGlobal = asyncHandler(async (req, res) => {
  const overwrite = req.body.overwrite === true;

  const updated = await Product.copyFromGlobal(
    req.user.company_id,
    req.params.id,
    { overwrite }
  );

  res.json({
    success: true,
    message: overwrite
      ? 'Product fields overwritten from global catalog'
      : 'Empty product fields filled from global catalog',
    data: updated,
  });
});

/**
 * DELETE /products/:id/link-global
 * يفك الربط بين المنتج والكتالوج (بدون حذف البيانات)
 */
const unlinkFromGlobal = asyncHandler(async (req, res) => {
  const updated = await Product.update(
    req.user.company_id,
    req.params.id,
    { global_product_id: null }
  );
  if (!updated) throw new ApiError(404, 'Product not found');

  res.json({
    success: true,
    message: 'Product unlinked from global catalog',
    data: updated,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Product Units
// ═══════════════════════════════════════════════════════════════════════════

const listUnits = asyncHandler(async (req, res) => {
  const data = await ProductUnit.listByProduct(req.user.company_id, req.params.id);
  res.json({ success: true, data });
});

const createUnit = asyncHandler(async (req, res) => {
  const data = await ProductUnit.create(req.user.company_id, req.params.id, req.body);
  res.status(201).json({ success: true, data });
});

const updateUnit = asyncHandler(async (req, res) => {
  const data = await ProductUnit.update(
    req.user.company_id,
    req.params.id,
    req.params.unitId,
    req.body
  );
  if (!data) throw new ApiError(404, 'Product unit not found');
  res.json({ success: true, data });
});

const deleteUnit = asyncHandler(async (req, res) => {
  await ProductUnit.delete(req.user.company_id, req.params.id, req.params.unitId);
  res.json({ success: true, message: 'Product unit deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Pricing
// ═══════════════════════════════════════════════════════════════════════════

const updateSellingPrice = asyncHandler(async (req, res) => {
  const { selling_price } = req.body;

  if (!Number.isFinite(Number(selling_price)) || Number(selling_price) < 0) {
    throw new ApiError(400, 'selling_price must be >= 0');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await updateSellingPriceManually(client, {
      companyId: req.user.company_id,
      productId: req.params.id,
      newSellingPrice: Number(selling_price),
      userId: req.user.id,
    });
    await client.query('COMMIT');
    res.json({ success: true, data: result });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const recalculateSellingPriceEndpoint = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.user.company_id, req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await recalculateSellingPrice(client, {
      companyId: req.user.company_id,
      productId: req.params.id,
      newCostPrice: Number(product.cost_price),
      changeSource: 'bulk_update',
      userId: req.user.id,
    });
    await client.query('COMMIT');
    res.json({ success: true, data: result });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const recalculateAllPrices = asyncHandler(async (req, res) => {
  const result = await Product.recalculateAllSellingPrices(
    req.user.company_id,
    req.user.id
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Products
  list,
  getOne,
  create,
  update,
  remove,

  // Stock
  getAllStock,
  getProductStock,
  getBatches,

  // Global catalog
  linkToGlobal,
  copyFromGlobal,
  unlinkFromGlobal,

  // Units
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,

  // Pricing
  updateSellingPrice,
  recalculateSellingPriceEndpoint,
  recalculateAllPrices,
};