// routes/journalEntryRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/JournalEntryController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

// ✅ استيراد من المودل (مصدر واحد للحقيقة)
const { VALID_SOURCE_TYPES } = require('../models/JournalEntry');

router.use(authenticate, requireCompany);

const STATUSES = ['draft', 'posted'];

const linesValidator = [
  body('entry_date').isISO8601(),
  body('description').optional().isString().trim().isLength({ max: 1000 }),
  body('source_type').optional().isIn(VALID_SOURCE_TYPES),
  body('source_id').optional({ nullable: true }).isUUID(),

  body('lines').isArray({ min: 2 }).withMessage('At least 2 lines are required'),
  body('lines.*.account_id').isUUID(),
  body('lines.*.debit').optional().isFloat({ min: 0 }),
  body('lines.*.credit').optional().isFloat({ min: 0 }),
  body('lines.*.description').optional().isString().trim().isLength({ max: 500 }),

  body('lines').custom((lines) => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const d = Number(l.debit || 0);
      const c = Number(l.credit || 0);
      if (d > 0 && c > 0) {
        throw new Error(`lines[${i}]: cannot have both debit and credit`);
      }
      if (d === 0 && c === 0) {
        throw new Error(`lines[${i}]: must have debit or credit > 0`);
      }
    }
    return true;
  }),
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /journal-entries — قائمة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries:
 *   get:
 *     summary: قائمة القيود اليومية
 *     tags: [JournalEntries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, posted] }
 *       - in: query
 *         name: source_type
 *         schema:
 *           type: string
 *           enum:
 *             - sales
 *             - purchase
 *             - payment
 *             - expense
 *             - sale_return
 *             - purchase_return
 *             - manual
 *             - adjustment
 *             - sales_invoice
 *             - sale_cogs
 *             - purchase_payment
 *             - sales_payment
 *             - purchase_invoice
 *             - goods_receipt
 *             - credit_note
 *             - debit_note
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
 *         description: قائمة القيود
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
 *                           entry_number: { type: integer }
 *                           entry_date: { type: string, format: date }
 *                           description: { type: string }
 *                           source_type: { type: string }
 *                           status: { type: string }
 *                           total_debit: { type: number }
 *                           total_credit: { type: number }
 *                           lines_count: { type: integer }
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authorize('journal_entries.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('source_type').optional().isIn(VALID_SOURCE_TYPES),
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
// GET /journal-entries/trial-balance — ميزان مراجعة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries/trial-balance:
 *   get:
 *     summary: ميزان المراجعة
 *     tags: [JournalEntries]
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
 *         name: include_zero_balances
 *         schema: { type: string, enum: ['true', 'false'], default: 'false' }
 *     responses:
 *       200:
 *         description: ميزان المراجعة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accounts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           account_id: { type: string, format: uuid }
 *                           code: { type: string }
 *                           name: { type: string }
 *                           account_type: { type: string }
 *                           total_debit: { type: number }
 *                           total_credit: { type: number }
 *                           balance: { type: number }
 *                     totals:
 *                       type: object
 *                       properties:
 *                         total_debit: { type: number }
 *                         total_credit: { type: number }
 *                     balanced: { type: boolean }
 */
router.get(
  '/trial-balance',
  authorize('journal_entries.view'),
  [
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('include_zero_balances').optional().isIn(['true', 'false']),
  ],
  validate,
  ctrl.trialBalance
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /journal-entries/:id — تفاصيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries/{id}:
 *   get:
 *     summary: تفاصيل قيد
 *     tags: [JournalEntries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل القيد + السطور
 *       404:
 *         description: القيد غير موجود
 */
router.get(
  '/:id',
  authorize('journal_entries.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /journal-entries — إنشاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries:
 *   post:
 *     summary: إنشاء قيد يدوي (مسودة)
 *     description: |
 *       **التحققات:**
 *       - 2 سطر على الأقل.
 *       - متوازن (`sum(debit) = sum(credit)`).
 *       - كل حساب موجود + نشط + postable.
 *       - `source_type` صالح (إن وُجد).
 *     tags: [JournalEntries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entry_date, lines]
 *             properties:
 *               entry_date:
 *                 type: string
 *                 format: date
 *               description:
 *                 type: string
 *               source_type:
 *                 type: string
 *                 enum:
 *                   - sales
 *                   - purchase
 *                   - payment
 *                   - expense
 *                   - sale_return
 *                   - purchase_return
 *                   - manual
 *                   - adjustment
 *                   - sales_invoice
 *                   - sale_cogs
 *                   - purchase_payment
 *                   - sales_payment
 *                   - purchase_invoice
 *                   - goods_receipt
 *                   - credit_note
 *                   - debit_note
 *               lines:
 *                 type: array
 *                 minItems: 2
 *                 items:
 *                   type: object
 *                   required: [account_id]
 *                   properties:
 *                     account_id:
 *                       type: string
 *                       format: uuid
 *                     debit:
 *                       type: number
 *                       minimum: 0
 *                     credit:
 *                       type: number
 *                       minimum: 0
 *                     description:
 *                       type: string
 *           examples:
 *             balanced:
 *               summary: قيد متوازن
 *               value:
 *                 entry_date: "2026-01-15"
 *                 description: "قيد تسوية يدوي"
 *                 source_type: manual
 *                 lines:
 *                   - account_id: "550e8400-e29b-41d4-a716-446655440000"
 *                     debit: 1000
 *                     credit: 0
 *                   - account_id: "660e8400-e29b-41d4-a716-446655440000"
 *                     debit: 0
 *                     credit: 1000
 *     responses:
 *       201:
 *         description: تم إنشاء القيد
 *       400:
 *         description: |
 *           - أقل من 2 سطر
 *           - غير متوازن
 *           - حساب غير نشط
 */
router.post(
  '/',
  authorize('journal_entries.create'),
  linesValidator,
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /journal-entries/:id — تعديل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries/{id}:
 *   patch:
 *     summary: تعديل قيد (draft فقط)
 *     tags: [JournalEntries]
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
 *               entry_date:
 *                 type: string
 *                 format: date
 *               description:
 *                 type: string
 *               lines:
 *                 type: array
 *                 minItems: 2
 *                 items:
 *                   type: object
 *                   properties:
 *                     account_id:
 *                       type: string
 *                       format: uuid
 *                     debit:
 *                       type: number
 *                     credit:
 *                       type: number
 *     responses:
 *       200:
 *         description: تم التعديل
 *       400:
 *         description: |
 *           - القيد مرحّل
 *           - بيانات غير صالحة
 *       404:
 *         description: القيد غير موجود
 */
router.patch(
  '/:id',
  authorize('journal_entries.update'),
  [
    param('id').isUUID(),
    body('entry_date').optional().isISO8601(),
    body('description').optional().isString().trim().isLength({ max: 1000 }),
    body('lines').optional().isArray({ min: 2 }),
    body('lines.*.account_id').if(body('lines').exists()).isUUID(),
    body('lines.*.debit').if(body('lines').exists()).optional().isFloat({ min: 0 }),
    body('lines.*.credit').if(body('lines').exists()).optional().isFloat({ min: 0 }),
    body('lines.*.description').if(body('lines').exists()).optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.update
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /journal-entries/:id/post — ترحيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries/{id}/post:
 *   post:
 *     summary: ترحيل القيد
 *     description: |
 *       **التحققات:**
 *       - 2 سطر على الأقل.
 *       - متوازن.
 *       - source_type صالح (إن وُجد).
 *     tags: [JournalEntries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الترحيل
 *       400:
 *         description: |
 *           - القيد ليس draft
 *           - غير متوازن
 *           - source_type غير صالح
 */
router.post(
  '/:id/post',
  authorize('journal_entries.post'),
  [param('id').isUUID()],
  validate,
  ctrl.post
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /journal-entries/:id/unpost — إلغاء الترحيل
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries/{id}/unpost:
 *   post:
 *     summary: إلغاء ترحيل القيد
 *     tags: [JournalEntries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم إلغاء الترحيل
 *       400:
 *         description: القيد ليس مرحّلاً
 */
router.post(
  '/:id/unpost',
  authorize('journal_entries.unpost'),
  [param('id').isUUID()],
  validate,
  ctrl.unpost
);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /journal-entries/:id — حذف
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /journal-entries/{id}:
 *   delete:
 *     summary: حذف قيد (draft فقط)
 *     tags: [JournalEntries]
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
 *         description: القيد مرحّل (لا يمكن حذفه)
 *       404:
 *         description: القيد غير موجود
 */
router.delete(
  '/:id',
  authorize('journal_entries.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.remove
);

module.exports = router;