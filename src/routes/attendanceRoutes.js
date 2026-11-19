// routes/attendanceRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/AttendanceController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const STATUSES = ['present', 'absent', 'late', 'leave', 'holiday', 'weekend', 'remote'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /attendance
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /attendance:
 *   get:
 *     summary: قائمة سجلات الحضور
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employee_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [present, absent, late, leave, holiday, weekend, remote]
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200:
 *         description: قائمة السجلات
 */
router.get('/', authorize('attendance.view'),
  [
    query('employee_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('status').optional().isIn(STATUSES),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /attendance/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /attendance/{id}:
 *   get:
 *     summary: تفاصيل سجل حضور
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل السجل
 *       404:
 *         description: السجل غير موجود
 */
router.get('/:id', authorize('attendance.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /attendance/check-in
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /attendance/check-in:
 *   post:
 *     summary: تسجيل حضور (check-in)
 *     description: |
 *       يسجّل `check_in = NOW()` للموظف في التاريخ المحدد.
 *       **يفشل إذا:**
 *       - الموظف غير موجود أو حالته `terminated/resigned/suspended`.
 *       - يوجد check_in سابق لنفس اليوم.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employee_id, work_date]
 *             properties:
 *               employee_id: { type: string, format: uuid }
 *               work_date:   { type: string, format: date }
 *               notes:       { type: string }
 *     responses:
 *       201:
 *         description: تم تسجيل الحضور
 *       400:
 *         description: مسجل مسبقاً أو حالة الموظف غير مناسبة
 */
router.post('/check-in', authorize('attendance.checkin'),
  [
    body('employee_id').isUUID(),
    body('work_date').isISO8601(),
    body('notes').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.checkIn);

// ═══════════════════════════════════════════════════════════════════════════
// POST /attendance/check-out
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /attendance/check-out:
 *   post:
 *     summary: تسجيل انصراف (check-out)
 *     description: |
 *       يسجّل `check_out = NOW()` ويحسب تلقائياً:
 *       - `worked_hours` (ساعات العمل الفعلية)
 *       - `overtime_hours` (العمل الإضافي بعد نهاية الدوام)
 *       - `late_minutes` (التأخير عن بداية الدوام)
 *       - `early_leave_min` (الانصراف المبكر)
 *
 *       **يفشل إذا:**
 *       - لا يوجد check_in لنفس اليوم.
 *       - تم check-out مسبقاً.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employee_id, work_date]
 *             properties:
 *               employee_id: { type: string, format: uuid }
 *               work_date:   { type: string, format: date }
 *               notes:       { type: string }
 *     responses:
 *       200:
 *         description: تم تسجيل الانصراف
 *       400:
 *         description: بدون check-in أو مسجل مسبقاً
 *       404:
 *         description: لا يوجد سجل
 */
router.post('/check-out', authorize('attendance.checkout'),
  [
    body('employee_id').isUUID(),
    body('work_date').isISO8601(),
    body('notes').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.checkOut);

// ═══════════════════════════════════════════════════════════════════════════
// PUT /attendance — upsert يدوي
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /attendance:
 *   put:
 *     summary: تسجيل/تعديل حضور يدوي (مدير)
 *     description: |
 *       يُنشئ سجلاً جديداً أو يُحدّث الموجود.
 *       - إذا مرّرت `check_in` و `check_out` → يحسب الساعات تلقائياً.
 *       - إذا لم تمرر `status` → يُستنتج من check_in (present/late).
 *       - إذا لم تمرر `check_in` → status = 'absent'.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employee_id, work_date]
 *             properties:
 *               employee_id: { type: string, format: uuid }
 *               work_date:   { type: string, format: date }
 *               check_in:    { type: string, format: date-time, nullable: true }
 *               check_out:   { type: string, format: date-time, nullable: true }
 *               status:
 *                 type: string
 *                 enum: [present, absent, late, leave, holiday, weekend, remote]
 *               notes:       { type: string }
 *     responses:
 *       200:
 *         description: تم الحفظ
 *       400:
 *         description: check_out قبل check_in
 */
router.put('/', authorize('attendance.upsert'),
  [
    body('employee_id').isUUID(),
    body('work_date').isISO8601(),
    body('check_in').optional({ nullable: true }).isISO8601(),
    body('check_out').optional({ nullable: true }).isISO8601(),
    body('status').optional().isIn(STATUSES),
    body('notes').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.upsert);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /attendance/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /attendance/{id}:
 *   delete:
 *     summary: حذف سجل حضور
 *     tags: [Attendance]
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
 *         description: السجل غير موجود
 */
router.delete('/:id', authorize('attendance.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);

module.exports = router;