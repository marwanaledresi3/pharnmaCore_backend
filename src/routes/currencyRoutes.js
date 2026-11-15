// routes/currencyRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/CurrencyController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════════════
// GET /currencies — قائمة العملات (متاح لأي مستخدم مسجل)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /currencies:
 *   get:
 *     summary: قائمة العملات
 *     description: |
 *       متاح لأي مستخدم مسجل (بدون requireCompany).
 *       مفيد لاختيار العملة قبل إعداد الشركة.
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: قائمة العملات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       code: { type: string, example: YER }
 *                       name: { type: string, example: ريال يمني }
 *                       symbol: { type: string, example: ﷼ }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', ctrl.list);

router.use(requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// POST /currencies/convert — تحويل عملة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /currencies/convert:
 *   post:
 *     summary: تحويل مبلغ بين العملات
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, currency_id]
 *             properties:
 *               amount:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               currency_id:
 *                 type: string
 *                 format: uuid
 *               as_of_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: المبلغ بعد التحويل
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     original_amount: { type: number }
 *                     converted_amount: { type: number }
 *                     rate: { type: number }
 *                     currency_code: { type: string }
 *       400:
 *         description: |
 *           - المبلغ غير صالح
 *           - العملة غير موجودة
 *           - لا يوجد سعر صرف
 */
router.post('/convert', authorize('currencies.view'),
  [
    body('amount').isFloat({ gt: 0 }),
    body('currency_id').isUUID(),
    body('as_of_date').optional().isISO8601(),
  ],
  validate, ctrl.convert);

// ═══════════════════════════════════════════════════════════════════════════
// POST /currencies — إنشاء عملة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /currencies:
 *   post:
 *     summary: إضافة عملة جديدة
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 3
 *                 example: USD
 *               name:
 *                 type: string
 *                 example: دولار أمريكي
 *               symbol:
 *                 type: string
 *                 example: $
 *     responses:
 *       201:
 *         description: تم إنشاء العملة
 *       409:
 *         description: كود العملة موجود مسبقاً
 */
router.post('/', authorize('currencies.create'),
  [
    body('code').trim().isLength({ min: 3, max: 3 }).toUpperCase(),
    body('name').trim().notEmpty(),
    body('symbol').optional().trim(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /currencies/:id — تعديل عملة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /currencies/{id}:
 *   patch:
 *     summary: تعديل عملة
 *     tags: [Currencies]
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
 *               name:
 *                 type: string
 *               symbol:
 *                 type: string
 *     responses:
 *       200:
 *         description: تم التعديل
 *       404:
 *         description: العملة غير موجودة
 */
router.patch('/:id', authorize('currencies.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('symbol').optional().trim(),
  ],
  validate, ctrl.update);

module.exports = router;