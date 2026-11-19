// models/PayrollRun.js
const { pool } = require('../config/pool');

class PayrollRun {
  static async list(companyId, { status, page = 1, limit = 20 } = {}) {
    const params = [companyId];
    const conds = ['pr.company_id = $1'];

    if (status) {
      params.push(status);
      conds.push(`pr.status = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT pr.*,
              u.name AS approved_by_name,
              u2.name AS created_by_name
         FROM payroll_runs pr
         LEFT JOIN users u  ON u.id = pr.approved_by
         LEFT JOIN users u2 ON u2.id = pr.created_by
        WHERE ${conds.join(' AND ')}
        ORDER BY pr.period_year DESC, pr.period_month DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payroll_runs pr WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page), limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  static async findById(companyId, id, client = null) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT pr.*, u.name AS approved_by_name
         FROM payroll_runs pr
         LEFT JOIN users u ON u.id = pr.approved_by
        WHERE pr.id = $1 AND pr.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async findWithItems(companyId, id, client = null) {
    const executor = client || pool;
    const run = await this.findById(companyId, id, executor);
    if (!run) return null;

    const items = await executor.query(
      `SELECT pi.*, e.employee_number, e.full_name,
              e.bank_name, e.iban
         FROM payroll_items pi
         JOIN employees e ON e.id = pi.employee_id
        WHERE pi.payroll_run_id = $1
        ORDER BY e.employee_number`,
      [id]
    );
    run.items = items.rows;
    return run;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO payroll_runs (
         company_id, run_number, period_year, period_month,
         payment_date, status, created_by
       ) VALUES ($1, $2, $3, $4, $5, 'draft', $6)
       RETURNING *`,
      [companyId, data.run_number, data.period_year, data.period_month,
       data.payment_date, data.created_by]
    );
    return r.rows[0];
  }

  static async updateTotals(client, id, { total_gross, total_deductions, total_net }) {
    const r = await client.query(
      `UPDATE payroll_runs
          SET total_gross = $1, total_deductions = $2, total_net = $3
        WHERE id = $4
        RETURNING *`,
      [total_gross, total_deductions, total_net, id]
    );
    return r.rows[0];
  }

  static async markPaid(client, id, { journal_entry_id, approved_by }) {
    const r = await client.query(
      `UPDATE payroll_runs
          SET journal_entry_id = $1,
              status = 'paid',
              approved_by = $2,
              approved_at = NOW()
        WHERE id = $3 AND status IN ('draft', 'approved')
        RETURNING *`,
      [journal_entry_id, approved_by, id]
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM payroll_runs
        WHERE id = $1 AND company_id = $2 AND status = 'draft'
        RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }
}

module.exports = PayrollRun;