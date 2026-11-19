// routes/pdfRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/PdfController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { param, query, body } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/invoices/:id — فاتورة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/invoices/{id}:
 *   get:
 *     summary: تحميل فاتورة PDF
 *     description: |
 *       يُولّد PDF لفاتورة (بيع أو شراء).
 *       يحتوي على: رأس الشركة، بيانات الطرف، البنود، المجاميع.
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: الفاتورة غير موجودة
 */
router.get(
  '/invoices/:id',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.invoice
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/returns/:id — مرتجع
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/returns/{id}:
 *   get:
 *     summary: تحميل مرتجع PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: المرتجع غير موجود
 */
router.get(
  '/returns/:id',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.returnDoc
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/payments/:id — سند قبض/صرف
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/payments/{id}:
 *   get:
 *     summary: تحميل سند قبض/صرف PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: الدفعة غير موجودة
 */
router.get(
  '/payments/:id',
  authorize('payments.view'),
  [param('id').isUUID()],
  validate,
  ctrl.payment
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/purchase-orders/:id — أمر شراء
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/purchase-orders/{id}:
 *   get:
 *     summary: تحميل أمر شراء PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/purchase-orders/:id',
  authorize('purchase_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.purchaseOrder
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/sales-orders/:id — أمر بيع
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/sales-orders/{id}:
 *   get:
 *     summary: تحميل أمر بيع PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/sales-orders/:id',
  authorize('sales_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.salesOrder
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/delivery-notes/:id — بوليصة تسليم
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/delivery-notes/{id}:
 *   get:
 *     summary: تحميل بوليصة تسليم PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/delivery-notes/:id',
  authorize('purchase_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.deliveryNote
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/expenses/:id — مصروف
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/expenses/{id}:
 *   get:
 *     summary: تحميل مصروف PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/expenses/:id',
  authorize('expenses.view'),
  [param('id').isUUID()],
  validate,
  ctrl.expense
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/statements/:partyType/:id — كشف حساب
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/statements/{partyType}/{id}:
 *   get:
 *     summary: تحميل كشف حساب PDF
 *     description: |
 *       كشف حساب لعميل أو مورد مع الحركات.
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partyType
 *         required: true
 *         schema: { type: string, enum: [customer, supplier] }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/statements/:partyType/:id',
  authorize('reports.view_financial'),
  [
    param('partyType').isIn(['customer', 'supplier']),
    param('id').isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.statement
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/reports/trial-balance — ميزان مراجعة
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/reports/trial-balance:
 *   get:
 *     summary: تحميل ميزان مراجعة PDF
 *     tags: [PDF]
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
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/reports/trial-balance',
  authorize('reports.view_financial'),
  [
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.trialBalance
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/notes/:id — إشعار دائن/مدين 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/notes/{id}:
 *   get:
 *     summary: تحميل إشعار دائن/مدين PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: الإشعار غير موجود
 */
router.get(
  '/notes/:id',
  authorize('notes.view'),
  [param('id').isUUID()],
  validate,
  ctrl.creditNote
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/goods-receipts/:id — إذن استلام 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/goods-receipts/{id}:
 *   get:
 *     summary: تحميل إذن استلام PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/goods-receipts/:id',
  authorize('goods_receipts.view'),
  [param('id').isUUID()],
  validate,
  ctrl.goodsReceipt
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/stock-transfers/:id — إذن تحويل 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/stock-transfers/{id}:
 *   get:
 *     summary: تحميل إذن تحويل PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/stock-transfers/:id',
  authorize('stock_transfers.view'),
  [param('id').isUUID()],
  validate,
  ctrl.stockTransfer
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/stock-adjustments/:id — تسوية جرد 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/stock-adjustments/{id}:
 *   get:
 *     summary: تحميل تسوية جرد PDF
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get(
  '/stock-adjustments/:id',
  authorize('stock_adjustments.view'),
  [param('id').isUUID()],
  validate,
  ctrl.stockAdjustment
);

// ═══════════════════════════════════════════════════════════════
// POST /pdf/hr/report — تقرير HR 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/hr/report:
 *   post:
 *     summary: تحميل تقرير HR PDF
 *     description: |
 *       يستقبل بيانات التقرير (headers + rows) ويُولّد PDF عربياً.
 *       يُستخدم من صفحة تقارير HR بعد جلب البيانات من endpoints التقارير.
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [headers, rows]
 *             properties:
 *               title: { type: string }
 *               titleEn: { type: string }
 *               subtitle: { type: string }
 *               headers: { type: array, items: { type: string } }
 *               rows: { type: array, items: { type: object } }
 *               summary:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     label: { type: string }
 *                     value: { type: string }
 *                     isTotal: { type: boolean }
 *               notes: { type: string }
 *               currencyCode: { type: string }
 *               landscape: { type: boolean, default: true }
 *               columnTypes:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *                   enum: [arabic, text, number, money, date]
 *               showSignature: { type: boolean }
 *               signatureLeft: { type: string }
 *               signatureRight: { type: string }
 *               filename: { type: string }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       400:
 *         description: بيانات غير صالحة
 */
router.post(
  '/hr/report',
  authorize('reports.export'),
  [
    body('headers').isArray({ min: 1 }),
    body('rows').isArray(),
    body('title').optional().isString().isLength({ max: 200 }),
    body('subtitle').optional().isString().isLength({ max: 200 }),
    body('currencyCode').optional().isString().isLength({ max: 10 }),
    body('landscape').optional().isBoolean(),
    body('showSignature').optional().isBoolean(),
  ],
  validate,
  ctrl.hrReport
);


// ═══════════════════════════════════════════════════════════════
// GET /pdf/payslips/:itemId — قسيمة راتب موظف 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/payslips/{itemId}:
 *   get:
 *     summary: تحميل قسيمة راتب PDF
 *     description: |
 *       قسيمة راتب موظف فردي (A5 portrait).
 *       تشمل: بيانات الموظف، الفترة، الإيرادات، الخصومات، الصافي.
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: البند غير موجود
 */
router.get(
  '/payslips/:itemId',
  authorize('payroll.view'),
  [param('itemId').isUUID()],
  validate,
  ctrl.payslip
);

// ═══════════════════════════════════════════════════════════════
// GET /pdf/payroll/:runId — تقرير مسير رواتب 🆕
// ═══════════════════════════════════════════════════════════════
/**
 * @swagger
 * /pdf/payroll/{runId}:
 *   get:
 *     summary: تحميل تقرير مسير رواتب كامل PDF
 *     description: |
 *       تقرير A4 landscape يشمل كل الموظفين في المسير.
 *       خيار `includeDetails=true` يُظهر تفصيل البدلات والخصومات.
 *     tags: [PDF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: includeDetails
 *         schema: { type: string, enum: ['true', 'false'], default: 'false' }
 *     responses:
 *       200:
 *         description: ملف PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404:
 *         description: المسير غير موجود
 */
router.get(
  '/payroll/:runId',
  authorize('payroll.view'),
  [
    param('runId').isUUID(),
    query('includeDetails').optional().isIn(['true', 'false']),
  ],
  validate,
  ctrl.payrollReport
);
module.exports = router;