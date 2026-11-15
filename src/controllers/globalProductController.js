// controllers/globalProductController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const GlobalProduct = require('../models/GlobalProduct');

// ═══════════════════════════════════════════════════════════════════════════
// Search / Get
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/global-products/search
 */
const search = asyncHandler(async (req, res) => {
  const result = await GlobalProduct.search({
    search: req.query.search,
    product_type: req.query.product_type,
    status: req.query.status,
    is_verified:
      req.query.is_verified === undefined
        ? undefined
        : req.query.is_verified === 'true',
    is_otc:
      req.query.is_otc === undefined
        ? undefined
        : req.query.is_otc === 'true',
    requires_prescription:
      req.query.requires_prescription === undefined
        ? undefined
        : req.query.requires_prescription === 'true',
    atc_code: req.query.atc_code,
    manufacturer: req.query.manufacturer,
    category: req.query.category,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.json({ success: true, ...result });
});

/**
 * GET /api/global-products/:id
 */
const getOne = asyncHandler(async (req, res) => {
  const product = await GlobalProduct.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Global product not found');
  res.json({ success: true, data: product });
});

/**
 * GET /api/global-products/by-barcode/:barcode
 */
const getByBarcode = asyncHandler(async (req, res) => {
  const product = await GlobalProduct.findByBarcode(req.params.barcode);
  if (!product) throw new ApiError(404, 'No global product with this barcode');
  res.json({ success: true, data: product });
});

// ═══════════════════════════════════════════════════════════════════════════
// Create
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/global-products
 */
const create = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;
  const body = req.body || {};

  // تحقق من الحد الأدنى
  if (!body.name || !String(body.name).trim()) {
    throw new ApiError(400, 'name is required');
  }
  if (!body.unit || !String(body.unit).trim()) {
    throw new ApiError(400, 'unit is required');
  }
  if (!body.product_type) {
    throw new ApiError(400, 'product_type is required (drug/supplement/...)');
  }
  if (body.product_type === 'drug' && !body.dosage_form) {
    throw new ApiError(400, 'dosage_form is required when product_type = drug');
  }
  if (body.product_type === 'drug' && !body.active_ingredient) {
    throw new ApiError(400, 'active_ingredient is required when product_type = drug');
  }
  if (body.is_otc === true && body.requires_prescription === true) {
    throw new ApiError(400, 'is_otc and requires_prescription cannot both be true');
  }
  if (body.is_controlled === true && !body.controlled_schedule) {
    throw new ApiError(400, 'controlled_schedule is required when is_controlled = true');
  }

  // عرض المستخدم لـ status:
  //   - Super Admin يمكنه إنشاء 'active' مباشرة
  //   - المستخدم العادي → 'pending_review'
  let status = body.status;
  if (!status) {
    status = req.user.is_super_admin ? 'active' : 'pending_review';
  }
  if (!['active', 'pending_review'].includes(status)) {
    throw new ApiError(400, 'status must be "active" or "pending_review"');
  }

  const created = await GlobalProduct.create(companyId, {
    ...body,
    status,
    is_verified: status === 'active' ? true : false,
  });

  if (!created) {
    throw new ApiError(409, 'A global product with this barcode already exists');
  }

  res.status(201).json({ success: true, data: created });
});

// ═══════════════════════════════════════════════════════════════════════════
// Update
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/global-products/:id
 */
const update = asyncHandler(async (req, res) => {
  const product = await GlobalProduct.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Global product not found');

  // لا يسمح بتعديل منتج مؤرشف/مدموج
  if (product.status === 'archived' || product.status === 'merged') {
    throw new ApiError(400, `Cannot update a product with status '${product.status}'`);
  }

  const updated = await GlobalProduct.update(req.params.id, req.body);
  if (!updated) throw new ApiError(400, 'No fields to update');
  res.json({ success: true, data: updated });
});

// ═══════════════════════════════════════════════════════════════════════════
// Verify / Archive / Merge
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/global-products/:id/verify
 * يحوّل pending_review → active
 */
const verify = asyncHandler(async (req, res) => {
  const verified = await GlobalProduct.verify(req.params.id, req.user.id);
  if (!verified) {
    throw new ApiError(
      400,
      'Cannot verify: product not found, already verified, or not in pending_review'
    );
  }
  res.json({ success: true, data: verified });
});

/**
 * POST /api/global-products/:id/archive
 */
const archive = asyncHandler(async (req, res) => {
  const archived = await GlobalProduct.archive(
    req.params.id,
    req.body.reason || null
  );
  if (!archived) {
    throw new ApiError(400, 'Cannot archive: product not found or already archived');
  }
  res.json({ success: true, data: archived });
});

/**
 * POST /api/global-products/:id/merge
 * Body: { target_id }
 */
const merge = asyncHandler(async (req, res) => {
  const { target_id } = req.body;
  if (!target_id) throw new ApiError(400, 'target_id is required');
  if (target_id === req.params.id) {
    throw new ApiError(400, 'Cannot merge a product with itself');
  }

  const result = await GlobalProduct.merge(
    req.params.id,
    target_id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Products merged successfully',
    data: result,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Company contributions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/global-products/my-contributions
 */
const myContributions = asyncHandler(async (req, res) => {
  const result = await GlobalProduct.listByCompany(req.user.company_id, {
    page: req.query.page,
    limit: req.query.limit,
  });
  res.json({ success: true, ...result });
});

// ═══════════════════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/global-products/stats
 */
const stats = asyncHandler(async (req, res) => {
  const byStatus = await GlobalProduct.countByStatus();
  const total = byStatus.reduce((sum, r) => sum + r.count, 0);
  res.json({
    success: true,
    data: { total, by_status: byStatus },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Read
  search,
  getOne,
  getByBarcode,

  // Write
  create,
  update,

  // Admin
  verify,
  archive,
  merge,

  // Company
  myContributions,

  // Stats
  stats,
};