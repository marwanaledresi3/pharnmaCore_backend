// routes/salesOrderRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/SalesOrderController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const STATUSES = ['draft', 'confirmed', 'invoiced', 'cancelled'];

const listRules = [
  query('status').optional().isIn(STATUSES),
  query('customer_id').optional().isUUID(),
  query('warehouse_id').optional().isUUID(),
  query('cash_register_id').optional().isUUID(),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('has_journal_entry').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const createRules = [
  body('customer_id').isUUID(),
  body('currency_id').isUUID(),
  body('warehouse_id').optional({ nullable: true }).isUUID(),
  body('cash_register_id').optional({ nullable: true }).isUUID(),
  body('order_date').optional().isISO8601(),
  body('exchange_rate').optional().isFloat({ gt: 0 }),
  body('payment_type').optional().isIn(['cash', 'credit', 'partial']),
  body('payment_method').optional().isIn(['cash', 'bank', 'cheque']),
  body('payment_terms_days').optional().isInt({ min: 0, max: 365 }),
  body('paid_amount').optional().isFloat({ min: 0 }),
  body('discount_rate').optional().isFloat({ min: 0, max: 100 }),

  body('items').isArray({ min: 1 }),
  body('items.*.product_id').isUUID(),
  body('items.*.batch_id').optional({ nullable: true }).isUUID(),
  body('items.*.paid_quantity').optional().isFloat({ gt: 0 }),
  body('items.*.bonus_quantity').optional().isFloat({ min: 0 }),
  body('items.*.quantity').optional().isFloat({ gt: 0 }),
  body('items').custom((items) => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.paid_quantity === undefined && it.quantity === undefined) {
        throw new Error(`items[${i}]: paid_quantity or quantity is required`);
      }
    }
    return true;
  }),
  body('items.*.unit_price').isFloat({ min: 0 }),
  body('items.*.discount_rate').optional().isFloat({ min: 0, max: 100 }),
  body('items.*.discount_amount').optional().isFloat({ min: 0 }),
  body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('items.*.unit_id').optional({ nullable: true }).isUUID(),
  body('items.*.conversion_factor').optional().isFloat({ gt: 0 }),
  body('items.*.conversion_factor').custom((value, { req, path }) => {
    if (value === undefined) return true;
    const factor = Number(value);
    if (factor > 1) {
      const m = path.match(/items\[(\d+)\]/);
      const idx = m ? Number(m[1]) : null;
      const item = idx != null ? req.body.items?.[idx] : null;
      if (!item?.unit_id) {
        throw new Error(`items[${idx}]: unit_id is required when conversion_factor > 1`);
      }
    }
    return true;
  }),
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /sales-orders
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /sales-orders:
 *   get:
 *     summary: قائمة أوامر البيع
 *     tags: [Sales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, confirmed, invoiced, cancelled] }
 *       - in: query
 *         name: customer_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: warehouse_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: cash_register_id
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
 *         name: has_journal_entry
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: قائمة أوامر البيع
 */
router.get(
  '/',
  authorize('sales_orders.view'),
  listRules,
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /sales-orders/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /sales-orders/{id}:
 *   get:
 *     summary: تفاصيل أمر بيع
 *     tags: [Sales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل أمر البيع
 *       404:
 *         description: أمر البيع غير موجود
 */
router.get(
  '/:id',
  authorize('sales_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /sales-orders
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /sales-orders:
 *   post:
 *     summary: إنشاء أمر بيع
 *     tags: [Sales]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, currency_id, items]
 *             properties:
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *               currency_id:
 *                 type: string
 *                 format: uuid
 *               warehouse_id:
 *                 type: string
 *                 format: uuid
 *               cash_register_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               order_date:
 *                 type: string
 *                 format: date
 *               exchange_rate:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               payment_type:
 *                 type: string
 *                 enum: [cash, credit, partial]
 *               payment_method:
 *                 type: string
 *                 enum: [cash, bank, cheque]
 *               payment_terms_days:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 365
 *               paid_amount:
 *                 type: number
 *                 minimum: 0
 *               discount_rate:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id, unit_price]
 *                   properties:
 *                     product_id:
 *                       type: string
 *                       format: uuid
 *                     batch_id:
 *                       type: string
 *                       format: uuid
 *                     paid_quantity:
 *                       type: number
 *                       exclusiveMinimum: 0
 *                     bonus_quantity:
 *                       type: number
 *                       minimum: 0
 *                     quantity:
 *                       type: number
 *                       exclusiveMinimum: 0
 *                     unit_price:
 *                       type: number
 *                       minimum: 0
 *                     discount_rate:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *                     tax_rate:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *                     unit_id:
 *                       type: string
 *                       format: uuid
 *                     conversion_factor:
 *                       type: number
 *                       exclusiveMinimum: 0
 *     responses:
 *       201:
 *         description: تم إنشاء أمر البيع
 */
router.post(
  '/',
  authorize('sales_orders.create'),
  createRules,
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /sales-orders/:id/confirm
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /sales-orders/{id}/confirm:
 *   post:
 *     summary: تأكيد أمر بيع (ينشئ القيد)
 *     tags: [Sales]
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
 *         description: الأمر ليس draft
 */
router.post(
  '/:id/confirm',
  authorize('sales_orders.confirm'),
  [param('id').isUUID()],
  validate,
  ctrl.confirm
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /sales-orders/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /sales-orders/{id}/cancel:
 *   post:
 *     summary: إلغاء أمر بيع
 *     tags: [Sales]
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
 *         description: الأمر مفوتر أو ملغى مسبقاً
 */
router.post(
  '/:id/cancel',
  authorize('sales_orders.cancel'),
  [param('id').isUUID()],
  validate,
  ctrl.cancel
);

module.exports = router;