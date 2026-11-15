// routes/invoiceRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/InvoiceController');
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

const STATUSES = ['unpaid', 'partial', 'paid', 'cancelled'];
const INVOICE_TYPES = ['sales', 'purchase'];
const REFERENCE_TYPES = ['sales_order', 'purchase_order', 'delivery_note'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /invoices — قائمة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /invoices:
 *   get:
 *     summary: قائمة الفواتير (بيع/شراء)
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [unpaid, partial, paid, cancelled]
 *       - in: query
 *         name: invoice_type
 *         schema:
 *           type: string
 *           enum: [sales, purchase]
 *       - in: query
 *         name: customer_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: supplier_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: reference_type
 *         schema:
 *           type: string
 *           enum: [sales_order, purchase_order, delivery_note]
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
 *         description: قائمة الفواتير
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
 *                           invoice_number: { type: string }
 *                           invoice_type: { type: string, enum: [sales, purchase] }
 *                           invoice_date: { type: string, format: date }
 *                           due_date: { type: string, format: date, nullable: true }
 *                           total: { type: number }
 *                           paid_amount: { type: number }
 *                           balance: { type: number }
 *                           status: { type: string }
 *                           party_name: { type: string }
 *                           is_overdue: { type: boolean }
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('invoices.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('invoice_type').optional().isIn(INVOICE_TYPES),
    query('customer_id').optional().isUUID(),
    query('supplier_id').optional().isUUID(),
    query('reference_type').optional().isIn(REFERENCE_TYPES),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /invoices/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /invoices/{id}:
 *   get:
 *     summary: تفاصيل فاتورة
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل الفاتورة
 *       404:
 *         description: الفاتورة غير موجودة
 */
router.get(
  '/:id',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /invoices/:id/payments — دفعات الفاتورة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /invoices/{id}/payments:
 *   get:
 *     summary: دفعات فاتورة
 *     tags: [Invoices]
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
  '/:id/payments',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getPayments
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /invoices/from-order/:orderId — من أمر بيع
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /invoices/from-order/{orderId}:
 *   post:
 *     summary: إنشاء فاتورة بيع من أمر بيع
 *     description: |
 *       **الشروط:**
 *       - أمر البيع بحالة `confirmed`.
 *       - لديه `journal_entry_id`.
 *       - لا توجد فاتورة سابقة.
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               due_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: تم إنشاء الفاتورة
 *       400:
 *         description: أمر البيع غير confirmed أو بدون قيد
 *       409:
 *         description: فاتورة موجودة مسبقاً
 */
router.post(
  '/from-order/:orderId',
  authorize('invoices.create'),
  [
    param('orderId').isUUID(),
    body('due_date').optional().isISO8601(),
  ],
  validate,
  ctrl.createFromOrder
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /invoices/from-purchase-order/:orderId — من أمر شراء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /invoices/from-purchase-order/{orderId}:
 *   post:
 *     summary: إنشاء فاتورة شراء من أمر شراء
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               due_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: تم إنشاء الفاتورة
 *       409:
 *         description: فاتورة موجودة مسبقاً
 */
router.post(
  '/from-purchase-order/:orderId',
  authorize('invoices.create'),
  [
    param('orderId').isUUID(),
    body('due_date').optional().isISO8601(),
  ],
  validate,
  ctrl.createFromPurchaseOrder
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /invoices/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /invoices/{id}/cancel:
 *   post:
 *     summary: إلغاء فاتورة
 *     description: |
 *       - يسمح فقط لـ `unpaid`.
 *       - يُنشئ قيداً عكسياً.
 *       - يُعيد حالة المرجع:
 *         • `sales_order` → confirmed
 *         • `purchase_order` → confirmed
 *         • `delivery_note` → delivered
 *       - يرفض لو هناك payments.
 *     tags: [Invoices]
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
 *           - الفاتورة مدفوعة/جزئية
 *           - لديها دفعات
 *           - ملغاة مسبقاً
 */
router.post(
  '/:id/cancel',
  authorize('invoices.cancel'),
  [param('id').isUUID()],
  validate,
  ctrl.cancel
);

module.exports = router;