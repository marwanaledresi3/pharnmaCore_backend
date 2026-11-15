// routes/returnRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/ReturnController');
const {
  authenticate,
  requireCompany,
  requireInternal,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany, requireInternal);

// ═══════════════════════════════════════════════════════════════════════════
// الثوابت
// ═══════════════════════════════════════════════════════════════════════════

const RETURN_TYPES = ['sales', 'purchase'];
const STATUSES = ['draft', 'confirmed', 'cancelled'];

// ═══════════════════════════════════════════════════════════════════════════
// قواعد التحقق للبنود
// ═══════════════════════════════════════════════════════════════════════════

const itemsValidator = [
  body('items').isArray({ min: 1 }),

  body('items.*.product_id').isUUID(),

  body('items.*.quantity')
    .isFloat({ gt: 0 })
    .withMessage('quantity must be > 0'),

  body('items.*.unit_id').optional({ nullable: true }).isUUID(),

  body('items.*.conversion_factor')
    .optional()
    .isFloat({ gt: 0 })
    .withMessage('conversion_factor must be > 0'),

  body('items.*.conversion_factor').custom((value, { req, path }) => {
    if (value === undefined) return true;
    const factor = Number(value);
    if (factor > 1) {
      const m = path.match(/items\[(\d+)\]/);
      const idx = m ? Number(m[1]) : null;
      const item = idx != null ? req.body.items?.[idx] : null;
      if (!item?.unit_id) {
        throw new Error(
          `items[${idx}]: unit_id is required when conversion_factor > 1`
        );
      }
    }
    return true;
  }),

  body('items.*.unit_price').optional().isFloat({ min: 0 }),
  body('items.*.discount_rate').optional().isFloat({ min: 0, max: 100 }),
  body('items.*.discount_amount').optional().isFloat({ min: 0 }),
  body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('items.*.batch_id').optional({ nullable: true }).isUUID(),
];

const listRules = [
  query('return_type').optional().isIn(RETURN_TYPES),
  query('status').optional().isIn(STATUSES),
  query('invoice_id').optional().isUUID(),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /returns — قائمة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /returns:
 *   get:
 *     summary: قائمة المرتجعات
 *     tags: [Returns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: return_type
 *         schema:
 *           type: string
 *           enum: [sales, purchase]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, confirmed, cancelled]
 *       - in: query
 *         name: invoice_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المرتجعات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           return_number: { type: string }
 *                           return_type: { type: string, enum: [sales, purchase] }
 *                           return_date: { type: string, format: date }
 *                           total: { type: number }
 *                           status: { type: string }
 *                           party_name: { type: string, nullable: true }
 *                           invoice_number: { type: string, nullable: true }
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('invoices.view'),
  listRules,
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /returns/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /returns/{id}:
 *   get:
 *     summary: تفاصيل مرتجع
 *     tags: [Returns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل المرتجع
 *       404:
 *         description: المرتجع غير موجود
 */
router.get(
  '/:id',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /returns/sales — إنشاء مرتجع بيع
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /returns/sales:
 *   post:
 *     summary: إنشاء مرتجع بيع (مسودة)
 *     description: |
 *       **التحقق:**
 *       - الفاتورة موجودة + `invoice_type = 'sales'`.
 *       - الكمية ≤ الأصلية + المرتجعات السابقة.
 *       - الوحدة `conversion_factor`.
 *     tags: [Returns]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoice_id, items]
 *             properties:
 *               invoice_id:
 *                 type: string
 *                 format: uuid
 *               return_date:
 *                 type: string
 *                 format: date
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id, quantity]
 *                   properties:
 *                     product_id:
 *                       type: string
 *                       format: uuid
 *                     quantity:
 *                       type: number
 *                       exclusiveMinimum: 0
 *                     unit_id:
 *                       type: string
 *                       format: uuid
 *                     conversion_factor:
 *                       type: number
 *                       exclusiveMinimum: 0
 *                     unit_price:
 *                       type: number
 *                       minimum: 0
 *                     tax_rate:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *                     batch_id:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       201:
 *         description: تم إنشاء المرتجع
 *       400:
 *         description: |
 *           - الكمية تتجاوز الأصلية
 *           - الفاتورة ليست بيع
 */
router.post(
  '/sales',
  authorize('invoices.create'),
  [
    body('invoice_id').isUUID(),
    body('return_date').optional().isISO8601(),
    body('reason').optional().isString().trim().isLength({ max: 1000 }),
    ...itemsValidator,
  ],
  validate,
  ctrl.createSale
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /returns/purchase — إنشاء مرتجع شراء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /returns/purchase:
 *   post:
 *     summary: إنشاء مرتجع شراء (مسودة)
 *     description: |
 *       **التحقق:**
 *       - الفاتورة `invoice_type = 'purchase'`.
 *       - `batch_id` مطلوب لكل بند.
 *     tags: [Returns]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoice_id, items]
 *             properties:
 *               invoice_id:
 *                 type: string
 *                 format: uuid
 *               return_date:
 *                 type: string
 *                 format: date
 *               reason:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id, quantity, batch_id]
 *                   properties:
 *                     product_id:
 *                       type: string
 *                       format: uuid
 *                     quantity:
 *                       type: number
 *                       exclusiveMinimum: 0
 *                     batch_id:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       201:
 *         description: تم إنشاء المرتجع
 *       400:
 *         description: |
 *           - الكمية تتجاوز الأصلية
 *           - الفاتورة ليست شراء
 *           - دفعة مفقودة
 */
router.post(
  '/purchase',
  authorize('invoices.create'),
  [
    body('invoice_id').isUUID(),
    body('return_date').optional().isISO8601(),
    body('reason').optional().isString().trim().isLength({ max: 1000 }),
    ...itemsValidator,
  ],
  validate,
  ctrl.createPurchase
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /returns/:id/confirm — تأكيد
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /returns/{id}/confirm:
 *   post:
 *     summary: تأكيد المرتجع
 *     description: |
 *       **ماذا يحدث:**
 *       1. تعديل المخزون (إضافة لمرتجع البيع / خصم لمرتجع الشراء).
 *       2. تسجيل `stock_movements`.
 *       3. إنشاء قيد محاسبي.
 *       4. تحديث الحالة إلى `confirmed`.
 *
 *       **Rollback مضمون** عند أي فشل.
 *     tags: [Returns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم التأكيد
 *       400:
 *         description: |
 *           - المرتجع ليس draft
 *           - كمية غير كافية
 *       500:
 *         description: |
 *           - حساب محاسبي مفقود
 *           - قيد غير متوازن
 */
router.post(
  '/:id/confirm',
  authorize('invoices.update'),
  [param('id').isUUID()],
  validate,
  ctrl.confirm
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /returns/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /returns/{id}/cancel:
 *   post:
 *     summary: إلغاء المرتجع
 *     description: |
 *       - draft → إلغاء بسيط
 *       - confirmed → عكس القيد + عكس حركات المخزون
 *     tags: [Returns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الإلغاء
 *       400:
 *         description: |
 *           - ملغى مسبقاً
 *           - كمية غير كافية للعكس
 */
router.post(
  '/:id/cancel',
  authorize('invoices.cancel'),
  [param('id').isUUID()],
  validate,
  ctrl.cancel
);

module.exports = router;