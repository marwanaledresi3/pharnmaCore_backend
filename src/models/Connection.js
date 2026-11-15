// models/Connection.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * قواعد انتقال الحالة المسموحة.
 * - pending → accepted | rejected | blocked | pending (إعادة إرسال)
 * - accepted → blocked (حظر لاحق)
 * - rejected → pending (إعادة طلب)
 * - blocked → (لا شيء — يجب فك الحظر أولاً)
 */
const VALID_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'blocked', 'pending'],
  accepted: ['blocked', 'accepted'],
  rejected: ['pending', 'rejected'],
  blocked: ['blocked'],
};

function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// ═══════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════

class Connection {
  /**
   * إنشاء طلب اتصال.
   *
   * ✅ FIX #3: لا يُلغي `blocked` / `accepted`
   * ✅ FIX #4: التحقق من وجود `receiverId`
   */
  static async createRequest(requesterId, receiverId) {
    // ─── 1) التحقق من وجود الشركة المستقبلة ──────────────────────
    const receiver = await pool.query(
      `SELECT id, name, is_active FROM companies WHERE id = $1`,
      [receiverId]
    );
    if (!receiver.rowCount) {
      throw new ApiError(404, 'Receiver company not found');
    }
    if (!receiver.rows[0].is_active) {
      throw new ApiError(400, 'Receiver company is inactive');
    }

    // ─── 2) التحقق من الحالة الحالية (إن وُجدت) ─────────────────
    const existing = await pool.query(
      `SELECT id, status, requester_company_id
       FROM company_connections
       WHERE (requester_company_id = $1 AND receiver_company_id = $2)
          OR (requester_company_id = $2 AND receiver_company_id = $1)
       LIMIT 1
       FOR UPDATE`,
      [requesterId, receiverId]
    );

    if (existing.rowCount > 0) {
      const current = existing.rows[0];

      if (current.status === 'blocked') {
        throw new ApiError(
          409,
          'This connection is blocked. Cannot re-send a request.'
        );
      }
      if (current.status === 'accepted') {
        throw new ApiError(409, 'Already connected');
      }
      // pending / rejected → نسمح بإعادة الإرسال (تحديث)
    }

    // ─── 3) إنشاء / تحديث الطلب ──────────────────────────────────
    if (existing.rowCount > 0) {
      // تحديث الطلب الحالي (pending / rejected → pending)
      const r = await pool.query(
        `UPDATE company_connections
         SET status = 'pending',
             requester_company_id = $1,
             receiver_company_id = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [requesterId, receiverId, existing.rows[0].id]
      );
      return r.rows[0];
    }

    // إنشاء جديد
    const r = await pool.query(
      `INSERT INTO company_connections
         (requester_company_id, receiver_company_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [requesterId, receiverId]
    );
    return r.rows[0];
  }

  /**
   * تحديث حالة اتصال.
   *
   * ✅ FIX #2: تحقق من الحالة السابقة
   */
  static async updateStatus(companyId, connectionId, status) {
    // ─── 1) جلب الحالة الحالية ───────────────────────────────────
    const current = await pool.query(
      `SELECT id, status, requester_company_id, receiver_company_id
       FROM company_connections
       WHERE id = $1
         AND (receiver_company_id = $2 OR requester_company_id = $2)
       FOR UPDATE`,
      [connectionId, companyId]
    );

    if (!current.rowCount) {
      return null; // 404
    }

    const from = current.rows[0].status;

    // ─── 2) التحقق من صحة الانتقال ───────────────────────────────
    if (!canTransition(from, status)) {
      throw new ApiError(
        400,
        `Cannot change status from '${from}' to '${status}'`
      );
    }

    // ─── 3) إذا كان `accepted`، تحقق من أن الشركة المستقبلة هي من تقبل ─
    // (يمكن للطرفين تحديث الحالة، لكن:
    //  - `accepted` يُفضّل أن يكون من `receiver`
    //  - `blocked` يمكن من أي طرف
    // هذا منطق أعمال — نتركه للـ controller
    //  )

    // ─── 4) التحديث ──────────────────────────────────────────────
    const r = await pool.query(
      `UPDATE company_connections
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, connectionId]
    );
    return r.rows[0] || null;
  }

  /**
   * الاتصالات المقبولة فقط.
   */
  static async listAccepted(companyId) {
    const r = await pool.query(
      `SELECT
         cc.id,
         cc.status,
         cc.created_at,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.id
           ELSE reqc.id
         END AS connected_company_id,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.name
           ELSE reqc.name
         END AS connected_company_name
       FROM company_connections cc
       JOIN companies reqc ON reqc.id = cc.requester_company_id
       JOIN companies rc ON rc.id = cc.receiver_company_id
       WHERE (cc.requester_company_id = $1 OR cc.receiver_company_id = $1)
         AND cc.status = 'accepted'
       ORDER BY cc.updated_at DESC`,
      [companyId]
    );
    return r.rows;
  }

  /**
   * كل الاتصالات (مع الفلاتر والترقيم).
   *
   * ✅ FIX #1: إرجاع `direction`, `requester_company`, `receiver_company`
   * ✅ FIX #8: pagination
   */
  static async findAll(companyId, {
    status,
    search,
    direction,
    page = 1,
    limit = 20,
  } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const params = [companyId];
    const conds = ['(cc.requester_company_id = $1 OR cc.receiver_company_id = $1)'];

    if (status) {
      params.push(status);
      conds.push(`cc.status = $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      conds.push(`(
        CASE WHEN cc.requester_company_id = $1 THEN rc.name ELSE reqc.name END
      ) ILIKE $${params.length}`);
    }

    if (direction === 'sent') {
      conds.push(`cc.requester_company_id = $1`);
    } else if (direction === 'received') {
      conds.push(`cc.receiver_company_id = $1`);
    }

    const where = conds.join(' AND ');

    params.push(safeLimit, offset);

    const r = await pool.query(
      `SELECT
         cc.id,
         cc.requester_company_id,
         cc.receiver_company_id,
         cc.status,
         cc.created_at,
         cc.updated_at,

         -- الاتجاه
         CASE
           WHEN cc.requester_company_id = $1 THEN 'sent'
           WHEN cc.receiver_company_id = $1 THEN 'received'
           ELSE NULL
         END AS direction,

         -- الشركة المتصلة (الطرف الآخر)
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.id
           ELSE reqc.id
         END AS connected_company_id,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.name
           ELSE reqc.name
         END AS connected_company_name,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.phone
           ELSE reqc.phone
         END AS connected_company_phone,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.address
           ELSE reqc.address
         END AS connected_company_address,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.tax_number
           ELSE reqc.tax_number
         END AS connected_company_tax_number,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.email
           ELSE reqc.email
         END AS connected_company_email,
         CASE
           WHEN cc.requester_company_id = $1 THEN rc.logo_url
           ELSE reqc.logo_url
         END AS connected_company_logo_url,

         -- كائن كامل للطرف الآخر
         jsonb_build_object(
           'id', CASE WHEN cc.requester_company_id = $1 THEN rc.id ELSE reqc.id END,
           'name', CASE WHEN cc.requester_company_id = $1 THEN rc.name ELSE reqc.name END,
           'phone', CASE WHEN cc.requester_company_id = $1 THEN rc.phone ELSE reqc.phone END,
           'email', CASE WHEN cc.requester_company_id = $1 THEN rc.email ELSE reqc.email END,
           'address', CASE WHEN cc.requester_company_id = $1 THEN rc.address ELSE reqc.address END,
           'tax_number', CASE WHEN cc.requester_company_id = $1 THEN rc.tax_number ELSE reqc.tax_number END
         ) AS connected_company,

         -- الطالب
         jsonb_build_object(
           'id', reqc.id,
           'name', reqc.name,
           'phone', reqc.phone,
           'tax_number', reqc.tax_number
         ) AS requester_company,

         -- المستقبل
         jsonb_build_object(
           'id', rc.id,
           'name', rc.name,
           'phone', rc.phone,
           'tax_number', rc.tax_number
         ) AS receiver_company

       FROM company_connections cc
       JOIN companies reqc ON reqc.id = cc.requester_company_id
       JOIN companies rc ON rc.id = cc.receiver_company_id
       WHERE ${where}
       ORDER BY cc.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Count
    const countParams = params.slice(0, -2);
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM company_connections cc
       JOIN companies reqc ON reqc.id = cc.requester_company_id
       JOIN companies rc ON rc.id = cc.receiver_company_id
       WHERE ${where}`,
      countParams
    );

    const total = countRes.rows[0].total;

    return {
      items: r.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * جلب اتصال واحد (للتحقق من الصلاحية).
   */
  static async findById(companyId, connectionId) {
    const r = await pool.query(
      `SELECT *
       FROM company_connections
       WHERE id = $1
         AND (requester_company_id = $2 OR receiver_company_id = $2)`,
      [connectionId, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * هل يوجد اتصال مقبول بين شركتين؟
   */
  static async hasAcceptedConnection(companyA, companyB) {
    const r = await pool.query(
      `SELECT 1
       FROM company_connections
       WHERE (
         (requester_company_id = $1 AND receiver_company_id = $2)
         OR (requester_company_id = $2 AND receiver_company_id = $1)
       )
         AND status = 'accepted'
       LIMIT 1`,
      [companyA, companyB]
    );
    return r.rowCount > 0;
  }
}

module.exports = Connection;