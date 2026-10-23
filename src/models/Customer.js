const {pool} = require('../config/pool');

class Customer {
  static async list(companyId, { search, is_active, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['c.company_id = $1'];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`c.is_active = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT c.id, c.name, c.phone, c.email, c.address, c.tax_number,
              c.credit_limit, c.account_id, c.is_active, c.created_at
       FROM customers c
       WHERE ${conds.join(' AND ')}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM customers c WHERE ${conds.join(' AND ')}`,
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
    const r = await pool.query(
      `SELECT id, user_id, name, phone, email, address, tax_number,
              credit_limit, account_id, is_active, created_at
       FROM customers WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }
  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO customers (
        company_id,
        user_id,
        name,
        phone,
        email,
        address,
        tax_number,
        credit_limit,
        account_id,
        code
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        (
          SELECT 'CUST-' ||
                  LPAD((COUNT(*) + 1)::text, 4, '0')
          FROM customers
          WHERE company_id = $1
        )
      )
      RETURNING id, name, code, phone, email, is_active, created_at`,
      [
        companyId,
        data.user_id || null,
        data.name,
        data.phone || null,
        data.email || null,
        data.address || null,
        data.tax_number || null,
        data.credit_limit || 0,
        data.account_id || null,
      ]
    );

    return r.rows[0];
  }
  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO customers
         (company_id, user_id, name, phone, email, address, tax_number,
          credit_limit, account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, phone, email, is_active, created_at`,
      [
        companyId, data.user_id || null, data.name,
        data.phone || null, data.email || null, data.address || null,
        data.tax_number || null, data.credit_limit || 0,
        data.account_id || null,
      ]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = ['name', 'phone', 'email', 'address', 'tax_number',
                     'credit_limit', 'account_id', 'is_active', 'user_id'];
    const fields = [];
    const params = [];
    for (const k of allowed) {
      if (payload[k] !== undefined) {
        params.push(payload[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return null;
    params.push(id, companyId);
    const r = await pool.query(
      `UPDATE customers SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, name, phone, email, is_active`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM customers WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  static async getBalance(companyId, customerId) {
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(i.total - i.paid_amount), 0)::numeric AS outstanding
       FROM invoices i
       WHERE i.company_id = $1 AND i.customer_id = $2
         AND i.status IN ('unpaid', 'partial')`,
      [companyId, customerId]
    );
    return { outstanding: Number(r.rows[0].outstanding) };
  }
}

module.exports = Customer;