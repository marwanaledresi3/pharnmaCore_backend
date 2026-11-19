// routes/departmentRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/DepartmentController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /departments
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /departments:
 *   get:
 *     summary: قائمة الأقسام
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_active
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: قائمة الأقسام
 */
router.get('/', authorize('departments.view'),
  [query('is_active').optional().isBoolean()],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /departments/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /departments/{id}:
 *   get:
 *     summary: تفاصيل قسم
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل القسم
 *       404:
 *         description: القسم غير موجود
 */
router.get('/:id', authorize('departments.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /departments
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /departments:
 *   post:
 *     summary: إنشاء قسم جديد
 *     tags: [Departments]
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
 *               name:       { type: string, maxLength: 150 }
 *               code:       { type: string, maxLength: 30 }
 *               parent_id:  { type: string, format: uuid, nullable: true }
 *               manager_id: { type: string, format: uuid, nullable: true }
 *               is_active:  { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: تم إنشاء القسم
 *       400:
 *         description: بيانات غير صالحة (parent/manager لا ينتمي للشركة)
 */
router.post('/', authorize('departments.create'),
  [
    body('name').trim().notEmpty().isLength({ max: 150 }),
    body('code').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('parent_id').optional({ nullable: true }).isUUID(),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /departments/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /departments/{id}:
 *   patch:
 *     summary: تعديل قسم
 *     tags: [Departments]
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
 *               name:       { type: string, maxLength: 150 }
 *               code:       { type: string, maxLength: 30 }
 *               parent_id:  { type: string, format: uuid, nullable: true }
 *               manager_id: { type: string, format: uuid, nullable: true }
 *               is_active:  { type: boolean }
 *     responses:
 *       200:
 *         description: تم التعديل
 *       400:
 *         description: parent = self أو غير موجود
 *       404:
 *         description: القسم غير موجود
 */
router.patch('/:id', authorize('departments.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }),
    body('code').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('parent_id').optional({ nullable: true }).isUUID(),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /departments/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /departments/{id}:
 *   delete:
 *     summary: حذف قسم
 *     description: |
 *       **يمنع الحذف إذا:**
 *       - يوجد أقسام فرعية.
 *       - يوجد موظفون في القسم.
 *     tags: [Departments]
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
 *         description: يحتوي على أقسام فرعية أو موظفين
 *       404:
 *         description: القسم غير موجود
 */
router.delete('/:id', authorize('departments.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);

module.exports = router;