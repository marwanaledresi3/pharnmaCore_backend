const {pool} = require('../config/pool');

class Supplier {
  static async list(companyId, { search, is_active, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['s.company_id = $1'];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`(s.name ILIKE $${params.length} OR s.phone ILIKE $${params.length} OR s.email ILIKE $${params.length})`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`s.is_active = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT s.id, s.name, s.phone, s.email, s.address, s.tax_number,
              s.account_id, s.is_active, s.created_at
       FROM suppliers s
       WHERE ${conds.join(' AND ')}
       ORDER BY s.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM suppliers s WHERE ${conds.join(' AND ')}`,
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
              account_id, is_active, created_at
       FROM suppliers WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO suppliers (
        company_id,
        user_id,
        name,
        phone,
        email,
        address,
        tax_number,
        account_id,
        code
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        (
          SELECT 'SUP-' ||
                  LPAD((COUNT(*) + 1)::text, 4, '0')
          FROM suppliers
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
        data.account_id || null,
      ]
    );

    return r.rows[0];
  }
  static async update(companyId, id, payload) {
    const allowed = ['name', 'phone', 'email', 'address', 'tax_number',
                     'account_id', 'is_active', 'user_id'];
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
      `UPDATE suppliers SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, name, phone, email, is_active`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM suppliers WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  static async getBalance(companyId, supplierId) {
    const r = await pool.query(
      `SELECT COALESCE(SUM(i.total - i.paid_amount), 0)::numeric AS outstanding
       FROM invoices i
       WHERE i.company_id = $1 AND i.supplier_id = $2
         AND i.status IN ('unpaid', 'partial')`,
      [companyId, supplierId]
    );
    return { outstanding: Number(r.rows[0].outstanding) };
  }
}

module.exports = Supplier;