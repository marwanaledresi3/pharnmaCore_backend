// routes/documentsRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/DocumentsController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const DOCUMENT_TYPES = [
  'invoice_sales',
  'invoice_purchase',
  'payment_receive',
  'payment_pay',
  'payment_refund',
  'payment_credit_apply',
  'expense',
  'return_sale',
  'return_purchase',
  'journal_entry',
  'note_credit',
  'note_debit',
  'delivery_note',
  'stock_transfer',
  'stock_adjustment',
];

const STATUSES = [
  'draft', 'posted', 'confirmed', 'dispatched',
  'delivered', 'invoiced', 'unpaid', 'partial', 'paid', 'cancelled',
];

// ═══════════════════════════════════════════════════════════════
// GET /documents — قائمة موحدة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /documents:
 *   get:
 *     summary: قائمة موحدة لكل المستندات
 *     description: |
 *       يجمع المستندات من 9 جداول في استعلام واحد.
 *
 *       **الأنواع المدعومة (15):**
 *       - فواتير (بيع/شراء)
 *       - مدفوعات (قبض/صرف/استرداد/تخصيص)
 *       - مصروفات
 *       - مرتجعات (بيع/شراء)
 *       - إشعارات (دائن/مدين)
 *       - مذكرات تسليم
 *       - أذون تحويل
 *       - تسويات جرد
 *       - قيود يومية (يدوية)
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: document_type
 *         schema:
 *           type: string
 *           enum:
 *             - invoice_sales
 *             - invoice_purchase
 *             - payment_receive
 *             - payment_pay
 *             - payment_refund
 *             - payment_credit_apply
 *             - expense
 *             - return_sale
 *             - return_purchase
 *             - journal_entry
 *             - note_credit
 *             - note_debit
 *             - delivery_note
 *             - stock_transfer
 *             - stock_adjustment
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, posted, confirmed, dispatched, delivered, invoiced, unpaid, partial, paid, cancelled]
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: party_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200:
 *         description: قائمة المستندات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/DocumentItem'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 items:
 *                   - document_type: invoice_sales
 *                     document_id: "550e8400-e29b-41d4-a716-446655440000"
 *                     document_number: "INV-0001"
 *                     document_date: "2026-01-15"
 *                     amount: 5000
 *                     status: paid
 *                     party_name: "شركة النيل"
 *                     journal_entry_id: "660e8400-e29b-41d4-a716-446655440000"
 *                 pagination:
 *                   page: 1
 *                   limit: 50
 *                   total: 245
 *                   pages: 5
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('documents.view'),
  [
    query('document_type').optional().isIn(DOCUMENT_TYPES),
    query('status').optional().isIn(STATUSES),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('party_id').optional().isUUID(),
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════
// GET /documents/stats — إحصائيات
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /documents/stats:
 *   get:
 *     summary: إحصائيات المستندات
 *     description: |
 *       يعيد إحصائيات سريعة (عدد + مبلغ) لكل نوع.
 *       مفيد للوحة التحكم.
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: إحصائيات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     by_type:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type: { type: string }
 *                           count: { type: integer }
 *                           total_amount: { type: number }
 *                     totals:
 *                       type: object
 *                       properties:
 *                         count: { type: integer }
 *                         amount: { type: number }
 *             example:
 *               success: true
 *               data:
 *                 by_type:
 *                   - type: invoice_sales
 *                     count: 15
 *                     total_amount: 45000
 *                   - type: payment_receive
 *                     count: 12
 *                     total_amount: 40000
 *                 totals:
 *                   count: 45
 *                   amount: 120000
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/stats',
  authorize('documents.view'),
  [
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.stats
);

// ═══════════════════════════════════════════════════════════════
// GET /documents/types — قائمة الأنواع
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /documents/types:
 *   get:
 *     summary: قائمة الأنواع والفئات والحالات
 *     description: |
 *       تُستخدم لبناء الفلاتر في الواجهة.
 *
 *       **ترجع:**
 *       - `types`: 15 نوعاً مع الفئة
 *       - `categories`: 8 فئات
 *       - `statuses`: 10 حالات
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: القوائم
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     types:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           value: { type: string }
 *                           label: { type: string }
 *                           category: { type: string }
 *                     categories:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           value: { type: string }
 *                           label: { type: string }
 *                     statuses:
 *                       type: array
 *                       items: { type: string }
 *             example:
 *               success: true
 *               data:
 *                 types:
 *                   - value: invoice_sales
 *                     label: فاتورة بيع
 *                     category: invoices
 *                   - value: note_credit
 *                     label: إشعار دائن
 *                     category: notes
 *                 categories:
 *                   - value: invoices
 *                     label: الفواتير
 *                   - value: notes
 *                     label: الإشعارات
 *                 statuses:
 *                   - draft
 *                   - posted
 *                   - confirmed
 *                   - paid
 *                   - cancelled
 */
router.get(
  '/types',
  authorize('documents.view'),
  ctrl.types
);

module.exports = router;