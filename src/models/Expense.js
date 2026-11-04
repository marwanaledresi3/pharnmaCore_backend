const { pool } = require('../config/pool');

class Expense {
  static async list(companyId, { status, category, supplier_id, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['e.company_id = $1'];

    if (status) { params.push(status); conds.push(`e.status = $${params.length}`); }
    if (category) { params.push(category); conds.push(`e.expense_category = $${params.length}`); }
    if (supplier_id) { params.push(supplier_id); conds.push(`e.supplier_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`e.expense_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`e.expense_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT e.id, e.expense_number, e.expense_date, e.expense_category,
              e.description, e.amount, e.currency_id, e.exchange_rate,
              e.payment_type, e.payment_method, e.paid_amount, e.due_date,
              e.status, e.journal_entry_id, e.external_reference,
              e.supplier_id, e.created_at,
              cu.code AS currency_code,
              s.name AS supplier_name,
              a.code AS account_code, a.name AS account_name
       FROM expenses e
       JOIN currencies cu ON cu.id = e.currency_id
       JOIN chart_of_accounts a ON a.id = e.expense_account_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       WHERE ${conds.join(' AND ')}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM expenses e WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT e.*, cu.code AS currency_code,
              s.name AS supplier_name,
              a.code AS account_code, a.name AS account_name
       FROM expenses e
       JOIN currencies cu ON cu.id = e.currency_id
       JOIN chart_of_accounts a ON a.id = e.expense_account_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       WHERE e.id = $1 AND e.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO expenses
         (company_id, expense_number, expense_date, expense_category,
          expense_account_id, supplier_id, description, amount,
          currency_id, exchange_rate, payment_type, payment_method,
          paid_amount, due_date, status, journal_entry_id,
          external_reference, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id, expense_number, status, amount, paid_amount`,
      [
        companyId,
        data.expense_number,
        data.expense_date,
        data.expense_category,
        data.expense_account_id,
        data.supplier_id || null,
        data.description,
        data.amount,
        data.currency_id,
        data.exchange_rate || 1,
        data.payment_type,
        data.payment_method || null,
        data.paid_amount || 0,
        data.due_date || null,
        data.status || 'posted',
        data.journal_entry_id || null,
        data.external_reference || null,
        data.created_by,
      ]
    );
    return r.rows[0];
  }

  static async updateStatus(companyId, id, status, client = null) {
    const executor = client || pool;
    const r = await executor.query(
      `UPDATE expenses SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, status`,
      [status, id, companyId]
    );
    return r.rows[0] || null;
  }
}

module.exports = Expense;