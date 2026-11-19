// routes/settingsRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/settingsController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /settings
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings:
 *   get:
 *     summary: جميع إعدادات الشركة
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: كائن الإعدادات (key-value)
 */
router.get('/', authorize('settings.view'), ctrl.getAll);

// ═══════════════════════════════════════════════════════════════════════════
// GET /settings/hr-jobs-status — 🆕
// ⚠️ يجب أن يأتي قبل /:key
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings/hr-jobs-status:
 *   get:
 *     summary: حالة مهام HR (leaveBalanceResetJob)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: حالة الجدولة والتشغيل القادم
 */
router.get('/hr-jobs-status', authorize('settings.view'), ctrl.hrJobsStatus);

// ═══════════════════════════════════════════════════════════════════════════
// POST /settings/reload-hr-jobs — 🆕
// ⚠️ يجب أن يأتي قبل /:key
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings/reload-hr-jobs:
 *   post:
 *     summary: إعادة تحميل مهام HR بعد تغيير الإعدادات
 *     description: |
 *       يستخدم عند تغيير أي إعداد من `hr_leave_balance_*`
 *       لإعادة جدولة الـ job دون إعادة تشغيل التطبيق.
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: تم إعادة التحميل
 *       500:
 *         description: فشل إعادة التحميل
 */
router.post('/reload-hr-jobs', authorize('settings.update'), ctrl.reloadHrJobs);

// ═══════════════════════════════════════════════════════════════════════════
// GET /settings/:key
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings/{key}:
 *   get:
 *     summary: إعداد واحد
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: الإعداد
 *       404:
 *         description: غير موجود
 */
router.get(
  '/:key',
  authorize('settings.view'),
  [param('key').isString().notEmpty()],
  validate,
  ctrl.getOne
);

// ═══════════════════════════════════════════════════════════════════════════
// PUT /settings/:key
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings/{key}:
 *   put:
 *     summary: تحديث إعداد واحد
 *     description: |
 *       إذا كان المفتاح يبدأ بـ `hr_leave_balance_`،
 *       يُعاد تحميل jobs تلقائياً بعد الحفظ.
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: {}
 *     responses:
 *       200:
 *         description: تم التحديث
 */
router.put(
  '/:key',
  authorize('settings.update'),
  [
    param('key').isString().notEmpty(),
    body('value').exists(),
  ],
  validate,
  ctrl.updateOne
);

// ═══════════════════════════════════════════════════════════════════════════
// PUT /settings — تحديث دفعة واحدة
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings:
 *   put:
 *     summary: تحديث مجموعة إعدادات دفعة واحدة
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [settings]
 *             properties:
 *               settings:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: تم التحديث
 */
router.put(
  '/',
  authorize('settings.update'),
  [body('settings').isObject()],
  validate,
  ctrl.updateMany
);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /settings/:key
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /settings/{key}:
 *   delete:
 *     summary: حذف إعداد
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: تم الحذف
 *       404:
 *         description: غير موجود
 */
router.delete(
  '/:key',
  authorize('settings.update'),
  [param('key').isString().notEmpty()],
  validate,
  ctrl.remove
);

module.exports = router;