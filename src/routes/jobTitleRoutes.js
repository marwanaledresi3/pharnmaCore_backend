// routes/jobTitleRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/JobTitleController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /job-titles
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /job-titles:
 *   get:
 *     summary: قائمة المسميات الوظيفية
 *     tags: [JobTitles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: قائمة المسميات
 */
router.get('/', authorize('job_titles.view'), ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /job-titles/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /job-titles/{id}:
 *   get:
 *     summary: تفاصيل مسمى وظيفي
 *     tags: [JobTitles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل المسمى
 *       404:
 *         description: المسمى غير موجود
 */
router.get('/:id', authorize('job_titles.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /job-titles
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /job-titles:
 *   post:
 *     summary: إنشاء مسمى وظيفي
 *     tags: [JobTitles]
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
 *               name:          { type: string, maxLength: 150 }
 *               department_id: { type: string, format: uuid, nullable: true }
 *               description:   { type: string }
 *               is_active:     { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: تم إنشاء المسمى
 *       400:
 *         description: department لا ينتمي للشركة
 */
router.post('/', authorize('job_titles.create'),
  [
    body('name').trim().notEmpty().isLength({ max: 150 }),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('description').optional({ nullable: true }).trim(),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /job-titles/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /job-titles/{id}:
 *   patch:
 *     summary: تعديل مسمى وظيفي
 *     tags: [JobTitles]
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
 *               name:          { type: string, maxLength: 150 }
 *               department_id: { type: string, format: uuid, nullable: true }
 *               description:   { type: string }
 *               is_active:     { type: boolean }
 *     responses:
 *       200:
 *         description: تم التعديل
 *       404:
 *         description: المسمى غير موجود
 */
router.patch('/:id', authorize('job_titles.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('description').optional({ nullable: true }).trim(),
    body('is_active').optional().isBoolean(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /job-titles/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /job-titles/{id}:
 *   delete:
 *     summary: حذف مسمى وظيفي
 *     description: يمنع الحذف إذا كان المسمى مرتبطاً بموظفين.
 *     tags: [JobTitles]
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
 *         description: مرتبط بموظفين
 *       404:
 *         description: المسمى غير موجود
 */
router.delete('/:id', authorize('job_titles.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);

module.exports = router;