// models/Department.js
const { pool } = require('../config/pool');

class Department {
  static async list(companyId, { is_active } = {}) {
    const params = [companyId];
    const conds = ['d.company_id = $1'];

    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`d.is_active = $${params.length}`);
    }

    const r = await pool.query(
      `SELECT d.id, d.name, d.code, d.parent_id, d.manager_id,
              d.is_active, d.created_at,
              p.name AS parent_name,
              m.full_name AS manager_name
         FROM departments d
         LEFT JOIN departments p ON p.id = d.parent_id
         LEFT JOIN employees  m ON m.id = d.manager_id
        WHERE ${conds.join(' AND ')}
        ORDER BY d.name`,
      params
    );
    return r.rows;
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT * FROM departments WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO departments (company_id, name, code, parent_id, manager_id, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       RETURNING *`,
      [companyId, data.name, data.code || null,
       data.parent_id || null, data.manager_id || null, data.is_active]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = ['name', 'code', 'parent_id', 'manager_id', 'is_active'];
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
      `UPDATE departments SET ${fields.join(', ')}
        WHERE id = $${params.length - 1} AND company_id = $${params.length}
        RETURNING *`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM departments WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }
}

module.exports = Department;