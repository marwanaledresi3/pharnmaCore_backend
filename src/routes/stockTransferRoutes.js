// routes/stockTransferRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/StockTransferController');
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
// GET /stock-transfers — قائمة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-transfers:
 *   get:
 *     summary: قائمة أذون التحويل
 *     tags: [StockTransfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, confirmed, cancelled]
 *       - in: query
 *         name: from_warehouse_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: to_warehouse_id
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
 *         description: قائمة التحويلات
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
 *                         $ref: '#/components/schemas/StockTransferListItem'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('stock_transfers.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('from_warehouse_id').optional().isUUID(),
    query('to_warehouse_id').optional().isUUID(),
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
// POST /stock-transfers — إنشاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-transfers:
 *   post:
 *     summary: إنشاء إذن تحويل (مسودة)
 *     description: |
 *       **الشروط:**
 *       - `from_warehouse_id` ≠ `to_warehouse_id`
 *       - كل `product_id` موجود ونشط
 *       - إذا `from_batch_id` محدد: موجود في المصدر + كمية كافية
 *     tags: [StockTransfers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from_warehouse_id, to_warehouse_id, items]
 *             properties:
 *               from_warehouse_id:
 *                 type: string
 *                 format: uuid
 *               to_warehouse_id:
 *                 type: string
 *                 format: uuid
 *               transfer_date:
 *                 type: string
 *                 format: date
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
 *                     from_batch_id:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                     unit_cost:
 *                       type: number
 *                       minimum: 0
 *     responses:
 *       201:
 *         description: تم إنشاء التحويل
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/StockTransfer'
 *       400:
 *         description: بيانات غير صالحة
 */
router.post(
  '/',
  authorize('stock_transfers.create'),
  [
    body('from_warehouse_id').isUUID(),
    body('to_warehouse_id').isUUID(),
    body('transfer_date').optional().isISO8601(),
    body('notes').optional().isString().trim().isLength({ max: 1000 }),
    body('items').isArray({ min: 1 }),
    body('items.*.product_id').isUUID(),
    body('items.*.quantity').isFloat({ gt: 0 }),
    body('items.*.from_batch_id').optional({ nullable: true }).isUUID(),
    body('items.*.unit_cost').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════
// GET /stock-transfers/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-transfers/{id}:
 *   get:
 *     summary: تفاصيل إذن تحويل
 *     tags: [StockTransfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل التحويل
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/StockTransfer'
 *       404:
 *         description: التحويل غير موجود
 */
router.get(
  '/:id',
  authorize('stock_transfers.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════
// POST /stock-transfers/:id/confirm — تأكيد
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-transfers/{id}/confirm:
 *   post:
 *     summary: تأكيد التحويل (ينقل المخزون)
 *     description: |
 *       **ماذا يحدث:**
 *       1. خصم من المصدر (FIFO إذا لم تُحدَّد دفعة)
 *       2. إضافة للوجهة (إنشاء دفعة جديدة أو تحديث)
 *       3. تسجيل `stock_movements` (transfer_out + transfer_in)
 *       4. تحديث الحالة إلى `confirmed`
 *
 *       **Rollback مضمون** عند أي فشل.
 *     tags: [StockTransfers]
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
 *                   $ref: '#/components/schemas/StockTransfer'
 *       400:
 *         description: |
 *           - التحويل مؤكد/ملغي
 *           - كمية غير كافية
 *       409:
 *         description: تعارض في الحالة
 */
router.post(
  '/:id/confirm',
  authorize('stock_transfers.confirm'),
  [param('id').isUUID()],
  validate,
  ctrl.confirm
);

// ═══════════════════════════════════════════════════════════════
// POST /stock-transfers/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-transfers/{id}/cancel:
 *   post:
 *     summary: إلغاء التحويل
 *     description: |
 *       - draft → إلغاء بسيط
 *       - confirmed → عكس الحركات (getTransferMovements + reverseTransferMovements)
 *     tags: [StockTransfers]
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
 *           - ملغي مسبقاً
 *           - كمية غير كافية للعكس
 */
router.post(
  '/:id/cancel',
  authorize('stock_transfers.cancel'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.cancel
);

module.exports = router;