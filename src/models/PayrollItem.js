// models/PayrollItem.js
const { pool } = require('../config/pool');

class PayrollItem {
  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO payroll_items (
         company_id, payroll_run_id, employee_id,
         basic_salary, housing_allowance, transport_allowance, other_allowances,
         overtime_amount, bonus_amount, gross_salary,
         absence_deduction, tax_deduction, social_insurance,
         loan_deduction, other_deductions, total_deductions, net_salary,
         notes
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18
       )
       RETURNING *`,
      [
        companyId, data.payroll_run_id, data.employee_id,
        data.basic_salary, data.housing_allowance, data.transport_allowance,
        data.other_allowances, data.overtime_amount, data.bonus_amount,
        data.gross_salary, data.absence_deduction, data.tax_deduction,
        data.social_insurance, data.loan_deduction, data.other_deductions,
        data.total_deductions, data.net_salary, data.notes || null,
      ]
    );
    return r.rows[0];
  }

  static async listByRun(companyId, runId) {
    const r = await pool.query(
      `SELECT pi.*, e.employee_number, e.full_name
         FROM payroll_items pi
         JOIN employees e ON e.id = pi.employee_id
        WHERE pi.payroll_run_id = $1 AND pi.company_id = $2
        ORDER BY e.employee_number`,
      [runId, companyId]
    );
    return r.rows;
  }

  static async getTotals(client, runId) {
    const r = await client.query(
      `SELECT
         COALESCE(SUM(gross_salary), 0)::numeric     AS total_gross,
         COALESCE(SUM(total_deductions), 0)::numeric AS total_deductions,
         COALESCE(SUM(net_salary), 0)::numeric       AS total_net,
         COALESCE(SUM(social_insurance), 0)::numeric AS social_employee,
         COALESCE(SUM(tax_deduction), 0)::numeric    AS tax_total,
         COALESCE(SUM(basic_salary), 0)::numeric     AS basic_total
       FROM payroll_items
       WHERE payroll_run_id = $1`,
      [runId]
    );
    return r.rows[0];
  }

  static async delete(client, runId) {
    await client.query(
      `DELETE FROM payroll_items WHERE payroll_run_id = $1`,
      [runId]
    );
  }
}

module.exports = PayrollItem;