// routes/payrollRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/PayrollController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);


// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll:
 *   get:
 *     summary: قائمة مسيرات الرواتب
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, approved, paid, cancelled] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة المسيرات
 */
router.get('/', authorize('payroll.view'),
  [
    query('status').optional().isIn(['draft', 'approved', 'paid', 'cancelled']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate, ctrl.list);


  // ⬇️ يجب أن تأتي قبل /:id
router.get('/my-payslips', authorize('payroll.view'),
  ctrl.myPayslips);

router.get('/my-payslips/:itemId', authorize('payroll.view'),
  [param('itemId').isUUID()],
  validate, ctrl.myPayslipDetail);

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{id}:
 *   get:
 *     summary: تفاصيل مسير رواتب
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: المسير + بنوده
 *       404:
 *         description: غير موجود
 */
router.get('/:id', authorize('payroll.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /payroll — حساب مسير جديد
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll:
 *   post:
 *     summary: حساب مسير رواتب (draft)
 *     description: |
 *       **التحققات:**
 *       - لا يوجد مسير آخر لنفس الشهر.
 *       - يوجد موظفون نشطون.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [year, month, payment_date]
 *             properties:
 *               year:         { type: integer, minimum: 2000, maximum: 2100 }
 *               month:        { type: integer, minimum: 1, maximum: 12 }
 *               payment_date: { type: string, format: date }
 *     responses:
 *       201:
 *         description: المسير محسوب
 *       400:
 *         description: بيانات غير صالحة أو تكرار
 */
router.post('/', authorize('payroll.create'),
  [
    body('year').isInt({ min: 2000, max: 2100 }),
    body('month').isInt({ min: 1, max: 12 }),
    body('payment_date').isISO8601(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// POST /payroll/:id/post — ترحيل (قيد محاسبي)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{id}/post:
 *   post:
 *     summary: ترحيل مسير الرواتب (إنشاء قيد محاسبي)
 *     description: |
 *       **القيود المُنشأة:**
 *       - Dr 512 (رواتب) / Dr 5240 (تأمينات الشركة)
 *       - Cr 2130 (صافي) / Cr 2131 (تأمينات) / Cr 2132 (ضريبة)
 *     tags: [Payroll]
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
 *         description: مرحّل مسبقاً أو ملغى أو حسابات مفقودة
 */
router.post('/:id/post', authorize('payroll.post'),
  [param('id').isUUID()],
  validate, ctrl.post);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /payroll/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{id}:
 *   delete:
 *     summary: حذف مسير (draft فقط)
 *     tags: [Payroll]
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
 *       404:
 *         description: غير موجود أو غير draft
 */
router.delete('/:id', authorize('payroll.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);


  // ═══════════════════════════════════════════════════════════════════════════
// Mount: /payroll/:runId/items → payrollItemRoutes
// ⚠️ يجب أن يكون آخر شيء — لا يعترض المسارات الأخرى
// ═══════════════════════════════════════════════════════════════════════════
router.use('/:runId/items', require('./payrollItemRoutes'));


module.exports = router;