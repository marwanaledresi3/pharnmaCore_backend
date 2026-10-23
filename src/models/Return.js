const {pool} = require('../config/pool');

class Return {
  static async list(companyId, { return_type, status, invoice_id, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['r.company_id = $1'];

    if (return_type) { params.push(return_type); conds.push(`r.return_type = $${params.length}`); }
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`); }
    if (invoice_id) { params.push(invoice_id); conds.push(`r.invoice_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`r.return_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`r.return_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT r.id, r.return_number, r.return_type, r.return_date,
              r.subtotal, r.tax_total, r.total, r.status,
              COALESCE(c.name, s.name) AS party_name,
              i.invoice_number, r.created_at
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       WHERE ${conds.join(' AND ')}
       ORDER BY r.return_date DESC, r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM returns r WHERE ${conds.join(' AND ')}`,
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

  static async findById(companyId, id) {
    const head = await pool.query(
      `SELECT r.*, COALESCE(c.name, s.name) AS party_name,
              i.invoice_number, cu.code AS currency_code
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       JOIN currencies cu ON cu.id = r.currency_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [id, companyId]
    );
    const ret = head.rows[0];
    if (!ret) return null;

    const items = await pool.query(
      `SELECT ri.*, p.name AS product_name, p.sku
       FROM return_items ri
       JOIN products p ON p.id = ri.product_id
       WHERE ri.return_id = $1`,
      [id]
    );
    ret.items = items.rows;
    return ret;
  }

  static async nextNumber(client, companyId, returnType) {
    const prefix = returnType === 'sale' ? 'SR-' : 'PR-';
    const r = await client.query(
      `SELECT COUNT(*)::int + 1 AS next FROM returns
       WHERE company_id = $1 AND return_type = $2`,
      [companyId, returnType]
    );
    return `${prefix}${String(r.rows[0].next).padStart(5, '0')}`;
  }

  static async create(client, companyId, data) {
    const number = await this.nextNumber(client, companyId, data.return_type);
    const r = await client.query(
      `INSERT INTO returns
         (company_id, return_number, return_type, invoice_id, reference_type, reference_id,
          customer_id, supplier_id, return_date, currency_id, exchange_rate,
          subtotal, tax_total, total, reason, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16)
       RETURNING id, return_number, status, subtotal, tax_total, total`,
      [
        companyId, number, data.return_type,
        data.invoice_id || null, data.reference_type || null, data.reference_id || null,
        data.customer_id || null, data.supplier_id || null,
        data.return_date, data.currency_id, data.exchange_rate || 1,
        data.subtotal, data.tax_total, data.total,
        data.reason || null, data.created_by,
      ]
    );
    const ret = r.rows[0];

    for (const item of data.items) {
      await client.query(
        `INSERT INTO return_items
           (return_id, original_item_id, product_id, batch_id, quantity,
            unit_price, tax_rate, tax_amount, line_total, cost_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ret.id, item.original_item_id || null, item.product_id, item.batch_id || null,
          item.quantity, item.unit_price, item.tax_rate || 0,
          item.tax_amount || 0, item.line_total, item.cost_price || 0,
        ]
      );
    }
    return ret;
  }

  static async updateStatus(companyId, id, newStatus) {
    const r = await pool.query(
      `UPDATE returns SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, status`,
      [newStatus, id, companyId]
    );
    return r.rows[0] || null;
  }

  static async linkJournalEntry(companyId, id, journalEntryId) {
    const r = await pool.query(
      `UPDATE returns SET journal_entry_id = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, journal_entry_id`,
      [journalEntryId, id, companyId]
    );
    return r.rows[0] || null;
  }
}

module.exports = Return;