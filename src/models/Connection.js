const {pool} = require('../config/pool');

class Connection {
  static async createRequest(requesterId, receiverId) {
    const r = await pool.query(
      `INSERT INTO company_connections (requester_company_id, receiver_company_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (requester_company_id, receiver_company_id) 
       DO UPDATE SET status = 'pending', updated_at = NOW()
       RETURNING *`,
      [requesterId, receiverId]
    );
    return r.rows[0];
  }

  static async updateStatus(companyId, connectionId, status) {
    const r = await pool.query(
      `UPDATE company_connections 
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND (receiver_company_id = $3 OR requester_company_id = $3)
       RETURNING *`,
      [status, connectionId, companyId]
    );
    return r.rows[0] || null;
  }

  static async listAccepted(companyId) {
    const r = await pool.query(
      `SELECT cc.id, cc.status, cc.created_at,
              CASE 
                WHEN cc.requester_company_id = $1 THEN rc.id ELSE reqc.id 
              END AS connected_company_id,
              CASE 
                WHEN cc.requester_company_id = $1 THEN rc.name ELSE reqc.name 
              END AS connected_company_name
       FROM company_connections cc
       JOIN companies reqc ON reqc.id = cc.requester_company_id
       JOIN companies rc ON rc.id = cc.receiver_company_id
       WHERE (cc.requester_company_id = $1 OR cc.receiver_company_id = $1)
         AND cc.status = 'accepted'`,
      [companyId]
    );
    return r.rows;
  }

  // دالة جديدة لجلب وبحث وعرض العلاقات بكل الحالات مع إمكانية البحث بالاسم والفلترة
  static async findAll(companyId, { status, search } = {}) {
    let query = `
      SELECT cc.id, cc.status, cc.created_at, cc.updated_at,
             CASE 
               WHEN cc.requester_company_id = $1 THEN rc.id ELSE reqc.id 
             END AS connected_company_id,
             CASE 
               WHEN cc.requester_company_id = $1 THEN rc.name ELSE reqc.name 
             END AS connected_company_name,
             CASE 
               WHEN cc.requester_company_id = $1 THEN rc.phone ELSE reqc.phone 
             END AS connected_company_phone,
             CASE 
               WHEN cc.requester_company_id = $1 THEN rc.address ELSE reqc.address 
             END AS connected_company_address
      FROM company_connections cc
      JOIN companies reqc ON reqc.id = cc.requester_company_id
      JOIN companies rc ON rc.id = cc.receiver_company_id
      WHERE (cc.requester_company_id = $1 OR cc.receiver_company_id = $1)
    `;

    const params = [companyId];
    let paramIndex = 2;

    // فلترة حسب الحالة (مثل: pending, accepted, rejected) إذا تم تمريرها
    if (status) {
      query += ` AND cc.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // البحث باسم الشركة المرتبطة
    if (search) {
      query += ` AND (
        CASE WHEN cc.requester_company_id = $1 THEN rc.name ELSE reqc.name END
      ) ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY cc.updated_at DESC`;

    const r = await pool.query(query, params);
    return r.rows;
  }
}

module.exports = Connection;