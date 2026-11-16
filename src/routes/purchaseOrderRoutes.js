// routes/purchaseOrderRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/PurchaseOrderController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// الثوابت
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'confirmed',
  'cancelled',
];

const PAYMENT_TYPES = ['cash', 'credit', 'partial'];
const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'card', 'wallet', 'other'];
const QR_MODES = ['authenticated', 'public', 'both'];

// ═══════════════════════════════════════════════════════════════════════════
// قواعد التحقق المشتركة
// ═══════════════════════════════════════════════════════════════════════════

const createRules = [
  body('supplier_id').isUUID(),
  body('currency_id').isUUID(),
  body('cash_register_id').optional({ nullable: true }).isUUID(),
  body('order_date').optional().isISO8601(),
  body('exchange_rate').optional().isFloat({ gt: 0 }),
  body('payment_type').optional().isIn(PAYMENT_TYPES),
  body('payment_method').optional().isIn(PAYMENT_METHODS),
  body('payment_terms_days').optional().isInt({ min: 0, max: 365 }),
  body('paid_amount').optional().isFloat({ min: 0 }),
  body('supplier_invoice_number').optional().isString().trim().isLength({ max: 100 }),
  body('supplier_invoice_date').optional().isISO8601(),
  body('items').isArray({ min: 1 }),
  body('items.*.product_id').isUUID(),
  body('items.*.supplier_product_id').optional().isUUID(),
  body('items.*.unit_id').optional().isUUID(),
  body('items.*.conversion_factor').optional().isFloat({ gt: 0 }),
  body('items.*.paid_quantity').optional().isFloat({ gt: 0 }),
  body('items.*.bonus_quantity').optional().isFloat({ min: 0 }),
  body('items.*.quantity').optional().isFloat({ gt: 0 }),
  body('items.*.unit_price').optional().isFloat({ min: 0 }),
  body('items.*.margin_rate').optional().isFloat({ min: 0, max: 1000 }),
  body('items.*.computed_selling_price').optional().isFloat({ min: 0 }),
  body('items.*.override_selling_price').optional({ nullable: true }).isFloat({ min: 0 }),
  body('items.*.min_selling_price').optional().isFloat({ min: 0 }),
  body('items.*.discount_rate').optional().isFloat({ min: 0, max: 100 }),
  body('items.*.discount_amount').optional().isFloat({ min: 0 }),
  body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('items.*.batch_number').optional().isString().trim(),
  body('items.*.expiry_date').optional().isISO8601(),
  body('items.*.conversion_factor').custom((value, { req, path }) => {
    if (value === undefined) return true;
    const factor = Number(value);
    if (factor > 1) {
      const m = path.match(/items\[(\d+)\]/);
      const idx = m ? Number(m[1]) : null;
      const item = idx != null ? req.body.items?.[idx] : null;
      if (!item?.unit_id) {
        throw new Error('unit_id is required when conversion_factor > 1');
      }
    }
    return true;
  }),
];

const listRules = [
  query('status').optional().isIn(STATUSES),
  query('supplier_id').optional().isUUID(),
  query('supplier_company_id').optional().isUUID(),
  body('cash_register_id').optional({ nullable: true }).isUUID(),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('payment_type').optional().isIn(PAYMENT_TYPES),
  query('payment_method').optional().isIn(PAYMENT_METHODS),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('is_overdue').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const incomingRules = [
  query('status').optional().isIn(STATUSES),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const itemAdjustmentRules = [
  body('item_adjustments').optional().isArray(),
  body('item_adjustments.*.item_id').isUUID(),
  body('item_adjustments.*.unit_price').optional().isFloat({ min: 0 }),
  body('item_adjustments.*.bonus_quantity').optional().isFloat({ min: 0 }),
  body('item_adjustments.*.discount_rate').optional().isFloat({ min: 0, max: 100 }),
  body('item_adjustments.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('item_adjustments.*.batch_number').optional().isString().trim(),
  body('item_adjustments.*.expiry_date').optional().isISO8601(),
  body('item_adjustments.*.reason').optional().isString().trim().isLength({ max: 1000 }),
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /purchase-orders — قائمة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders:
 *   get:
 *     summary: قائمة أوامر الشراء
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, pending_approval, approved, rejected, confirmed, cancelled]
 *       - in: query
 *         name: supplier_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: supplier_company_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: payment_type
 *         schema: { type: string, enum: [cash, credit, partial] }
 *       - in: query
 *         name: payment_method
 *         schema: { type: string, enum: [cash, bank, cheque, card, wallet, other] }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: is_overdue
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة أوامر الشراء
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('purchase_orders.view'),
  listRules,
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /purchase-orders/incoming — الطلبات الواردة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/incoming:
 *   get:
 *     summary: الطلبات الواردة من الشركات الأخرى
 *     description: أوامر شراء أُنشئت من شركات متصلة (B2B).
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, pending_approval, approved, rejected, confirmed, cancelled] }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: قائمة الطلبات الواردة
 */
router.get(
  '/incoming',
  authorize('purchase_orders.view'),
  incomingRules,
  validate,
  ctrl.getIncoming
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /purchase-orders/delivery/preview — معاينة QR
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/delivery/preview:
 *   get:
 *     summary: معاينة التسليم بـ QR token
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: بيانات التسليم
 *       400:
 *         description: token مفقود أو غير صالح
 */
router.get(
  '/delivery/preview',
  authorize('purchase_orders.view'),
  [query('token').isString().trim().notEmpty()],
  validate,
  ctrl.previewByToken
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /purchase-orders/delivery/confirm-by-token — تأكيد QR
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/delivery/confirm-by-token:
 *   post:
 *     summary: تأكيد التسليم بـ QR token
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *               used_mode:
 *                 type: string
 *                 enum: [authenticated, public]
 *     responses:
 *       200:
 *         description: تم التأكيد
 *       400:
 *         description: token غير صالح أو منتهي
 */
router.post(
  '/delivery/confirm-by-token',
  authorize('purchase_orders.confirm'),
  [
    body('token').isString().trim().notEmpty(),
    body('used_mode').optional().isIn(['authenticated', 'public']),
  ],
  validate,
  ctrl.confirmByToken
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /purchase-orders — إنشاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders:
 *   post:
 *     summary: إنشاء أمر شراء
 *     description: |
 *       **أنواع الدفع:**
 *       - cash: نقدي
 *       - credit: آجل
 *       - partial: جزئي
 *
 *       **بنود:** يدعم `conversion_factor` (وحدات متعددة).
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [supplier_id, currency_id, items]
 *             properties:
 *               supplier_id:
 *                 type: string
 *                 format: uuid
 *               currency_id:
 *                 type: string
 *                 format: uuid
 *               order_date:
 *                 type: string
 *                 format: date
 *               payment_type:
 *                 type: string
 *                 enum: [cash, credit, partial]
 *               payment_method:
 *                 type: string
 *                 enum: [cash, bank, cheque, card, wallet, other]
 *               payment_terms_days:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 365
 *               paid_amount:
 *                 type: number
 *                 minimum: 0
 *               supplier_invoice_number:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id]
 *                   properties:
 *                     product_id:
 *                       type: string
 *                       format: uuid
 *                     quantity:
 *                       type: number
 *                     unit_price:
 *                       type: number
 *                     batch_number:
 *                       type: string
 *                     expiry_date:
 *                       type: string
 *                       format: date
 *     responses:
 *       201:
 *         description: تم إنشاء الأمر
 *       400:
 *         description: بيانات غير صالحة
 */
router.post(
  '/',
  authorize('purchase_orders.create'),
  createRules,
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /purchase-orders/:id/confirm — تأكيد
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/{id}/confirm:
 *   post:
 *     summary: تأكيد أمر شراء
 *     description: |
 *       - يتحقق من وجود قيد محاسبي (trigger).
 *       - قد يتطلب `delivery_token` (إذا مُفعّل).
 *     tags: [Purchases]
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
 *               delivery_token:
 *                 type: string
 *               used_mode:
 *                 type: string
 *                 enum: [authenticated, public]
 *     responses:
 *       200:
 *         description: تم التأكيد
 *       400:
 *         description: |
 *           - الأمر ليس في حالة مناسبة
 *           - لا يوجد قيد محاسبي
 */
router.post(
  '/:id/confirm',
  authorize('purchase_orders.confirm'),
  [
    param('id').isUUID(),
    body('delivery_token').optional().isString(),
    body('used_mode').optional().isIn(['authenticated', 'public']),
  ],
  validate,
  ctrl.confirm
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /purchase-orders/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/{id}/cancel:
 *   post:
 *     summary: إلغاء أمر شراء
 *     tags: [Purchases]
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
 *         description: الأمر ملغى مسبقاً
 */
router.post(
  '/:id/cancel',
  authorize('purchase_orders.cancel'),
  [param('id').isUUID()],
  validate,
  ctrl.cancel
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /purchase-orders/:id/approve — موافقة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/{id}/approve:
 *   post:
 *     summary: موافقة المورد على أمر شراء
 *     description: |
 *       - المورد يمكنه تعديل البنود (`item_adjustments`).
 *       - ينشئ QR للتسليم (إن مُفعّل).
 *     tags: [Purchases]
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
 *               item_adjustments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     item_id:
 *                       type: string
 *                       format: uuid
 *                     unit_price:
 *                       type: number
 *                     bonus_quantity:
 *                       type: number
 *                     reason:
 *                       type: string
 *               qr_mode:
 *                 type: string
 *                 enum: [authenticated, public, both]
 *               qr_ttl_days:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 365
 *     responses:
 *       200:
 *         description: تمت الموافقة
 *       403:
 *         description: غير مصرح (ليس المورد)
 */
router.post(
  '/:id/approve',
  authorize('purchase_orders.approve'),
  [
    param('id').isUUID(),
    ...itemAdjustmentRules,
    body('qr_mode').optional().isIn(QR_MODES),
    body('qr_ttl_days').optional().isInt({ min: 1, max: 365 }),
  ],
  validate,
  ctrl.approve
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /purchase-orders/:id/reject — رفض
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/{id}/reject:
 *   post:
 *     summary: رفض أمر شراء
 *     tags: [Purchases]
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
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: تم الرفض
 *       400:
 *         description: reason مفقود
 */
router.post(
  '/:id/reject',
  authorize('purchase_orders.reject'),
  [
    param('id').isUUID(),
    body('reason')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Rejection reason is required')
      .isLength({ max: 1000 }),
  ],
  validate,
  ctrl.reject
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /purchase-orders/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /purchase-orders/{id}:
 *   get:
 *     summary: تفاصيل أمر شراء
 *     tags: [Purchases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل الأمر
 *       404:
 *         description: الأمر غير موجود
 */
router.get(
  '/:id',
  authorize('purchase_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

module.exports = router;