// controllers/PayrollItemController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const PayrollItem = require('../models/PayrollItem');
const service = require('../services/payrollItemService');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll/:runId/items — قائمة بنود مسير
// ═══════════════════════════════════════════════════════════════════════════
const listByRun = asyncHandler(async (req, res) => {
  // فحص المسير ينتمي للشركة
  const run = await pool.query(
    `SELECT id FROM payroll_runs WHERE id = $1 AND company_id = $2`,
    [req.params.runId, req.user.company_id]
  );
  if (!run.rowCount) throw new ApiError(404, 'Payroll run not found');

  const items = await PayrollItem.listByRun(req.user.company_id, req.params.runId);
  res.json({ success: true, data: items });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll/:runId/items/:id — تفاصيل بند
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT pi.*, e.employee_number, e.full_name
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
      WHERE pi.id = $1
        AND pi.payroll_run_id = $2
        AND pi.company_id = $3`,
    [req.params.id, req.params.runId, req.user.company_id]
  );
  if (!r.rowCount) throw new ApiError(404, 'Payroll item not found');
  res.json({ success: true, data: r.rows[0] });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /payroll/:runId/items/:id — تعديل بند (draft فقط)
// ═══════════════════════════════════════════════════════════════════════════
const update = asyncHandler(async (req, res) => {
  const result = await service.update(
    req.user.company_id,
    req.params.runId,
    req.params.id,
    req.body
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /payroll/:runId/items/:id/bonus — إضافة مكافأة
// ═══════════════════════════════════════════════════════════════════════════
const addBonus = asyncHandler(async (req, res) => {
  const result = await service.addBonus(
    req.user.company_id,
    req.params.runId,
    req.params.id,
    req.body.amount
  );
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /payroll/:runId/items/:id — حذف بند (draft فقط)
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // قفل المسير
    const runLock = await client.query(
      `SELECT id, status FROM payroll_runs
        WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [req.params.runId, req.user.company_id]
    );
    const run = runLock.rows[0];
    if (!run) throw new ApiError(404, 'Payroll run not found');
    if (run.status !== 'draft') {
      throw new ApiError(400, `Cannot delete items from payroll run in status: ${run.status}`);
    }

    // حذف البند
    const del = await client.query(
      `DELETE FROM payroll_items
        WHERE id = $1 AND payroll_run_id = $2 AND company_id = $3
        RETURNING id`,
      [req.params.id, req.params.runId, req.user.company_id]
    );
    if (!del.rowCount) throw new ApiError(404, 'Payroll item not found');

    // إعادة حساب الإجماليات
    await client.query(
      `UPDATE payroll_runs SET
         total_gross = COALESCE((SELECT SUM(gross_salary)     FROM payroll_items WHERE payroll_run_id = $1), 0),
         total_deductions = COALESCE((SELECT SUM(total_deductions) FROM payroll_items WHERE payroll_run_id = $1), 0),
         total_net = COALESCE((SELECT SUM(net_salary)         FROM payroll_items WHERE payroll_run_id = $1), 0)
       WHERE id = $1`,
      [req.params.runId]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ success: true, message: 'Payroll item deleted' });
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payrollItem.remove] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
});

module.exports = { listByRun, getOne, update, addBonus, remove };