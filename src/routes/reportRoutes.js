// routes/reportRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/ReportController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { query } = require('express-validator');

router.use(authenticate, requireCompany);

const dateRange = [
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/dashboard — لوحة التحكم
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/dashboard:
 *   get:
 *     summary: بيانات لوحة التحكم
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: بيانات اللوحة
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/dashboard', ctrl.dashboard);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/trial-balance — ميزان المراجعة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/trial-balance:
 *   get:
 *     summary: ميزان المراجعة
 *     tags: [Reports]
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
 *         description: ميزان المراجعة
 */
router.get(
  '/trial-balance',
  authorize('reports.view_financial'),
  dateRange,
  validate,
  ctrl.trialBalance
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/balance-sheet — الميزانية العمومية
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/balance-sheet:
 *   get:
 *     summary: الميزانية العمومية
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: الميزانية
 */
router.get(
  '/balance-sheet',
  authorize('reports.view_financial'),
  [query('date_to').optional().isISO8601()],
  validate,
  ctrl.balanceSheet
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/income-statement — قائمة الدخل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/income-statement:
 *   get:
 *     summary: قائمة الدخل
 *     tags: [Reports]
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
 *         description: قائمة الدخل
 */
router.get(
  '/income-statement',
  authorize('reports.view_financial'),
  dateRange,
  validate,
  ctrl.incomeStatement
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/general-ledger — دفتر الأستاذ
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/general-ledger:
 *   get:
 *     summary: دفتر الأستاذ العام
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: account_type
 *         schema:
 *           type: string
 *           enum: [asset, liability, equity, revenue, expense]
 *     responses:
 *       200:
 *         description: دفتر الأستاذ
 */
router.get(
  '/general-ledger',
  authorize('reports.view_financial'),
  [
    ...dateRange,
    query('account_type').optional().isIn(['asset', 'liability', 'equity', 'revenue', 'expense']),
  ],
  validate,
  ctrl.generalLedger
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/tax-summary — ملخص الضرائب
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/tax-summary:
 *   get:
 *     summary: ملخص الضرائب
 *     tags: [Reports]
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
 *         description: ملخص الضرائب
 */
router.get(
  '/tax-summary',
  authorize('reports.view_financial'),
  dateRange,
  validate,
  ctrl.taxSummary
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/ar-aging — أعمار الذمم المدينة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/ar-aging:
 *   get:
 *     summary: تقرير أعمار الذمم المدينة (AR Aging)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: as_of_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: تقرير AR Aging
 */
router.get(
  '/ar-aging',
  authorize('reports.view_financial'),
  [query('as_of_date').optional().isISO8601()],
  validate,
  ctrl.arAging
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/ap-aging — أعمار الذمم الدائنة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/ap-aging:
 *   get:
 *     summary: تقرير أعمار الذمم الدائنة (AP Aging)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: as_of_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: تقرير AP Aging
 */
router.get(
  '/ap-aging',
  authorize('reports.view_financial'),
  [query('as_of_date').optional().isISO8601()],
  validate,
  ctrl.apAging
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/sales — تقرير المبيعات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/sales:
 *   get:
 *     summary: تقرير المبيعات
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: group_by
 *         schema: { type: string, enum: [day, month, year] }
 *     responses:
 *       200:
 *         description: تقرير المبيعات
 */
router.get(
  '/sales',
  authorize('reports.view_sales'),
  [
    ...dateRange,
    query('group_by').optional().isIn(['day', 'month', 'year']),
  ],
  validate,
  ctrl.salesReport
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/top-products — أفضل المنتجات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/top-products:
 *   get:
 *     summary: أفضل المنتجات مبيعاً
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *     responses:
 *       200:
 *         description: أفضل المنتجات
 */
router.get(
  '/top-products',
  authorize('reports.view_sales'),
  [
    ...dateRange,
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.topProducts
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/purchases — تقرير المشتريات
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/purchases:
 *   get:
 *     summary: تقرير المشتريات
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: group_by
 *         schema: { type: string, enum: [day, month, year] }
 *     responses:
 *       200:
 *         description: تقرير المشتريات
 */
router.get(
  '/purchases',
  authorize('reports.view_purchases'),
  [
    ...dateRange,
    query('group_by').optional().isIn(['day', 'month', 'year']),
  ],
  validate,
  ctrl.purchasesReport
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /reports/inventory — تقرير المخزون
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /reports/inventory:
 *   get:
 *     summary: تقرير المخزون
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: warehouse_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تقرير المخزون
 */
router.get(
  '/inventory',
  authorize('reports.view_inventory'),
  [query('warehouse_id').optional().isUUID()],
  validate,
  ctrl.inventoryReport
);

module.exports = router;