const { pool } = require('../config/pool');

class Payment {
  static async list(companyId, { invoice_id, payment_type, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['p.company_id = $1'];

    if (invoice_id) { params.push(invoice_id); conds.push(`p.invoice_id = $${params.length}`); }
    if (payment_type) { params.push(payment_type); conds.push(`p.payment_type = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`p.payment_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`p.payment_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT p.id, p.invoice_id, p.supplier_id, p.customer_id,
              p.payment_type, p.amount, p.payment_date,
              p.method, p.reference, p.journal_entry_id, p.created_at,
              p.voucher_number, p.external_reference, p.description,
              i.invoice_number,
              COALESCE(c.name, s.name, c2.name, s2.name) AS party_name,
              cu.code AS currency_code
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN customers c2 ON c2.id = p.customer_id
       LEFT JOIN suppliers s2 ON s2.id = p.supplier_id
       JOIN currencies cu ON cu.id = p.currency_id
       WHERE ${conds.join(' AND ')}
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payments p WHERE ${conds.join(' AND ')}`,
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
      `SELECT p.*, i.invoice_number,
              COALESCE(c.name, s.name, c2.name, s2.name) AS party_name,
              cu.code AS currency_code
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN customers c2 ON c2.id = p.customer_id
       LEFT JOIN suppliers s2 ON s2.id = p.supplier_id
       JOIN currencies cu ON cu.id = p.currency_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO payments
         (company_id, invoice_id, supplier_id, customer_id,
          payment_type, amount, currency_id, payment_date,
          method, reference, voucher_number, external_reference,
          description, journal_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, invoice_id, supplier_id, customer_id,
                 amount, payment_date, method,
                 voucher_number, external_reference,
                 description, journal_entry_id`,
      [
        companyId,
        data.invoice_id || null,
        data.supplier_id || null,
        data.customer_id || null,
        data.payment_type,
        data.amount,
        data.currency_id,
        data.payment_date,
        data.method || null,
        data.reference || null,
        data.voucher_number || null,
        data.external_reference || null,
        data.description || null,
        data.journal_entry_id || null,
        data.created_by,
      ]
    );
    return r.rows[0];
  }

  static async delete(client, companyId, id) {
    const r = await client.query(
      `DELETE FROM payments WHERE id = $1 AND company_id = $2 RETURNING id, invoice_id`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async getCustomerCredit(client, companyId, customerId) {
    const r = await client.query(
      `SELECT COALESCE(SUM(jel.credit - jel.debit), 0)::numeric AS credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts a ON a.id = jel.account_id
       JOIN customers c ON c.account_id = a.id
       WHERE je.company_id = $1 AND c.id = $2 AND je.status = 'posted'
         AND a.code = '112'`,
      [companyId, customerId]
    );
    return Number(r.rows[0].credit);
  }

  static async getUnrefundedReturns(client, companyId, customerId) {
    const r = await client.query(
      `SELECT r.id, r.return_number, r.return_date, r.total,
              COALESCE((
                SELECT SUM(p.amount) FROM payments p
                WHERE p.refund_of_payment_id IS NOT NULL
                  AND p.notes LIKE '%' || r.return_number || '%'
              ), 0)::numeric AS refunded
       FROM returns r
       WHERE r.company_id = $1 AND r.customer_id = $2
         AND r.return_type = 'sales' AND r.status = 'confirmed'
       ORDER BY r.return_date ASC`,
      [companyId, customerId]
    );
    return r.rows;
  }
}

module.exports = Payment;