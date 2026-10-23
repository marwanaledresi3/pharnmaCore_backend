const {pool} = require('../config/pool');

class Notification {
  static async list(companyId, userId, { is_read, type, page = 1, limit = 20 }) {
    const params = [companyId, userId];
    const conds = [
      'company_id = $1',
      '(user_id = $2 OR user_id IS NULL)', // إشعارات عامة للشركة أو للمستخدم
    ];

    if (is_read !== undefined) { params.push(is_read); conds.push(`is_read = $${params.length}`); }
    if (type) { params.push(type); conds.push(`type = $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT id, type, title, message, metadata, reference_type, reference_id,
              is_read, created_at
       FROM notifications
       WHERE ${conds.join(' AND ')}
       ORDER BY is_read ASC, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM notifications
       WHERE ${conds.join(' AND ')}`,
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

  static async unreadCount(companyId, userId) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications
       WHERE company_id = $1 AND (user_id = $2 OR user_id IS NULL) AND is_read = FALSE`,
      [companyId, userId]
    );
    return r.rows[0].count;
  }

  static async markRead(companyId, userId, id) {
    const r = await pool.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE id = $1 AND company_id = $2
         AND (user_id = $3 OR user_id IS NULL)
       RETURNING id, is_read`,
      [id, companyId, userId]
    );
    return r.rows[0] || null;
  }

  static async markAllRead(companyId, userId) {
    const r = await pool.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE company_id = $1 AND (user_id = $2 OR user_id IS NULL) AND is_read = FALSE`,
      [companyId, userId]
    );
    return r.rowCount;
  }

  static async delete(companyId, userId, id) {
    const r = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1 AND company_id = $2
         AND (user_id = $3 OR user_id IS NULL)
       RETURNING id`,
      [id, companyId, userId]
    );
    return r.rowCount > 0;
  }

  /**
   * إنشاء إشعار (آمن ضد التكرار عبر unique_key)
   * @returns true إذا أُنشئ، false إذا موجود مسبقاً
   */
  static async create(client, {
    companyId, userId = null, type, title, message,
    metadata = null, referenceType = null, referenceId = null, uniqueKey = null,
  }) {
    try {
      await client.query(
        `INSERT INTO notifications
           (company_id, user_id, type, title, message, metadata,
            reference_type, reference_id, unique_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [companyId, userId, type, title, message,
         metadata ? JSON.stringify(metadata) : null,
         referenceType, referenceId, uniqueKey]
      );
      return true;
    } catch (err) {
      // 23505 = unique violation (إشعار موجود)
      if (err.code === '23505') return false;
      throw err;
    }
  }

  /**
   * إشعارات متعددة دفعة واحدة
   */
  static async createMany(client, notifications) {
    let created = 0;
    for (const n of notifications) {
      if (await this.create(client, n)) created++;
    }
    return created;
  }
}

module.exports = Notification;