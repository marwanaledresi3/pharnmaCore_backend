// routes/employeeRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/EmployeeController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];
const STATUSES = ['active', 'on_leave', 'suspended', 'terminated', 'resigned'];
const GENDERS = ['male', 'female'];
const MARITAL = ['single', 'married', 'divorced', 'widowed'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /employees
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /employees:
 *   get:
 *     summary: قائمة الموظفين
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, on_leave, suspended, terminated, resigned] }
 *       - in: query
 *         name: department_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: قائمة الموظفين
 */
router.get('/', authorize('employees.view'),
  [
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('status').optional().isIn(STATUSES),
    query('department_id').optional().isUUID(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate, ctrl.list);

// ═══════════════════════════════════════════════════════════════════════════
// GET /employees/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /employees/{id}:
 *   get:
 *     summary: تفاصيل موظف
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل الموظف
 *       404:
 *         description: الموظف غير موجود
 */
router.get('/:id', authorize('employees.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// POST /employees
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /employees:
 *   post:
 *     summary: إضافة موظف جديد
 *     description: |
 *       **employee_number** يُولَّد تلقائياً (EMP-0001) إذا لم يُمرَّر.
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [full_name, hire_date]
 *             properties:
 *               full_name:           { type: string, maxLength: 200 }
 *               full_name_en:        { type: string, maxLength: 200 }
 *               employee_number:     { type: string, maxLength: 30 }
 *               national_id:         { type: string, maxLength: 30 }
 *               passport_number:     { type: string, maxLength: 30 }
 *               nationality:         { type: string, maxLength: 100 }
 *               gender:              { type: string, enum: [male, female] }
 *               birth_date:          { type: string, format: date }
 *               marital_status:      { type: string, enum: [single, married, divorced, widowed] }
 *               phone:               { type: string, maxLength: 50 }
 *               email:               { type: string, format: email }
 *               address:             { type: string }
 *               hire_date:           { type: string, format: date }
 *               department_id:       { type: string, format: uuid, nullable: true }
 *               job_title_id:        { type: string, format: uuid, nullable: true }
 *               manager_id:          { type: string, format: uuid, nullable: true }
 *               branch_id:           { type: string, format: uuid, nullable: true }
 *               basic_salary:        { type: number, minimum: 0 }
 *               housing_allowance:   { type: number, minimum: 0 }
 *               transport_allowance: { type: number, minimum: 0 }
 *               other_allowances:    { type: number, minimum: 0 }
 *               employment_type:     { type: string, enum: [full_time, part_time, contract, intern] }
 *               status:              { type: string, enum: [active, on_leave, suspended, terminated, resigned] }
 *               user_id:             { type: string, format: uuid, nullable: true }
 *               bank_name:           { type: string }
 *               bank_account:        { type: string }
 *               iban:                { type: string }
 *     responses:
 *       201:
 *         description: تم إنشاء الموظف
 *       400:
 *         description: بيانات غير صالحة
 */
router.post('/', authorize('employees.create'),
  [
    body('full_name').trim().notEmpty().isLength({ max: 200 }),
    body('full_name_en').optional({ nullable: true }).trim().isLength({ max: 200 }),
    body('employee_number').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('national_id').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('passport_number').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('nationality').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('gender').optional({ nullable: true }).isIn(GENDERS),
    body('birth_date').optional({ nullable: true }).isISO8601(),
    body('marital_status').optional({ nullable: true }).isIn(MARITAL),
    body('phone').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('email').optional({ nullable: true }).isEmail(),
    body('address').optional({ nullable: true }).trim(),
    body('hire_date').isISO8601(),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('job_title_id').optional({ nullable: true }).isUUID(),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('branch_id').optional({ nullable: true }).isUUID(),
    body('basic_salary').optional().isFloat({ min: 0 }),
    body('housing_allowance').optional().isFloat({ min: 0 }),
    body('transport_allowance').optional().isFloat({ min: 0 }),
    body('other_allowances').optional().isFloat({ min: 0 }),
    body('employment_type').optional().isIn(EMPLOYMENT_TYPES),
    body('status').optional().isIn(STATUSES),
    body('user_id').optional({ nullable: true }).isUUID(),
    body('bank_name').optional({ nullable: true }).trim(),
    body('bank_account').optional({ nullable: true }).trim(),
    body('iban').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.create);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /employees/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /employees/{id}:
 *   patch:
 *     summary: تعديل بيانات موظف
 *     tags: [Employees]
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
 *               full_name:           { type: string, maxLength: 200 }
 *               full_name_en:        { type: string, maxLength: 200 }
 *               phone:               { type: string }
 *               email:               { type: string, format: email }
 *               address:             { type: string }
 *               department_id:       { type: string, format: uuid, nullable: true }
 *               job_title_id:        { type: string, format: uuid, nullable: true }
 *               manager_id:          { type: string, format: uuid, nullable: true }
 *               basic_salary:        { type: number, minimum: 0 }
 *               housing_allowance:   { type: number, minimum: 0 }
 *               transport_allowance: { type: number, minimum: 0 }
 *               other_allowances:    { type: number, minimum: 0 }
 *               employment_type:     { type: string, enum: [full_time, part_time, contract, intern] }
 *               status:              { type: string, enum: [active, on_leave, suspended, terminated, resigned] }
 *               termination_date:    { type: string, format: date }
 *               user_id:             { type: string, format: uuid, nullable: true }
 *     responses:
 *       200:
 *         description: تم التعديل
 *       400:
 *         description: manager = self أو user مرتبط بموظف آخر
 *       404:
 *         description: الموظف غير موجود
 */
router.patch('/:id', authorize('employees.update'),
  [
    param('id').isUUID(),
    body('full_name').optional().trim().notEmpty().isLength({ max: 200 }),
    body('full_name_en').optional({ nullable: true }).trim().isLength({ max: 200 }),
    body('national_id').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('passport_number').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('nationality').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('gender').optional({ nullable: true }).isIn(GENDERS),
    body('birth_date').optional({ nullable: true }).isISO8601(),
    body('marital_status').optional({ nullable: true }).isIn(MARITAL),
    body('phone').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('email').optional({ nullable: true }).isEmail(),
    body('address').optional({ nullable: true }).trim(),
    body('hire_date').optional().isISO8601(),
    body('termination_date').optional({ nullable: true }).isISO8601(),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('job_title_id').optional({ nullable: true }).isUUID(),
    body('manager_id').optional({ nullable: true }).isUUID(),
    body('branch_id').optional({ nullable: true }).isUUID(),
    body('basic_salary').optional().isFloat({ min: 0 }),
    body('housing_allowance').optional().isFloat({ min: 0 }),
    body('transport_allowance').optional().isFloat({ min: 0 }),
    body('other_allowances').optional().isFloat({ min: 0 }),
    body('employment_type').optional().isIn(EMPLOYMENT_TYPES),
    body('status').optional().isIn(STATUSES),
    body('user_id').optional({ nullable: true }).isUUID(),
    body('bank_name').optional({ nullable: true }).trim(),
    body('bank_account').optional({ nullable: true }).trim(),
    body('iban').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /employees/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /employees/{id}:
 *   delete:
 *     summary: حذف موظف
 *     description: |
 *       **يمنع الحذف إذا:**
 *       - الموظف مدير قسم.
 *       - للموظف سجل رواتب.
 *       - للموظف سجل حضور.
 *
 *       في هذه الحالات، اضبط `status = 'terminated'` بدلاً من الحذف.
 *     tags: [Employees]
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
 *         description: الموظف له سجلات مرتبطة
 *       404:
 *         description: الموظف غير موجود
 */
router.delete('/:id', authorize('employees.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove);

module.exports = router;