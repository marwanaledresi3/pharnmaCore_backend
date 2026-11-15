// routes/warehouseRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/WarehouseController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /warehouses
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /warehouses:
 *   get:
 *     summary: قائمة المستودعات
 *     tags: [Warehouses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: قائمة المستودعات
 */
router.get('/', authorize('warehouses.view'), ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /warehouses/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /warehouses/{id}:
 *   get:
 *     summary: تفاصيل مستودع
 *     tags: [Warehouses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل المستودع
 *       404:
 *         description: المستودع غير موجود
 */
router.get('/:id', authorize('warehouses.view'), [param('id').isUUID()], validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /warehouses
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /warehouses:
 *   post:
 *     summary: إنشاء مستودع
 *     tags: [Warehouses]
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
 *                 maxLength: 150
 *               code:
 *                 type: string
 *               location:
 *                 type: string
 *               manager:
 *                 type: string
 *               phone:
 *                 type: string
 *               is_default:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: تم إنشاء المستودع
 */
router.post(
  '/',
  authorize('warehouses.create'),
  [body('name').trim().notEmpty().isLength({ max: 150 })],
  validate,
  ctrl.create
);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /warehouses/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /warehouses/{id}:
 *   patch:
 *     summary: تعديل مستودع
 *     tags: [Warehouses]
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
 *               name: { type: string, maxLength: 150 }
 *               location: { type: string }
 *               is_active: { type: boolean }
 *     responses:
 *       200:
 *         description: تم التعديل
 */
router.patch('/:id', authorize('warehouses.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }),
    body('location').optional({ nullable: true }).trim(),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /warehouses/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /warehouses/{id}:
 *   delete:
 *     summary: حذف مستودع
 *     tags: [Warehouses]
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
 *         description: المستودع لديه مخزون
 */
router.delete('/:id', authorize('warehouses.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;