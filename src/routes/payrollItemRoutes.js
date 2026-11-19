// routes/payrollItemRoutes.js
const router = require('express').Router({ mergeParams: true });
const ctrl = require('../controllers/PayrollItemController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll/:runId/items
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{runId}/items:
 *   get:
 *     summary: قائمة بنود مسير رواتب
 *     tags: [PayrollItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: قائمة البنود
 *       404:
 *         description: المسير غير موجود
 */
router.get('/', authorize('payroll.view'),
  [param('runId').isUUID()],
  validate, ctrl.listByRun);

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll/:runId/items/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{runId}/items/{id}:
 *   get:
 *     summary: تفاصيل بند
 *     tags: [PayrollItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تفاصيل البند
 *       404:
 *         description: غير موجود
 */
router.get('/:id', authorize('payroll.view'),
  [param('runId').isUUID(), param('id').isUUID()],
  validate, ctrl.getOne);

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /payroll/:runId/items/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{runId}/items/{id}:
 *   patch:
 *     summary: تعديل بند (draft فقط)
 *     description: |
 *       - المسير يجب أن يكون `draft`.
 *       - `gross_salary` و `total_deductions` و `net_salary` **تُعاد حسابتها تلقائياً**.
 *       - إجماليات المسير تُحدَّث تلقائياً.
 *     tags: [PayrollItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
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
 *               basic_salary:        { type: number, minimum: 0 }
 *               housing_allowance:   { type: number, minimum: 0 }
 *               transport_allowance: { type: number, minimum: 0 }
 *               other_allowances:    { type: number, minimum: 0 }
 *               overtime_amount:     { type: number, minimum: 0 }
 *               bonus_amount:        { type: number, minimum: 0 }
 *               absence_deduction:   { type: number, minimum: 0 }
 *               tax_deduction:       { type: number, minimum: 0 }
 *               social_insurance:    { type: number, minimum: 0 }
 *               loan_deduction:      { type: number, minimum: 0 }
 *               other_deductions:    { type: number, minimum: 0 }
 *               notes:               { type: string }
 *     responses:
 *       200:
 *         description: البند + إجماليات المسير المحدّثة
 *       400:
 *         description: المسير ليس draft
 *       404:
 *         description: البند أو المسير غير موجود
 */
router.patch('/:id', authorize('payroll_items.update'),
  [
    param('runId').isUUID(),
    param('id').isUUID(),
    body('basic_salary').optional().isFloat({ min: 0 }),
    body('housing_allowance').optional().isFloat({ min: 0 }),
    body('transport_allowance').optional().isFloat({ min: 0 }),
    body('other_allowances').optional().isFloat({ min: 0 }),
    body('overtime_amount').optional().isFloat({ min: 0 }),
    body('bonus_amount').optional().isFloat({ min: 0 }),
    body('absence_deduction').optional().isFloat({ min: 0 }),
    body('tax_deduction').optional().isFloat({ min: 0 }),
    body('social_insurance').optional().isFloat({ min: 0 }),
    body('loan_deduction').optional().isFloat({ min: 0 }),
    body('other_deductions').optional().isFloat({ min: 0 }),
    body('notes').optional({ nullable: true }).trim(),
  ],
  validate, ctrl.update);

// ═══════════════════════════════════════════════════════════════════════════
// POST /payroll/:runId/items/:id/bonus
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{runId}/items/{id}/bonus:
 *   post:
 *     summary: إضافة مكافأة لبند
 *     description: |
 *       - يضيف المبلغ إلى `bonus_amount` الحالي.
 *       - يعيد حساب `gross_salary` و `net_salary` تلقائياً.
 *     tags: [PayrollItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number, minimum: 0.01 }
 *     responses:
 *       200:
 *         description: البند + إجماليات المسير المحدّثة
 *       400:
 *         description: مبلغ غير صالح أو مسير ليس draft
 */
router.post('/:id/bonus', authorize('payroll_items.bonus'),
  [
    param('runId').isUUID(),
    param('id').isUUID(),
    body('amount').isFloat({ min: 0.01 }),
  ],
  validate, ctrl.addBonus);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /payroll/:runId/items/:id
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /payroll/{runId}/items/{id}:
 *   delete:
 *     summary: حذف بند (draft فقط)
 *     description: يُحدّث إجماليات المسير تلقائياً بعد الحذف.
 *     tags: [PayrollItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: تم الحذف
 *       400:
 *         description: المسير ليس draft
 *       404:
 *         description: البند غير موجود
 */
router.delete('/:id', authorize('payroll_items.delete'),
  [
    param('runId').isUUID(),
    param('id').isUUID(),
  ],
  validate, ctrl.remove);

module.exports = router;