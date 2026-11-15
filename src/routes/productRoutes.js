// routes/productRoutes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl = require('../controllers/ProductController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// الثوابت
// ═══════════════════════════════════════════════════════════════════════════

const PRODUCT_TYPES = [
  'drug', 'supplement', 'cosmetic', 'food', 'device', 'herbal', 'veterinary', 'other',
];
const PRICING_POLICIES = ['fixed', 'auto_markup'];

// ═══════════════════════════════════════════════════════════════════════════
// قواعد التحقق
// ═══════════════════════════════════════════════════════════════════════════

const createRules = [
  body('name').isString().trim().notEmpty().isLength({ max: 200 }),
  body('unit').isString().trim().notEmpty().isLength({ max: 30 }),
  body('sku').optional().isString().trim().isLength({ max: 50 }),
  body('barcode').optional().isString().trim().isLength({ max: 100 }),
  body('category').optional().isString().trim().isLength({ max: 100 }),
  body('cost_price').optional().isFloat({ min: 0 }),
  body('selling_price').optional().isFloat({ min: 0 }),
  body('profit_margin').optional().isFloat({ min: 0 }),
  body('markup_percentage').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
  body('pricing_policy').optional().isIn(PRICING_POLICIES),
  body('tax_rate_id').optional({ nullable: true }).isUUID(),
  body('revenue_account_id').optional({ nullable: true }).isUUID(),
  body('inventory_account_id').optional({ nullable: true }).isUUID(),
  body('cogs_account_id').optional({ nullable: true }).isUUID(),
  body('min_stock_level').optional().isFloat({ min: 0 }),
  body('base_unit_id').optional({ nullable: true }).isUUID(),
  body('units').optional().isArray(),
  body('units.*.unit_id').isUUID(),
  body('units.*.conversion_factor').isFloat({ gt: 0 }),
  body('units.*.sale_price').optional({ nullable: true }).isFloat({ min: 0 }),
  body('units.*.purchase_price').optional({ nullable: true }).isFloat({ min: 0 }),
  body('units.*.barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('units.*.is_base_unit').optional().isBoolean(),
  body('global_product_id').optional({ nullable: true }).isUUID(),
  body('skip_catalog_contribution').optional().isBoolean(),
  body('scientific_name').optional().isString().trim().isLength({ max: 200 }),
  body('description').optional().isString(),
  body('name_en').optional().isString().trim().isLength({ max: 200 }),
  body('name_ar').optional().isString().trim().isLength({ max: 200 }),
  body('product_type').optional().isIn(PRODUCT_TYPES),
  body('therapeutic_class').optional().isString().trim().isLength({ max: 200 }),
  body('atc_code').optional().isString().trim().isLength({ max: 20 }),
  body('manufacturer').optional().isString().trim().isLength({ max: 200 }),
  body('manufacturer_country').optional().isString().trim().isLength({ max: 100 }),
  body('marketing_company').optional().isString().trim().isLength({ max: 200 }),
  body('active_ingredient').optional().isString().trim().isLength({ max: 500 }),
  body('dosage_form').optional().isString().trim().isLength({ max: 100 }),
  body('strength').optional().isString().trim().isLength({ max: 50 }),
  body('package_size').optional().isString().trim().isLength({ max: 100 }),
  body('storage_conditions').optional().isString(),
  body('shelf_life_months').optional().isInt({ min: 1 }),
  body('requires_prescription').optional().isBoolean(),
  body('is_controlled').optional().isBoolean(),
  body('is_otc').optional().isBoolean(),
  body('image_url').optional().isString(),
];

const updateRules = [
  param('id').isUUID(),
  body('sku').optional().isString().trim().isLength({ max: 50 }),
  body('barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('name').optional().isString().trim().isLength({ max: 200 }),
  body('unit').optional().isString().trim().isLength({ max: 30 }),
  body('category').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('cost_price').optional().isFloat({ min: 0 }),
  body('selling_price').optional().isFloat({ min: 0 }),
  body('profit_margin').optional().isFloat({ min: 0 }),
  body('markup_percentage').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
  body('pricing_policy').optional().isIn(PRICING_POLICIES),
  body('tax_rate_id').optional({ nullable: true }).isUUID(),
  body('revenue_account_id').optional({ nullable: true }).isUUID(),
  body('inventory_account_id').optional({ nullable: true }).isUUID(),
  body('cogs_account_id').optional({ nullable: true }).isUUID(),
  body('min_stock_level').optional().isFloat({ min: 0 }),
  body('base_unit_id').optional({ nullable: true }).isUUID(),
  body('is_active').optional().isBoolean(),
  body('global_product_id').optional({ nullable: true }).isUUID(),
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /products — قائمة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products:
 *   get:
 *     summary: قائمة المنتجات
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: is_active
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: product_type
 *         schema:
 *           type: string
 *           enum: [drug, supplement, cosmetic, food, device, herbal, veterinary, other]
 *       - in: query
 *         name: has_global_link
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المنتجات
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('products.view'),
  [
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('is_active').optional().isIn(['true', 'false']),
    query('product_type').optional().isIn(PRODUCT_TYPES),
    query('has_global_link').optional().isIn(['true', 'false']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /products/stock — مخزون كل المنتجات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/stock:
 *   get:
 *     summary: مخزون كل المنتجات
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: مخزون كل المنتجات
 */
router.get(
  '/stock',
  authorize('products.view'),
  ctrl.getAllStock
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /products — إنشاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products:
 *   post:
 *     summary: إنشاء منتج جديد
 *     description: |
 *       **الوحدات:**
 *       - `base_unit_id`: الوحدة الأساسية.
 *       - `units[]`: الوحدات الفرعية مع `conversion_factor`.
 *
 *       **الكتالوج العالمي:**
 *       - `global_product_id`: ربط بمنتج عالمي.
 *       - `skip_catalog_contribution`: عدم إضافة منتج جديد للكتالوج.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, unit]
 *             properties:
 *               name:
 *                 type: string
 *               name_en:
 *                 type: string
 *               unit:
 *                 type: string
 *               sku:
 *                 type: string
 *               barcode:
 *                 type: string
 *               cost_price:
 *                 type: number
 *               selling_price:
 *                 type: number
 *               markup_percentage:
 *                 type: number
 *               pricing_policy:
 *                 type: string
 *                 enum: [fixed, auto_markup]
 *               global_product_id:
 *                 type: string
 *                 format: uuid
 *               base_unit_id:
 *                 type: string
 *                 format: uuid
 *               units:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [unit_id, conversion_factor]
 *                   properties:
 *                     unit_id:
 *                       type: string
 *                       format: uuid
 *                     conversion_factor:
 *                       type: number
 *                     sale_price:
 *                       type: number
 *                     purchase_price:
 *                       type: number
 *                     is_base_unit:
 *                       type: boolean
 *     responses:
 *       201:
 *         description: تم إنشاء المنتج
 *       400:
 *         description: بيانات غير صالحة
 *       409:
 *         description: SKU موجود مسبقاً
 */
router.post(
  '/',
  authorize('products.create'),
  createRules,
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /products/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}:
 *   get:
 *     summary: تفاصيل منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل المنتج
 *       404:
 *         description: المنتج غير موجود
 */
router.get(
  '/:id',
  authorize('products.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// PUT /products/:id — تعديل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}:
 *   put:
 *     summary: تعديل منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               unit: { type: string }
 *               cost_price: { type: number }
 *               selling_price: { type: number }
 *               markup_percentage: { type: number }
 *               pricing_policy: { type: string, enum: [fixed, auto_markup] }
 *               is_active: { type: boolean }
 *     responses:
 *       200:
 *         description: تم التعديل
 *       404:
 *         description: المنتج غير موجود
 */
router.put(
  '/:id',
  authorize('products.update'),
  updateRules,
  validate,
  ctrl.update
);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /products/:id — حذف
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}:
 *   delete:
 *     summary: حذف منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الحذف
 *       400:
 *         description: المنتج مستخدم (له حركات/فواتير)
 *       404:
 *         description: المنتج غير موجود
 */
router.delete(
  '/:id',
  authorize('products.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.remove
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /products/:id/stock — مخزون منتج
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}/stock:
 *   get:
 *     summary: مخزون منتج (حسب المستودع)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: مخزون المنتج
 */
router.get(
  '/:id/stock',
  authorize('products.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getProductStock
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /products/:id/batches — دفعات منتج
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}/batches:
 *   get:
 *     summary: دفعات منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: قائمة الدفعات
 */
router.get(
  '/:id/batches',
  authorize('products.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getBatches
);

// ═══════════════════════════════════════════════════════════════════════════
// Global Catalog Integration
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}/link-global:
 *   post:
 *     summary: ربط منتج بمنتج عالمي
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [global_product_id]
 *             properties:
 *               global_product_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: تم الربط
 */
router.post(
  '/:id/link-global',
  authorize('products.update'),
  [
    param('id').isUUID(),
    body('global_product_id').isUUID(),
  ],
  validate,
  ctrl.linkToGlobal
);

/**
 * @swagger
 * /products/{id}/copy-from-global:
 *   post:
 *     summary: نسخ بيانات من المنتج العالمي
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               overwrite:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: تم النسخ
 */
router.post(
  '/:id/copy-from-global',
  authorize('products.update'),
  [
    param('id').isUUID(),
    body('overwrite').optional().isBoolean(),
  ],
  validate,
  ctrl.copyFromGlobal
);

/**
 * @swagger
 * /products/{id}/link-global:
 *   delete:
 *     summary: إلغاء ربط منتج بمنتج عالمي
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم إلغاء الربط
 */
router.delete(
  '/:id/link-global',
  authorize('products.update'),
  [param('id').isUUID()],
  validate,
  ctrl.unlinkFromGlobal
);

// ═══════════════════════════════════════════════════════════════════════════
// Product Units
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}/units:
 *   get:
 *     summary: وحدات منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: قائمة الوحدات
 */
router.get(
  '/:id/units',
  authorize('products.view'),
  [param('id').isUUID()],
  validate,
  ctrl.listUnits
);

/**
 * @swagger
 * /products/{id}/units:
 *   post:
 *     summary: إضافة وحدة لمنتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [unit_id, conversion_factor]
 *             properties:
 *               unit_id:
 *                 type: string
 *                 format: uuid
 *               conversion_factor:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               is_base_unit:
 *                 type: boolean
 *               sale_price:
 *                 type: number
 *               purchase_price:
 *                 type: number
 *               barcode:
 *                 type: string
 *     responses:
 *       201:
 *         description: تمت الإضافة
 */
router.post(
  '/:id/units',
  authorize('products.update'),
  [
    param('id').isUUID(),
    body('unit_id').isUUID(),
    body('conversion_factor').isFloat({ gt: 0 }),
    body('is_base_unit').optional().isBoolean(),
    body('sale_price').optional({ nullable: true }).isFloat({ min: 0 }),
    body('purchase_price').optional({ nullable: true }).isFloat({ min: 0 }),
    body('barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  ],
  validate,
  ctrl.createUnit
);

/**
 * @swagger
 * /products/{id}/units/{unitId}:
 *   put:
 *     summary: تعديل وحدة منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: unitId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversion_factor:
 *                 type: number
 *               sale_price:
 *                 type: number
 *               purchase_price:
 *                 type: number
 *               barcode:
 *                 type: string
 *     responses:
 *       200:
 *         description: تم التعديل
 */
router.put(
  '/:id/units/:unitId',
  authorize('products.update'),
  [
    param('id').isUUID(),
    param('unitId').isUUID(),
    body('conversion_factor').optional().isFloat({ gt: 0 }),
    body('sale_price').optional({ nullable: true }).isFloat({ min: 0 }),
    body('purchase_price').optional({ nullable: true }).isFloat({ min: 0 }),
    body('barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  ],
  validate,
  ctrl.updateUnit
);

/**
 * @swagger
 * /products/{id}/units/{unitId}:
 *   delete:
 *     summary: حذف وحدة منتج
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: unitId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الحذف
 */
router.delete(
  '/:id/units/:unitId',
  authorize('products.update'),
  [
    param('id').isUUID(),
    param('unitId').isUUID(),
  ],
  validate,
  ctrl.deleteUnit
);

// ═══════════════════════════════════════════════════════════════════════════
// Pricing
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /products/{id}/selling-price:
 *   put:
 *     summary: تعديل سعر البيع يدوياً
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [selling_price]
 *             properties:
 *               selling_price:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: تم التعديل
 */
router.put(
  '/:id/selling-price',
  authorize('products.update'),
  [
    param('id').isUUID(),
    body('selling_price').isFloat({ min: 0 }),
  ],
  validate,
  ctrl.updateSellingPrice
);

/**
 * @swagger
 * /products/{id}/recalculate-price:
 *   post:
 *     summary: إعادة حساب سعر البيع تلقائياً
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم إعادة الحساب
 */
router.post(
  '/:id/recalculate-price',
  authorize('products.update'),
  [param('id').isUUID()],
  validate,
  ctrl.recalculateSellingPriceEndpoint
);

/**
 * @swagger
 * /products/recalculate-all-prices:
 *   post:
 *     summary: إعادة حساب أسعار البيع لكل المنتجات
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: تم إعادة الحساب
 */
router.post(
  '/recalculate-all-prices',
  authorize('products.update'),
  ctrl.recalculateAllPrices
);

module.exports = router;