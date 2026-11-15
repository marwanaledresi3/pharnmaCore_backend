// routes/stockAdjustmentRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/StockAdjustmentController');
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
const REASONS = ['physical_count', 'damage', 'theft', 'expiry', 'error', 'other'];

// ═══════════════════════════════════════════════════════════════
// GET /stock-adjustments — قائمة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-adjustments:
 *   get:
 *     summary: قائمة تسويات الجرد
 *     tags: [StockAdjustments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, confirmed, cancelled]
 *       - in: query
 *         name: warehouse_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: reason
 *         schema:
 *           type: string
 *           enum: [physical_count, damage, theft, expiry, error, other]
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
 *         description: قائمة التسويات
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
 *                         $ref: '#/components/schemas/StockAdjustmentListItem'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('stock_adjustments.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('warehouse_id').optional().isUUID(),
    query('reason').optional().isIn(REASONS),
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
// GET /stock-adjustments/warehouse-products/:warehouseId — منتجات المستودع
// ⚠️ يجب أن يكون قبل /:id
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-adjustments/warehouse-products/{warehouseId}:
 *   get:
 *     summary: جلب المنتجات المتاحة في مستودع (للجرد)
 *     tags: [StockAdjustments]
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
  authorize('stock_adjustments.create'),
  [
    param('warehouseId').isUUID(),
    query('search').optional().isString().trim().isLength({ max: 100 }),
  ],
  validate,
  ctrl.getWarehouseProducts
);

// ═══════════════════════════════════════════════════════════════
// POST /stock-adjustments — إنشاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-adjustments:
 *   post:
 *     summary: إنشاء تسوية جرد (مسودة)
 *     description: |
 *       **ملاحظة:**
 *       - `system_quantity` تُجلب تلقائياً.
 *       - `difference = actual_quantity - system_quantity`.
 *     tags: [StockAdjustments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [warehouse_id, reason, items]
 *             properties:
 *               warehouse_id:
 *                 type: string
 *                 format: uuid
 *               reason:
 *                 type: string
 *                 enum: [physical_count, damage, theft, expiry, error, other]
 *               adjustment_date:
 *                 type: string
 *                 format: date
 *               notes:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id, actual_quantity]
 *                   properties:
 *                     product_id:
 *                       type: string
 *                       format: uuid
 *                     batch_id:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                     actual_quantity:
 *                       type: number
 *                       minimum: 0
 *                     unit_cost:
 *                       type: number
 *                       minimum: 0
 *                     notes:
 *                       type: string
 *     responses:
 *       201:
 *         description: تم إنشاء التسوية
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/StockAdjustment'
 *       400:
 *         description: بيانات غير صالحة
 */
router.post(
  '/',
  authorize('stock_adjustments.create'),
  [
    body('warehouse_id').isUUID(),
    body('reason').isIn(REASONS),
    body('adjustment_date').optional().isISO8601(),
    body('notes').optional().isString().trim().isLength({ max: 1000 }),
    body('items').isArray({ min: 1 }),
    body('items.*.product_id').isUUID(),
    body('items.*.actual_quantity').isFloat({ min: 0 }),
    body('items.*.batch_id').optional({ nullable: true }).isUUID(),
    body('items.*.unit_cost').optional({ nullable: true }).isFloat({ min: 0 }),
    body('items.*.notes').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════
// GET /stock-adjustments/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-adjustments/{id}:
 *   get:
 *     summary: تفاصيل تسوية جرد
 *     tags: [StockAdjustments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل التسوية
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/StockAdjustment'
 *       404:
 *         description: التسوية غير موجودة
 */
router.get(
  '/:id',
  authorize('stock_adjustments.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════
// POST /stock-adjustments/:id/confirm — تأكيد
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-adjustments/{id}/confirm:
 *   post:
 *     summary: تأكيد تسوية الجرد
 *     description: |
 *       **ماذا يحدث:**
 *       1. تعديل كميات الدفعات.
 *       2. تسجيل `stock_movements` (adjustment).
 *       3. إنشاء قيد محاسبي (إذا `stock_adjustment_auto_journal = true`):
 *          - فائض: Dr 113 (مخزون) / Cr 518 (فروقات)
 *          - عجز: Dr 518 (فروقات) / Cr 113 (مخزون)
 *       4. تحديث الحالة إلى `confirmed`.
 *
 *       **Rollback مضمون** عند أي فشل.
 *     tags: [StockAdjustments]
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
 *                   $ref: '#/components/schemas/StockAdjustment'
 *       400:
 *         description: |
 *           - التسوية مؤكدة/ملغاة
 *           - لا توجد فروقات
 *           - كمية غير كافية
 *       500:
 *         description: |
 *           - حساب محاسبي مفقود
 *           - قيد غير متوازن
 *       409:
 *         description: تعارض في الحالة
 */
router.post(
  '/:id/confirm',
  authorize('stock_adjustments.confirm'),
  [param('id').isUUID()],
  validate,
  ctrl.confirm
);

// ═══════════════════════════════════════════════════════════════
// POST /stock-adjustments/:id/cancel — إلغاء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /stock-adjustments/{id}/cancel:
 *   post:
 *     summary: إلغاء تسوية الجرد
 *     description: |
 *       - draft → إلغاء بسيط
 *       - confirmed → عكس الحركات + عكس القيد المحاسبي
 *     tags: [StockAdjustments]
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
 *           - ملغاة مسبقاً
 *           - كمية غير كافية للعكس
 *           - حركات أصلية مفقودة
 */
router.post(
  '/:id/cancel',
  authorize('stock_adjustments.cancel'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.cancel
);

module.exports = router;