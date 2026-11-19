// services/payrollItemService.js
const { pool } = require('../config/pool');
const PayrollItem = require('../models/PayrollItem');
const ApiError = require('../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// حساب مشتقّات البند من مكوّناته
// ═══════════════════════════════════════════════════════════════════════════
const recomputeItem = (item) => {
  const basic       = round2(item.basic_salary);
  const housing     = round2(item.housing_allowance);
  const transport   = round2(item.transport_allowance);
  const other       = round2(item.other_allowances);
  const overtime    = round2(item.overtime_amount);
  const bonus       = round2(item.bonus_amount);

  const gross = round2(basic + housing + transport + other + overtime + bonus);

  const absence  = round2(item.absence_deduction);
  const tax      = round2(item.tax_deduction);
  const social   = round2(item.social_insurance);
  const loan     = round2(item.loan_deduction);
  const otherDed = round2(item.other_deductions);

  const totalDeductions = round2(absence + tax + social + loan + otherDed);
  const netSalary       = round2(gross - totalDeductions);

  if (netSalary < 0) {
    throw new ApiError(400, `net_salary cannot be negative (got ${netSalary})`);
  }

  return {
    gross_salary:     gross,
    total_deductions: totalDeductions,
    net_salary:       netSalary,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// إعادة حساب إجماليات المسير
// ═══════════════════════════════════════════════════════════════════════════
const recomputeRunTotals = async (client, runId) => {
  const r = await client.query(
    `SELECT
       COALESCE(SUM(gross_salary), 0)::numeric     AS total_gross,
       COALESCE(SUM(total_deductions), 0)::numeric AS total_deductions,
       COALESCE(SUM(net_salary), 0)::numeric       AS total_net
     FROM payroll_items
     WHERE payroll_run_id = $1`,
    [runId]
  );
  const t = r.rows[0];
  await client.query(
    `UPDATE payroll_runs
        SET total_gross = $1, total_deductions = $2, total_net = $3
      WHERE id = $4`,
    [t.total_gross, t.total_deductions, t.total_net, runId]
  );
  return {
    total_gross:      Number(t.total_gross),
    total_deductions: Number(t.total_deductions),
    total_net:        Number(t.total_net),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE — تعديل بند في مسير draft
// ═══════════════════════════════════════════════════════════════════════════
const update = async (companyId, runId, itemId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل المسير + فحص الحالة
    const runLock = await client.query(
      `SELECT id, status FROM payroll_runs
        WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [runId, companyId]
    );
    const run = runLock.rows[0];
    if (!run) throw new ApiError(404, 'Payroll run not found');
    if (run.status !== 'draft') {
      throw new ApiError(400, `Cannot edit items of payroll run in status: ${run.status}`);
    }

    // 2) جلب البند + قفل
    const itemLock = await client.query(
      `SELECT * FROM payroll_items
        WHERE id = $1 AND payroll_run_id = $2 AND company_id = $3
        FOR UPDATE`,
      [itemId, runId, companyId]
    );
    const item = itemLock.rows[0];
    if (!item) throw new ApiError(404, 'Payroll item not found');

    // 3) دمج التعديلات المسموحة
    const allowed = [
      'basic_salary', 'housing_allowance', 'transport_allowance',
      'other_allowances', 'overtime_amount', 'bonus_amount',
      'absence_deduction', 'tax_deduction', 'social_insurance',
      'loan_deduction', 'other_deductions', 'notes',
    ];
    for (const k of allowed) {
      if (payload[k] !== undefined) {
        item[k] = payload[k];
      }
    }

    // 4) إعادة حساب المشتقات
    const derived = recomputeItem(item);
    Object.assign(item, derived);

    // 5) تحديث البند
    const updated = await client.query(
      `UPDATE payroll_items SET
         basic_salary        = $1,
         housing_allowance   = $2,
         transport_allowance = $3,
         other_allowances    = $4,
         overtime_amount     = $5,
         bonus_amount        = $6,
         gross_salary        = $7,
         absence_deduction   = $8,
         tax_deduction       = $9,
         social_insurance    = $10,
         loan_deduction      = $11,
         other_deductions    = $12,
         total_deductions    = $13,
         net_salary          = $14,
         notes               = $15,
         updated_at          = NOW()
       WHERE id = $16
       RETURNING *`,
      [
        item.basic_salary, item.housing_allowance, item.transport_allowance,
        item.other_allowances, item.overtime_amount, item.bonus_amount,
        item.gross_salary, item.absence_deduction, item.tax_deduction,
        item.social_insurance, item.loan_deduction, item.other_deductions,
        item.total_deductions, item.net_salary, item.notes,
        itemId,
      ]
    );

    // 6) إعادة حساب إجماليات المسير
    const totals = await recomputeRunTotals(client, runId);

    await client.query('COMMIT');
    transactionStarted = false;
    return { item: updated.rows[0], totals };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payrollItem.update] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADD BONUS — إضافة مكافأة لبند
// ═══════════════════════════════════════════════════════════════════════════
const addBonus = async (companyId, runId, itemId, amount) => {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new ApiError(400, 'Bonus amount must be > 0');
  }
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const runLock = await client.query(
      `SELECT id, status FROM payroll_runs
        WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [runId, companyId]
    );
    const run = runLock.rows[0];
    if (!run) throw new ApiError(404, 'Payroll run not found');
    if (run.status !== 'draft') {
      throw new ApiError(400, `Cannot edit items of payroll run in status: ${run.status}`);
    }

    const itemLock = await client.query(
      `SELECT * FROM payroll_items
        WHERE id = $1 AND payroll_run_id = $2
        FOR UPDATE`,
      [itemId, runId]
    );
    const item = itemLock.rows[0];
    if (!item) throw new ApiError(404, 'Payroll item not found');

    item.bonus_amount = round2(Number(item.bonus_amount) + Number(amount));
    const derived = recomputeItem(item);

    const updated = await client.query(
      `UPDATE payroll_items
          SET bonus_amount = $1,
              gross_salary = $2,
              total_deductions = $3,
              net_salary = $4,
              updated_at = NOW()
        WHERE id = $5
        RETURNING *`,
      [item.bonus_amount, derived.gross_salary, derived.total_deductions, derived.net_salary, itemId]
    );

    const totals = await recomputeRunTotals(client, runId);

    await client.query('COMMIT');
    transactionStarted = false;
    return { item: updated.rows[0], totals };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payrollItem.addBonus] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { update, addBonus, recomputeItem };