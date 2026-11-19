// routes/leaveRequestRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/LeaveRequestController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-requests
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests:
 *   get:
 *     summary: قائمة طلبات الإجازة
 *     tags: [LeaveRequests]
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
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, cancelled] }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة الطلبات
 */
router.get('/', authorize('leave_requests.view'),
  [
    query('employee_id').optional().isUUID(),
    query('leave_type_id').optional().isUUID(),
    query('status').optional().isIn(STATUSES),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /leave-requests/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests/{id}:
 *   get:
 *     summary: تفاصيل طلب إجازة
 *     tags: [LeaveRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل الطلب
 *       404:
 *         description: غير موجود
 */
router.get('/:id', authorize('leave_requests.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests — إنشاء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests:
 *   post:
 *     summary: إنشاء طلب إجازة
 *     description: |
 *       **التحققات:**
 *       - الموظف موجود وغير terminated/resigned.
 *       - نوع الإجازة نشط.
 *       - `end_date >= start_date`.
 *       - لا يوجد تداخل مع طلب آخر (pending/approved) لنفس الفترة.
 *       - `days_count` يُحسب تلقائياً.
 *     tags: [LeaveRequests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employee_id, leave_type_id, start_date, end_date]
 *             properties:
 *               employee_id:   { type: string, format: uuid }
 *               leave_type_id: { type: string, format: uuid }
 *               start_date:    { type: string, format: date }
 *               end_date:      { type: string, format: date }
 *               reason:        { type: string }
 *     responses:
 *       201:
 *         description: تم الإنشاء
 *       400:
 *         description: تداخل أو تواريخ خاطئة
 */
router.post('/', authorize('leave_requests.create'),
  [
    body('employee_id').isUUID(),
    body('leave_type_id').isUUID(),
    body('start_date').isISO8601(),
    body('end_date').isISO8601(),
    body('reason').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests/:id/approve
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests/{id}/approve:
 *   post:
 *     summary: اعتماد طلب إجازة
 *     description: |
 *       - الطلب يجب أن يكون `pending`.
 *       - trigger `sync_leave_balance` يُحدّث `leave_balances.used_days` تلقائياً.
 *     tags: [LeaveRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الاعتماد
 *       400:
 *         description: الطلب ليس pending
 */
router.post('/:id/approve', authorize('leave_requests.approve'),
  [param('id').isUUID()],
  validate, ctrl.approve);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests/:id/reject
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests/{id}/reject:
 *   post:
 *     summary: رفض طلب إجازة
 *     tags: [LeaveRequests]
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
 *               rejection_reason: { type: string }
 *     responses:
 *       200:
 *         description: تم الرفض
 *       400:
 *         description: الطلب ليس pending
 */
router.post('/:id/reject', authorize('leave_requests.reject'),
  [
    param('id').isUUID(),
    body('rejection_reason').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.reject);

// ═══════════════════════════════════════════════════════════════════════════
// POST /leave-requests/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests/{id}/cancel:
 *   post:
 *     summary: إلغاء طلب إجازة
 *     description: |
 *       - `pending` → `cancelled` (بدون تعديل الرصيد).
 *       - `approved` → `cancelled` (trigger يرجع `used_days`).
 *     tags: [LeaveRequests]
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
 *               cancel_reason: { type: string }
 *     responses:
 *       200:
 *         description: تم الإلغاء
 *       400:
 *         description: الطلب في حالة لا تسمح بالإلغاء
 */
router.post('/:id/cancel', authorize('leave_requests.cancel'),
  [
    param('id').isUUID(),
    body('cancel_reason').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.cancel);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /leave-requests/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /leave-requests/{id}:
 *   delete:
 *     summary: حذف طلب إجازة (pending فقط)
 *     tags: [LeaveRequests]
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
 *         description: غير موجود أو ليس pending
 */
router.delete('/:id', authorize('leave_requests.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);


// ⬇️ endpoint مخصص للموظف — يعرض طلباته فقط
router.get('/my', authorize('leave_requests.view'), ctrl.list);

module.exports = router;