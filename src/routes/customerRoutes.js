// routes/customerRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/CustomerController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /customers
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /customers:
 *   get:
 *     summary: قائمة العملاء
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: is_active
 *         schema: { type: boolean }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200:
 *         description: قائمة العملاء
 */
router.get('/', authorize('customers.view'),
  [query('search').optional().trim(),
   query('is_active').optional().isBoolean(),
   query('limit').optional().isInt({ min: 1, max: 200 })],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /customers/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /customers/{id}:
 *   get:
 *     summary: تفاصيل عميل
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل العميل
 *       404:
 *         description: العميل غير موجود
 */
router.get('/:id', authorize('customers.view'), [param('id').isUUID()], validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /customers
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /customers:
 *   post:
 *     summary: إنشاء عميل جديد
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 200
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               tax_number:
 *                 type: string
 *               credit_limit:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       201:
 *         description: تم إنشاء العميل
 *       400:
 *         description: بيانات غير صالحة
 */
router.post('/', authorize('customers.create'),
  [body('name').trim().notEmpty().isLength({ max: 200 }),
   body('email').optional({ nullable: true }).isEmail(),
   body('credit_limit').optional().isFloat({ min: 0 })],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /customers/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /customers/{id}:
 *   patch:
 *     summary: تعديل عميل
 *     tags: [Customers]
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
 *               name: { type: string, maxLength: 200 }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               address: { type: string }
 *               tax_number: { type: string }
 *               credit_limit: { type: number, minimum: 0 }
 *               is_active: { type: boolean }
 *               account_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم التعديل
 */
router.patch('/:id', authorize('customers.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 200 }),
    body('email').optional({ nullable: true }).isEmail(),
    body('phone').optional({ nullable: true }).trim(),
    body('address').optional({ nullable: true }).trim(),
    body('tax_number').optional({ nullable: true }).trim(),
    body('credit_limit').optional().isFloat({ min: 0 }),
    body('is_active').optional().isBoolean(),
    body('account_id').optional({ nullable: true }).isUUID(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /customers/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /customers/{id}:
 *   delete:
 *     summary: حذف عميل
 *     tags: [Customers]
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
 *         description: العميل لديه فواتير
 */
router.delete('/:id', authorize('customers.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;