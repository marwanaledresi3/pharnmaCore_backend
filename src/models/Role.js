const {pool} = require('../config/pool');

class Role {
  static async list(companyId) {
    const r = await pool.query(
      `SELECT r.id, r.name, r.description, r.is_system, r.created_at,
              COUNT(rp.permission_id)::int AS permissions_count
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.company_id = $1
       GROUP BY r.id
       ORDER BY r.created_at ASC`,
      [companyId]
    );
    return r.rows;
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT id, name, description, is_system, created_at
       FROM roles WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async findByIdWithPermissions(companyId, id) {
    const role = await this.findById(companyId, id);
    if (!role) return null;
    const perms = await pool.query(
      `SELECT p.id, p.code, p.name, p.module
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = $1
       ORDER BY p.module, p.code`,
      [id]
    );
    role.permissions = perms.rows;
    return role;
  }

  static async create(client, companyId, { name, description, is_system = false }) {
    const r = await client.query(
      `INSERT INTO roles (company_id, name, description, is_system)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, is_system, created_at`,
      [companyId, name, description || null, is_system]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = ['name', 'description'];
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
      `UPDATE roles SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, name, description, is_system`,
      params
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM roles WHERE id = $1 AND company_id = $2 AND is_system = FALSE RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  static async replacePermissions(client, roleId, permissionIds) {
    await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    for (const pid of permissionIds) {
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, pid]);
    }
  }

  static async grantAllPermissions(client, roleId) {
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions
       ON CONFLICT DO NOTHING`,
      [roleId]
    );
  }
}

module.exports = Role;