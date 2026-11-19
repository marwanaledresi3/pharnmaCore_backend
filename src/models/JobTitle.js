// models/JobTitle.js
const { pool } = require('../config/pool');

class JobTitle {
  static async list(companyId, { search, department_id, is_active, page = 1, limit = 50 } = {}) {
    const params = [companyId];
    const conds = ['j.company_id = $1'];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`j.name ILIKE $${params.length}`);
    }
    if (department_id) {
      params.push(department_id);
      conds.push(`j.department_id = $${params.length}`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`j.is_active = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT j.id, j.name, j.department_id, j.description, j.is_active,
              j.created_at, d.name AS department_name
       FROM job_titles j
       LEFT JOIN departments d ON d.id = j.department_id
       WHERE ${conds.join(' AND ')}
       ORDER BY j.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM job_titles j WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;
    return {
      items: rows.rows,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    };
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT j.*, d.name AS department_name
       FROM job_titles j
       LEFT JOIN departments d ON d.id = j.department_id
       WHERE j.id = $1 AND j.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO job_titles (company_id, name, department_id, description, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, department_id, description, is_active, created_at`,
      [
        companyId,
        data.name,
        data.department_id || null,
        data.description || null,
        data.is_active !== undefined ? data.is_active : true,
      ]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = ['name', 'department_id', 'description', 'is_active'];
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
      `UPDATE job_titles SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, name, department_id, description, is_active`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM job_titles WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }
}

module.exports = JobTitle;