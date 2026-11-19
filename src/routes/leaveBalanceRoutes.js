// routes/leaveBalanceRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/LeaveBalanceController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-balances
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances:
 *   get:
 *     summary: قائمة أرصدة الإجازات
 *     tags: [LeaveBalances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employee_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: leave_type_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: year
 *         schema: { type: integer, minimum: 2000, maximum: 2100 }
 *     responses:
 *       200:
 *         description: قائمة الأرصدة
 */
router.get('/', authorize('leave_balances.view'),
  [
    query('employee_id').optional().isUUID(),
    query('leave_type_id').optional().isUUID(),
    query('year').optional().isInt({ min: 2000, max: 2100 }),
  ],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-balances/employee/:employeeId
// ⚠️ يجب أن يأتي قبل /:id لأن Express يطابق بالترتيب
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances/employee/{employeeId}:
 *   get:
 *     summary: كل أرصدة موظف
 *     tags: [LeaveBalances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: أرصدة الموظف
 */
router.get('/employee/:employeeId', authorize('leave_balances.view'),
  [
    param('employeeId').isUUID(),
    query('year').optional().isInt({ min: 2000, max: 2100 }),
  ],
  validate, ctrl.byEmployee);

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-balances/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances/{id}:
 *   get:
 *     summary: تفاصيل رصيد إجازة
 *     tags: [LeaveBalances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل الرصيد
 *       404:
 *         description: غير موجود
 */
router.get('/:id', authorize('leave_balances.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-balances
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances:
 *   post:
 *     summary: إنشاء رصيد إجازة يدوي
 *     description: |
 *       لإنشاء رصيد موظف جديد أو سنة جديدة.
 *       الأفضل استخدام `/leave-balances/reset/:employeeId` لإنشاء كل الأنواع دفعة واحدة.
 *     tags: [LeaveBalances]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employee_id, leave_type_id, year]
 *             properties:
 *               employee_id:    { type: string, format: uuid }
 *               leave_type_id:  { type: string, format: uuid }
 *               year:           { type: integer, minimum: 2000, maximum: 2100 }
 *               entitled_days:  { type: number, minimum: 0, default: 0 }
 *               used_days:      { type: number, minimum: 0, default: 0 }
 *               carried_days:   { type: number, minimum: 0, default: 0 }
 *     responses:
 *       201:
 *         description: تم الإنشاء
 *       400:
 *         description: رصيد موجود مسبقاً
 */
router.post('/', authorize('leave_balances.create'),
  [
    body('employee_id').isUUID(),
    body('leave_type_id').isUUID(),
    body('year').isInt({ min: 2000, max: 2100 }),
    body('entitled_days').optional().isFloat({ min: 0 }),
    body('used_days').optional().isFloat({ min: 0 }),
    body('carried_days').optional().isFloat({ min: 0 }),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /leave-balances/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances/{id}:
 *   patch:
 *     summary: تعديل رصيد (entitled/carried فقط)
 *     description: |
 *       `used_days` **لا يُعدَّل يدوياً** — يُدار تلقائياً عبر trigger
 *       `sync_leave_balance` عند اعتماد/إلغاء طلبات الإجازة.
 *     tags: [LeaveBalances]
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
 *               entitled_days: { type: number, minimum: 0 }
 *               carried_days:  { type: number, minimum: 0 }
 *     responses:
 *       200:
 *         description: تم التعديل
 *       404:
 *         description: غير موجود
 */
router.patch('/:id', authorize('leave_balances.update'),
  [
    param('id').isUUID(),
    body('entitled_days').optional().isFloat({ min: 0 }),
    body('carried_days').optional().isFloat({ min: 0 }),
    body('used_days').custom(() => {
      throw new Error('used_days is managed by trigger sync_leave_balance and cannot be set directly');
    }),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-balances/reset/:employeeId
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances/reset/{employeeId}:
 *   post:
 *     summary: إعادة تعيين أرصدة موظف لسنة جديدة
 *     description: |
 *       - لكل نوع إجازة نشط، يُنشئ رصيداً للسنة المحددة.
 *       - `entitled_days` = `annual_days` من نوع الإجازة.
 *       - `carried_days` = الرصيد المتبقي من السنة السابقة (إن كان النوع يسمح بالترحيل).
 *       - يتخطى الأنواع التي لها رصيد بالفعل.
 *     tags: [LeaveBalances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [year]
 *             properties:
 *               year:       { type: integer, minimum: 2000, maximum: 2100 }
 *               carry_over: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: تم إنشاء الأرصدة
 *       404:
 *         description: الموظف غير موجود
 */
router.post('/reset/:employeeId', authorize('leave_balances.create'),
  [
    param('employeeId').isUUID(),
    body('year').isInt({ min: 2000, max: 2100 }),
    body('carry_over').optional().isBoolean(),
  ],
  validate, ctrl.resetForYear);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /leave-balances/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-balances/{id}:
 *   delete:
 *     summary: حذف رصيد إجازة
 *     description: يمنع الحذف إذا كان له طلبات معتمدة.
 *     tags: [LeaveBalances]
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
 *         description: له طلبات معتمدة
 *       404:
 *         description: غير موجود
 */
router.delete('/:id', authorize('leave_balances.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);

module.exports = router;