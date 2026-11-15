// routes/deliveryNoteRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/DeliveryNoteController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const STATUSES = ['draft', 'dispatched', 'delivered', 'invoiced', 'cancelled'];

// ═══════════════════════════════════════════════════════════════
// GET /delivery-notes — قائمة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes:
 *   get:
 *     summary: قائمة مذكرات التسليم
 *     tags: [DeliveryNotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, dispatched, delivered, invoiced, cancelled]
 *       - in: query
 *         name: customer_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: warehouse_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المذكرات
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
 *                         $ref: '#/components/schemas/DeliveryNoteListItem'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('delivery_notes.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('customer_id').optional().isUUID(),
    query('warehouse_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('search').optional().isString().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════
// GET /delivery-notes/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes/{id}:
 *   get:
 *     summary: تفاصيل مذكرة تسليم
 *     tags: [DeliveryNotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل المذكرة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/DeliveryNote'
 *       404:
 *         description: المذكرة غير موجودة
 */
router.get(
  '/:id',
  authorize('delivery_notes.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════
// POST /delivery-notes — إنشاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes:
 *   post:
 *     summary: إنشاء مذكرة تسليم (مسودة)
 *     tags: [DeliveryNotes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, warehouse_id, items]
 *             properties:
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *               warehouse_id:
 *                 type: string
 *                 format: uuid
 *               delivery_date:
 *                 type: string
 *                 format: date
 *               sales_order_id:
 *                 type: string
 *                 format: uuid
 *               driver_name:
 *                 type: string
 *               driver_phone:
 *                 type: string
 *               vehicle_number:
 *                 type: string
 *               delivery_address:
 *                 type: string
 *               notes:
 *                 type: string
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
 *                     unit_price:
 *                       type: number
 *                       minimum: 0
 *                     batch_id:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *     responses:
 *       201:
 *         description: تم إنشاء المذكرة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/DeliveryNote'
 *       400:
 *         description: بيانات غير صالحة
 */
router.post(
  '/',
  authorize('delivery_notes.create'),
  [
    body('customer_id').isUUID(),
    body('warehouse_id').isUUID(),
    body('delivery_date').optional().isISO8601(),
    body('sales_order_id').optional({ nullable: true }).isUUID(),
    body('driver_name').optional().isString().trim().isLength({ max: 150 }),
    body('driver_phone').optional().isString().trim().isLength({ max: 50 }),
    body('vehicle_number').optional().isString().trim().isLength({ max: 50 }),
    body('delivery_address').optional().isString().trim().isLength({ max: 1000 }),
    body('notes').optional().isString().trim().isLength({ max: 1000 }),
    body('items').isArray({ min: 1 }),
    body('items.*.product_id').isUUID(),
    body('items.*.quantity').isFloat({ gt: 0 }),
    body('items.*.batch_id').optional({ nullable: true }).isUUID(),
    body('items.*.unit_price').optional().isFloat({ min: 0 }),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════
// POST /delivery-notes/:id/dispatch — صرف
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes/{id}/dispatch:
 *   post:
 *     summary: صرف المذكرة للشحن (يخصم المخزون)
 *     tags: [DeliveryNotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الصرف
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/DeliveryNote'
 *       400:
 *         description: |
 *           - المذكرة ليست draft
 *           - كمية غير كافية
 */
router.post(
  '/:id/dispatch',
  authorize('delivery_notes.dispatch'),
  [param('id').isUUID()],
  validate,
  ctrl.dispatch
);

// ═══════════════════════════════════════════════════════════════
// POST /delivery-notes/:id/mark-delivered — تأكيد التسليم
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes/{id}/mark-delivered:
 *   post:
 *     summary: تأكيد التسليم
 *     tags: [DeliveryNotes]
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
 *               delivered_to_name:
 *                 type: string
 *               signature_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: تم التأكيد
 *       400:
 *         description: المذكرة ليست dispatched
 */
router.post(
  '/:id/mark-delivered',
  authorize('delivery_notes.deliver'),
  [
    param('id').isUUID(),
    body('delivered_to_name').optional().isString().trim().isLength({ max: 150 }),
    body('signature_url').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.markDelivered
);

// ═══════════════════════════════════════════════════════════════
// POST /delivery-notes/:id/convert-to-invoice — تحويل لفاتورة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes/{id}/convert-to-invoice:
 *   post:
 *     summary: تحويل المذكرة إلى فاتورة
 *     description: |
 *       يُنشئ فاتورة بيع + قيد محاسبي:
 *       - Dr 112 (ذمم عملاء) — total
 *       - Cr 411 (إيرادات مبيعات) — subtotal
 *
 *       **Rollback مضمون** عند أي فشل.
 *     tags: [DeliveryNotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم التحويل
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     delivery_note:
 *                       $ref: '#/components/schemas/DeliveryNote'
 *                     invoice:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         invoice_number: { type: string }
 *                         total: { type: number }
 *                         status: { type: string }
 *                         journal_entry_id: { type: string, format: uuid }
 *       400:
 *         description: |
 *           - المذكرة ليست delivered
 *           - محوّلة مسبقاً
 *       409:
 *         description: فاتورة موجودة مسبقاً
 *       500:
 *         description: حساب محاسبي مفقود
 */
router.post(
  '/:id/convert-to-invoice',
  authorize('delivery_notes.invoice'),
  [param('id').isUUID()],
  validate,
  ctrl.convertToInvoice
);

// ═══════════════════════════════════════════════════════════════
// POST /delivery-notes/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes/{id}/cancel:
 *   post:
 *     summary: إلغاء المذكرة
 *     description: |
 *       - draft → إلغاء بسيط
 *       - dispatched/delivered → عكس حركات المخزون
 *       - invoiced → ممنوع (ألغِ الفاتورة أولاً)
 *     tags: [DeliveryNotes]
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
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: تم الإلغاء
 *       400:
 *         description: |
 *           - ملغاة مسبقاً
 *           - محوّلة لفاتورة
 */
router.post(
  '/:id/cancel',
  authorize('delivery_notes.cancel'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.cancel
);

// ═══════════════════════════════════════════════════════════════
// GET /delivery-notes/warehouse-products/:warehouseId — منتجات المستودع
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /delivery-notes/warehouse-products/{warehouseId}:
 *   get:
 *     summary: جلب المنتجات المتاحة في مستودع
 *     tags: [DeliveryNotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *     responses:
 *       200:
 *         description: قائمة المنتجات المتاحة
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
 *                           product_id: { type: string, format: uuid }
 *                           product_name: { type: string }
 *                           product_sku: { type: string }
 *                           product_unit: { type: string }
 *                           batch_id: { type: string, format: uuid, nullable: true }
 *                           batch_number: { type: string, nullable: true }
 *                           batch_expiry: { type: string, format: date, nullable: true }
 *                           system_quantity: { type: number }
 *                           cost_price: { type: number }
 */
router.get(
  '/warehouse-products/:warehouseId',
  authorize('delivery_notes.create'),
  [
    param('warehouseId').isUUID(),
    query('search').optional().isString().trim().isLength({ max: 100 }),
  ],
  validate,
  ctrl.getWarehouseProducts
);

module.exports = router;