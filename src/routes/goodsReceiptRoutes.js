// routes/goodsReceiptRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/GoodsReceiptController');
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

const STATUSES = ['draft', 'confirmed', 'cancelled'];

// ═══════════════════════════════════════════════════════════════
// GET /goods-receipts — قائمة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /goods-receipts:
 *   get:
 *     summary: قائمة أذون الاستلام
 *     tags: [GoodsReceipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, confirmed, cancelled]
 *       - in: query
 *         name: supplier_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: warehouse_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: purchase_order_id
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
 *         description: قائمة الأذون
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
 *                         $ref: '#/components/schemas/GoodsReceiptListItem'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('goods_receipts.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('supplier_id').optional().isUUID(),
    query('warehouse_id').optional().isUUID(),
    query('purchase_order_id').optional().isUUID(),
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
// POST /goods-receipts — إنشاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /goods-receipts:
 *   post:
 *     summary: إنشاء إذن استلام (مسودة)
 *     description: |
 *       **أنواع الدفع:**
 *       - `cash` — نقدي (Cr 1111 صندوق)
 *       - `credit` — آجل (Cr 211 ذمم موردين)
 *
 *       **ملاحظة:** الدفعات تُنشأ تلقائياً عند التأكيد.
 *     tags: [GoodsReceipts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [supplier_id, warehouse_id, items]
 *             properties:
 *               supplier_id:
 *                 type: string
 *                 format: uuid
 *               warehouse_id:
 *                 type: string
 *                 format: uuid
 *               purchase_order_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               receipt_date:
 *                 type: string
 *                 format: date
 *               payment_type:
 *                 type: string
 *                 enum: [cash, credit]
 *                 default: credit
 *               notes:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id, quantity, unit_price]
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
 *                     batch_number:
 *                       type: string
 *                     expiry_date:
 *                       type: string
 *                       format: date
 *                     tax_rate:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *     responses:
 *       201:
 *         description: تم إنشاء الإذن
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/GoodsReceipt'
 *       400:
 *         description: بيانات غير صالحة
 */
router.post(
  '/',
  authorize('goods_receipts.create'),
  [
    body('supplier_id').isUUID(),
    body('warehouse_id').isUUID(),
    body('purchase_order_id').optional({ nullable: true }).isUUID(),
    body('receipt_date').optional().isISO8601(),
    body('payment_type').optional().isIn(['cash', 'credit']),
    body('notes').optional().isString().trim().isLength({ max: 1000 }),
    body('items').isArray({ min: 1 }),
    body('items.*.product_id').isUUID(),
    body('items.*.quantity').isFloat({ gt: 0 }),
    body('items.*.unit_price').isFloat({ min: 0 }),
    body('items.*.batch_number').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('items.*.expiry_date').optional({ nullable: true }).isISO8601(),
    body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════
// GET /goods-receipts/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /goods-receipts/{id}:
 *   get:
 *     summary: تفاصيل إذن استلام
 *     tags: [GoodsReceipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل الإذن
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/GoodsReceipt'
 *       404:
 *         description: الإذن غير موجود
 */
router.get(
  '/:id',
  authorize('goods_receipts.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════
// POST /goods-receipts/:id/confirm — تأكيد
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /goods-receipts/{id}/confirm:
 *   post:
 *     summary: تأكيد إذن الاستلام
 *     description: |
 *       **ماذا يحدث:**
 *       1. إضافة الكميات للمخزون (إنشاء دفعات).
 *       2. تسجيل `stock_movements` (goods_receipt).
 *       3. إنشاء قيد محاسبي:
 *          - Dr 113 (مخزون) — subtotal
 *          - Dr 114 (ضريبة مدخلات) — tax_total
 *          - Cr 211 (ذمم موردين) أو Cr 1111 (صندوق) — total
 *       4. ترحيل القيد.
 *       5. تحديث الحالة إلى `confirmed`.
 *
 *       **Rollback مضمون** عند أي فشل.
 *     tags: [GoodsReceipts]
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/GoodsReceipt'
 *       400:
 *         description: |
 *           - الإذن مؤكد/ملغى
 *           - الإجماليات غير صحيحة
 *           - دفعة لا تنتمي للشركة
 *       500:
 *         description: |
 *           - حساب محاسبي مفقود
 *           - قيد غير متوازن
 *       409:
 *         description: تعارض في الحالة
 */
router.post(
  '/:id/confirm',
  authorize('goods_receipts.confirm'),
  [param('id').isUUID()],
  validate,
  ctrl.confirm
);

// ═══════════════════════════════════════════════════════════════
// POST /goods-receipts/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /goods-receipts/{id}/cancel:
 *   post:
 *     summary: إلغاء إذن الاستلام
 *     description: |
 *       - draft → إلغاء بسيط
 *       - confirmed → عكس الحركات + عكس القيد المحاسبي
 *     tags: [GoodsReceipts]
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     cancelled: { type: boolean, example: true }
 *                     reversed: { type: boolean, example: true }
 *       400:
 *         description: |
 *           - ملغى مسبقاً
 *           - كمية غير كافية للعكس
 */
router.post(
  '/:id/cancel',
  authorize('goods_receipts.cancel'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.cancel
);

module.exports = router;