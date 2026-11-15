// routes/paymentRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/PaymentController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const PAYMENT_METHODS = ['cash', 'bank', 'cheque'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /payments — قائمة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payments:
 *   get:
 *     summary: قائمة المدفوعات
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: invoice_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: payment_type
 *         schema:
 *           type: string
 *           enum: [receive, pay, refund, credit_apply]
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المدفوعات
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
 *                           voucher_number: { type: string }
 *                           payment_type: { type: string }
 *                           amount: { type: number }
 *                           payment_date: { type: string, format: date }
 *                           method: { type: string }
 *                           party_name: { type: string, nullable: true }
 *                           invoice_number: { type: string, nullable: true }
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('payments.view'),
  [
    query('invoice_id').optional().isUUID(),
    query('payment_type').optional().isIn(['receive', 'pay', 'refund', 'credit_apply']),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /payments — إنشاء دفعة (فاتورة أو سند يدوي)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payments:
 *   post:
 *     summary: إنشاء دفعة (فاتورة أو سند يدوي)
 *     description: |
 *       **المنطق في الـ controller:**
 *       - بدون `invoice_id` → `createManualPayment`
 *         (يتطلب `payment_type` + `description` + طرف)
 *       - `invoice_id` + `payment_type='pay'` → `createForPurchaseInvoice`
 *       - `invoice_id` + `payment_type='receive'` → `createForInvoice`
 *
 *       **التحقق:**
 *       - `payment_type` مطلوب فقط عند وجود `invoice_id`.
 *       - `description` مطلوب للسندات اليدوية.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               invoice_id:
 *                 type: string
 *                 format: uuid
 *               supplier_id:
 *                 type: string
 *                 format: uuid
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               payment_type:
 *                 type: string
 *                 enum: [receive, pay]
 *               payment_date:
 *                 type: string
 *                 format: date
 *               method:
 *                 type: string
 *                 enum: [cash, bank, cheque]
 *               reference:
 *                 type: string
 *               external_reference:
 *                 type: string
 *               description:
 *                 type: string
 *               cash_account_id:
 *                 type: string
 *                 format: uuid
 *           examples:
 *             with_invoice:
 *               summary: دفعة على فاتورة
 *               value:
 *                 invoice_id: "550e8400-e29b-41d4-a716-446655440000"
 *                 payment_type: receive
 *                 amount: 500
 *                 method: cash
 *             manual:
 *               summary: سند يدوي
 *               value:
 *                 customer_id: "550e8400-e29b-41d4-a716-446655440000"
 *                 payment_type: receive
 *                 amount: 300
 *                 method: bank
 *                 description: "دفعة مقدمة"
 *     responses:
 *       201:
 *         description: تم إنشاء الدفعة
 *       400:
 *         description: |
 *           - بيانات ناقصة
 *           - المبلغ يتجاوز المتبقي
 *       404:
 *         description: الفاتورة/الطرف غير موجود
 */
router.post(
  '/',
  authorize('payments.create'),
  [
    body('invoice_id').optional().isUUID(),
    body('supplier_id').optional().isUUID(),
    body('customer_id').optional().isUUID(),

    body('amount').isFloat({ gt: 0 }),

    body('payment_type')
      .optional()
      .isIn(['receive', 'pay'])
      .custom((value, { req }) => {
        if (req.body.invoice_id && !value) {
          throw new Error('payment_type is required when invoice_id is provided');
        }
        return true;
      }),

    body('payment_date').optional().isISO8601(),
    body('method').optional().isIn(PAYMENT_METHODS),
    body('reference').optional().isString().trim().isLength({ max: 200 }),
    body('external_reference').optional().isString().trim().isLength({ max: 200 }),
    body('description').optional().isString().trim().isLength({ max: 500 }),
    body('cash_account_id').optional().isUUID(),
  ],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /payments/:id — حذف
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payments/{id}:
 *   delete:
 *     summary: حذف دفعة (مع عكس القيد)
 *     description: |
 *       - يرفض لو الدفعة لها refunds.
 *       - يُنشئ قيداً عكسياً.
 *       - يُحدّث `paid_amount` للفاتورة.
 *     tags: [Payments]
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
 *         description: الدفعة لها refunds
 *       404:
 *         description: الدفعة غير موجودة
 */
router.delete(
  '/:id',
  authorize('payments.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.remove
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /payments/refund — استرداد لعميل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payments/refund:
 *   post:
 *     summary: استرداد نقدي لعميل
 *     description: |
 *       **القيد:**
 *       - Dr 112 (ذمم عملاء) / Cr 1111 (صندوق)
 *
 *       **التحقق:**
 *       - المبلغ ≤ رصيد العميل الدائن.
 *       - المبلغ ≤ المتبقي من المرتجع (إن وُجد).
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, amount]
 *             properties:
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               return_id:
 *                 type: string
 *                 format: uuid
 *               payment_date:
 *                 type: string
 *                 format: date
 *               method:
 *                 type: string
 *                 enum: [cash, bank, cheque]
 *               cash_account_id:
 *                 type: string
 *                 format: uuid
 *               reference:
 *                 type: string
 *     responses:
 *       201:
 *         description: تم الاسترداد
 *       400:
 *         description: |
 *           - المبلغ يتجاوز رصيد العميل
 *           - المبلغ يتجاوز المتبقي من المرتجع
 */
router.post(
  '/refund',
  authorize('payments.create'),
  [
    body('customer_id').isUUID(),
    body('amount').isFloat({ gt: 0 }),
    body('return_id').optional().isUUID(),
    body('payment_date').optional().isISO8601(),
    body('method').optional().isIn(PAYMENT_METHODS),
    body('cash_account_id').optional().isUUID(),
    body('reference').optional().isString().trim().isLength({ max: 200 }),
  ],
  validate,
  ctrl.refundToCustomer
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /payments/apply-credit — تخصيص رصيد لفاتورة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payments/apply-credit:
 *   post:
 *     summary: تخصيص رصيد دائن لفاتورة
 *     description: |
 *       **القيد (صافي صفر للتتبع):**
 *       - Dr 112 / Cr 112 (نفس الحساب)
 *
 *       **التحقق:**
 *       - المبلغ ≤ المتبقي من الفاتورة.
 *       - المبلغ ≤ رصيد العميل الدائن.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoice_id, amount]
 *             properties:
 *               invoice_id:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *     responses:
 *       201:
 *         description: تم التخصيص
 *       400:
 *         description: |
 *           - المبلغ يتجاوز المتبقي من الفاتورة
 *           - المبلغ يتجاوز رصيد العميل
 */
router.post(
  '/apply-credit',
  authorize('payments.create'),
  [
    body('invoice_id').isUUID(),
    body('amount').isFloat({ gt: 0 }),
  ],
  validate,
  ctrl.applyCredit
);

module.exports = router;