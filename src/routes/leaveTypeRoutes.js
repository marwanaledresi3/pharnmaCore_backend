// routes/leaveTypeRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/LeaveTypeController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-types
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-types:
 *   get:
 *     summary: قائمة أنواع الإجازات
 *     tags: [LeaveTypes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_active
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: قائمة الأنواع
 */
router.get('/', authorize('leave_types.view'),
  [query('is_active').optional().isBoolean()],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-types/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-types/{id}:
 *   get:
 *     summary: تفاصيل نوع إجازة
 *     tags: [LeaveTypes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل النوع
 *       404:
 *         description: غير موجود
 */
router.get('/:id', authorize('leave_types.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-types
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-types:
 *   post:
 *     summary: إنشاء نوع إجازة
 *     tags: [LeaveTypes]
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
 *               name:                { type: string, maxLength: 100 }
 *               code:                { type: string, maxLength: 20 }
 *               annual_days:         { type: number, minimum: 0, default: 0 }
 *               is_paid:             { type: boolean, default: true }
 *               requires_approval:   { type: boolean, default: true }
 *               carry_over_allowed:  { type: boolean, default: false }
 *               max_carry_over_days: { type: number, minimum: 0, default: 0 }
 *               is_active:           { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: تم الإنشاء
 *       400:
 *         description: code مكرر
 */
router.post('/', authorize('leave_types.create'),
  [
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('code').optional({ nullable: true }).trim().isLength({ max: 20 }),
    body('annual_days').optional().isFloat({ min: 0 }),
    body('is_paid').optional().isBoolean(),
    body('requires_approval').optional().isBoolean(),
    body('carry_over_allowed').optional().isBoolean(),
    body('max_carry_over_days').optional().isFloat({ min: 0 }),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /leave-types/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-types/{id}:
 *   patch:
 *     summary: تعديل نوع إجازة
 *     tags: [LeaveTypes]
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
 *               name:                { type: string, maxLength: 100 }
 *               code:                { type: string, maxLength: 20 }
 *               annual_days:         { type: number, minimum: 0 }
 *               is_paid:             { type: boolean }
 *               requires_approval:   { type: boolean }
 *               carry_over_allowed:  { type: boolean }
 *               max_carry_over_days: { type: number, minimum: 0 }
 *               is_active:           { type: boolean }
 *     responses:
 *       200:
 *         description: تم التعديل
 *       404:
 *         description: غير موجود
 */
router.patch('/:id', authorize('leave_types.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('code').optional({ nullable: true }).trim().isLength({ max: 20 }),
    body('annual_days').optional().isFloat({ min: 0 }),
    body('is_paid').optional().isBoolean(),
    body('requires_approval').optional().isBoolean(),
    body('carry_over_allowed').optional().isBoolean(),
    body('max_carry_over_days').optional().isFloat({ min: 0 }),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /leave-types/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-types/{id}:
 *   delete:
 *     summary: حذف نوع إجازة
 *     description: يمنع الحذف إذا كان النوع مستخدماً في طلبات أو أرصدة.
 *     tags: [LeaveTypes]
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
 *         description: النوع مستخدم
 *       404:
 *         description: غير موجود
 */
router.delete('/:id', authorize('leave_types.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);

module.exports = router;