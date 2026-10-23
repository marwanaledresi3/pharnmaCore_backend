const {pool} = require('../config/pool');
const BaseModel = require('./BaseModel');

class User extends BaseModel {
  static get table() { return 'users'; }

  static async findById(id) {
    const r = await pool.query(
      `SELECT id, company_id, name, email, user_type, is_active, last_login, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  static async findByEmail(email) {
    const r = await pool.query(
      `SELECT id, company_id, name, email, password_hash, user_type, is_active
       FROM users WHERE email = $1`,
      [email]
    );
    return r.rows[0] || null;
  }

 // models/User.js — findByIdWithRoles
static async findByIdWithRoles(id) {
  const user = await this.findById(id);
  if (!user) return null;

  const rolesRes = await pool.query(
    `SELECT r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [id]
  );

  const permsRes = await pool.query(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = $1`,
    [id]
  );

  user.roles = rolesRes.rows.map(r => r.name);       // ["Owner"]
  user.permissions = permsRes.rows.map(p => p.code); // ["invoices.view", ...]
  return user;
}


  static async createWithRoles(client, { company_id, name, email, password_hash, user_type = 'internal', is_active = true, role_ids = [] }) {
    const userRes = await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, user_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, company_id, name, email, user_type, is_active, created_at`,
      [company_id, name, email, password_hash, user_type, is_active]
    );
    const user = userRes.rows[0];
    for (const rid of role_ids) {
      await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [user.id, rid]);
    }
    return user;
  }

 
  static async update(companyId, id, payload) {
    const allowed = ['name', 'email', 'user_type'];
    const fields = [];
    const params = [];
    for (const key of allowed) {
      if (payload[key] !== undefined) {
        params.push(payload[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }
    if (!fields.length) return null;
    params.push(id, companyId);
    const r = await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, company_id, name, email, user_type, is_active, updated_at`,
      params
    );
    return r.rows[0] || null;
  }

  static async changePassword(id, companyId, password_hash) {
    const r = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [password_hash, id, companyId]
    );
    return r.rowCount > 0;
  }

  static async setStatus(id, companyId, is_active) {
    const r = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, is_active`,
      [is_active, id, companyId]
    );
    return r.rows[0] || null;
  }

  static async delete(id, companyId) {
    const r = await pool.query(
      `DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  static async replaceRoles(client, userId, roleIds) {
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    for (const rid of roleIds) {
      await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, rid]);
    }
  }
  // ✅ بعد:
static async list(companyId, { search, is_active, user_type, page = 1, limit = 20 }) {
  const params = [companyId];
  const conds = ['company_id = $1'];

  if (search) {
    params.push(`%${search}%`);
    conds.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (is_active !== undefined) { params.push(is_active); conds.push(`is_active = $${params.length}`); }
  if (user_type) { params.push(user_type); conds.push(`user_type = $${params.length}`); }

  const where = conds.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);
  params.push(limit, offset);

  const rows = await pool.query(
    `SELECT id, company_id, name, email, user_type, is_active, last_login, created_at
     FROM users WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM users WHERE ${where}`,
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

}

function offset(_unused, page, limit) {
  return (Number(page) - 1) * Number(limit);
}

module.exports = User;