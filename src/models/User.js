const { pool } = require('../config/pool');

class User {
  static get table() { return 'users'; }

  static async findById(id) {
    const r = await pool.query(
      `SELECT u.id, u.company_id, u.name, u.email, u.phone, u.user_type,
              u.is_active, u.branch_id, b.name AS branch_name,
              u.last_login, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  /** للدخول — بريد عالمي فريد */
  static async findByEmail(email) {
    const r = await pool.query(
      `SELECT id, company_id, name, email, phone, password_hash,
              user_type, is_active, branch_id
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return r.rows[0] || null;
  }

  /** لفحص التكرار عند الإنشاء — بريد عالمي فريد */
  static async emailExists(email, client = pool, excludeId = null) {
    const params = [email];
    let sql = `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND id <> $2`;
    }
    const r = await client.query(sql, params);
    return r.rowCount > 0;
  }

  static async findByIdWithRoles(id) {
    const user = await this.findById(id);
    if (!user) return null;

    const rolesRes = await pool.query(
      `SELECT r.id, r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1 ORDER BY r.name`,
      [id]
    );
    const permsRes = await pool.query(
      `SELECT DISTINCT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1`,
      [id]
    );

    user.roles = rolesRes.rows.map((r) => r.name); // أسماء للـ authMiddleware
    user.role_objects = rolesRes.rows;             // {id, name} للواجهة
    user.permissions = permsRes.rows.map((p) => p.code);
    return user;
  }

  static async createWithRoles(client, {
    company_id, name, email, phone, password_hash,
    user_type = 'internal', is_active = true, branch_id = null, role_ids = [],
  }) {
    const userRes = await client.query(
      `INSERT INTO users
         (company_id, name, email, phone, password_hash, user_type, is_active, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, company_id, name, email, phone, user_type, is_active, branch_id, created_at`,
      [company_id, name, email, phone || null, password_hash, user_type, is_active, branch_id]
    );
    const user = userRes.rows[0];

    for (const rid of role_ids) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, rid]
      );
    }
    return user;
  }

  static async update(companyId, id, payload) {
    const allowed = ['name', 'email', 'phone', 'user_type', 'branch_id'];
    const fields = [];
    const params = [];
    for (const key of allowed) {
      if (payload[key] !== undefined) {
        params.push(payload[key] === '' ? null : payload[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }
    if (!fields.length) return null;
    params.push(id, companyId);
    const r = await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, company_id, name, email, phone, user_type, is_active, branch_id, updated_at`,
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

  static async replaceRoles(client, companyId, userId, roleIds) {
    if (roleIds.length) {
      const check = await client.query(
        `SELECT id FROM roles WHERE id = ANY($1::uuid[]) AND company_id = $2`,
        [roleIds, companyId]
      );
      if (check.rowCount !== roleIds.length) {
        throw new Error('One or more roles are invalid');
      }
    }
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    for (const rid of roleIds) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, rid]
      );
    }
  }

  static async list(companyId, {
    search, is_active, user_type, branch_id,
    sort = 'created_at', order = 'desc', page = 1, limit = 20,
  }) {
    const params = [companyId];
    const conds = ['u.company_id = $1'];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      conds.push(`(u.name ILIKE $${i} OR u.email ILIKE $${i} OR u.phone ILIKE $${i})`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`u.is_active = $${params.length}`);
    }
    if (user_type) {
      params.push(user_type);
      conds.push(`u.user_type = $${params.length}`);
    }
    if (branch_id === null) {
      conds.push(`u.branch_id IS NULL`);
    } else if (branch_id) {
      params.push(branch_id);
      conds.push(`u.branch_id = $${params.length}`);
    }

    const SORTABLE = {
      name: 'u.name', email: 'u.email',
      is_active: 'u.is_active', created_at: 'u.created_at',
    };
    const sortCol = SORTABLE[sort] ?? 'u.created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT u.id, u.company_id, u.name, u.email, u.phone, u.user_type,
              u.is_active, u.branch_id, b.name AS branch_name,
              u.last_login, u.created_at,
              COALESCE(
                (SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
                 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id),
                '[]'::json
              ) AS roles
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE ${conds.join(' AND ')}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u WHERE ${conds.join(' AND ')}`,
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

module.exports = User;