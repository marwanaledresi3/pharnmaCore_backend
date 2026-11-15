// routes/expenseRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/ExpenseController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const STATUSES = ['draft', 'posted', 'partial', 'paid', 'cancelled'];
const PAYMENT_TYPES = ['cash', 'credit', 'partial'];
const PAYMENT_METHODS = ['cash', 'bank', 'cheque'];
const EXPENSE_CATEGORIES = [
  'rent', 'utilities', 'salaries', 'maintenance', 'transport',
  'marketing', 'office', 'travel', 'insurance', 'tax', 'other',
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /expenses
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /expenses:
 *   get:
 *     summary: قائمة المصروفات
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, posted, partial, paid, cancelled] }
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [rent, utilities, salaries, maintenance, transport, marketing, office, travel, insurance, tax, other]
 *       - in: query
 *         name: supplier_id
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
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: قائمة المصروفات
 */
router.get(
  '/',
  authorize('expenses.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('category').optional().isIn(EXPENSE_CATEGORIES),
    query('supplier_id').optional().isUUID(),
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
// GET /expenses/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /expenses/{id}:
 *   get:
 *     summary: تفاصيل مصروف
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل المصروف
 *       404:
 *         description: المصروف غير موجود
 */
router.get(
  '/:id',
  authorize('expenses.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /expenses
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /expenses:
 *   post:
 *     summary: إنشاء مصروف
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description, amount, expense_account_id, currency_id]
 *             properties:
 *               description:
 *                 type: string
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               expense_account_id:
 *                 type: string
 *                 format: uuid
 *               currency_id:
 *                 type: string
 *                 format: uuid
 *               expense_date:
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
 *               paid_amount:
 *                 type: number
 *                 minimum: 0
 *               due_date:
 *                 type: string
 *                 format: date
 *               supplier_id:
 *                 type: string
 *                 format: uuid
 *               expense_category:
 *                 type: string
 *               external_reference:
 *                 type: string
 *     responses:
 *       201:
 *         description: تم إنشاء المصروف
 */
router.post(
  '/',
  authorize('expenses.create'),
  [
    body('description').isString().trim().notEmpty().withMessage('البيان مطلوب'),
    body('amount').isFloat({ gt: 0 }),
    body('expense_account_id').isUUID(),
    body('currency_id').isUUID(),
    body('expense_date').optional().isISO8601(),
    body('exchange_rate').optional().isFloat({ gt: 0 }),
    body('payment_type').optional().isIn(PAYMENT_TYPES),
    body('payment_method').optional().isIn(PAYMENT_METHODS),
    body('paid_amount').optional().isFloat({ min: 0 }),
    body('paid_amount').custom((value, { req }) => {
      if (req.body.payment_type === 'partial') {
        if (value === undefined || Number(value) <= 0) {
          throw new Error('paid_amount is required for partial payment');
        }
      }
      return true;
    }),
    body('due_date').optional().isISO8601(),
    body('supplier_id').optional().isUUID(),
    body('expense_category').optional().isIn(EXPENSE_CATEGORIES),
    body('external_reference').optional().isString().trim().isLength({ max: 100 }),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /expenses/:id/pay
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /expenses/{id}/pay:
 *   post:
 *     summary: دفع مصروف
 *     description: |
 *       - Dr 211 (ذمم موردين) / Cr 1111 أو 1112 (صندوق/بنك).
 *     tags: [Expenses]
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
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               method:
 *                 type: string
 *                 enum: [cash, bank, cheque]
 *               payment_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: تم الدفع
 *       400:
 *         description: المبلغ يتجاوز المتبقي
 */
router.post(
  '/:id/pay',
  authorize('expenses.update'),
  [
    param('id').isUUID(),
    body('amount').optional().isFloat({ gt: 0 }),
    body('method').optional().isIn(PAYMENT_METHODS),
    body('payment_date').optional().isISO8601(),
  ],
  validate,
  ctrl.pay
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /expenses/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /expenses/{id}/cancel:
 *   post:
 *     summary: إلغاء مصروف
 *     description: |
 *       - draft → إلغاء بسيط
 *       - posted/partial → عكس القيد + القيد العكسي للدفعات
 *     tags: [Expenses]
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
 *         description: المصروف مدفوع بالكامل
 */
router.post(
  '/:id/cancel',
  authorize('expenses.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.cancel
);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /expenses/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /expenses/{id}:
 *   delete:
 *     summary: حذف مصروف (للملغى فقط)
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الحذف
 *       400:
 *         description: المصروف غير ملغى
 */
router.delete(
  '/:id',
  authorize('expenses.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.remove
);

module.exports = router;