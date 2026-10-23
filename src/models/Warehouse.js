const {pool} = require('../config/pool');

class Warehouse {
  static async list(companyId) {
    const r = await pool.query(
      `SELECT id, name, location, is_active, created_at
       FROM warehouses WHERE company_id = $1 ORDER BY name`,
      [companyId]
    );
    return r.rows;
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT id, name, location, is_active FROM warehouses
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, { name, location }) {
    const r = await client.query(
      `INSERT INTO warehouses (company_id, name, location)
       VALUES ($1, $2, $3)
       RETURNING id, name, location, is_active`,
      [companyId, name, location || null]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = ['name', 'location', 'is_active'];
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
      `UPDATE warehouses SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, name, location, is_active`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM warehouses WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }
}

module.exports = Warehouse;