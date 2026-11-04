const { pool } = require('../config/pool');

class Branch {
  static async list(companyId, { is_active, search, sort = 'is_main', order = 'desc', page = 1, limit = 20 }) {
  const params = [companyId];
  const conds = ['b.company_id = $1'];

  if (is_active !== undefined) {
    params.push(is_active);
    conds.push(`b.is_active = $${params.length}`);
  }

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const i = params.length;
    conds.push(`(b.name ILIKE $${i} OR b.code ILIKE $${i} OR b.manager_name ILIKE $${i})`);
  }

  // فرز آمن عبر allow-list
  const SORTABLE = {
    name: 'b.name',
    code: 'b.code',
    is_main: 'b.is_main',
    is_active: 'b.is_active',
    created_at: 'b.created_at',
  };
  const sortCol = SORTABLE[sort] ?? 'b.is_main';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const offset = (Number(page) - 1) * Number(limit);
  params.push(limit, offset);

  const rows = await pool.query(
    `SELECT b.*, w.name AS warehouse_name
     FROM branches b
     LEFT JOIN warehouses w ON w.id = b.warehouse_id
     WHERE ${conds.join(' AND ')}
     ORDER BY ${sortCol} ${sortDir}, b.name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM branches b WHERE ${conds.join(' AND ')}`,
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

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT b.*, w.name AS warehouse_name
       FROM branches b
       LEFT JOIN warehouses w ON w.id = b.warehouse_id
       WHERE b.id = $1 AND b.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
  const isMain = data.is_main === true;

  // إن كان رئيسياً، ألغِ تعيين الرئيسي السابق (قبل الإدراج، داخل نفس transaction)
  if (isMain) {
    await client.query(
      `UPDATE branches
       SET is_main = FALSE, updated_at = NOW()
       WHERE company_id = $1 AND is_main = TRUE`,
      [companyId]
    );
  }

  const r = await client.query(
    `INSERT INTO branches
       (company_id, name, code, address, phone, email, manager_name,
        warehouse_id, is_active, is_main)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      companyId,
      data.name,
      data.code || null,
      data.address || null,
      data.phone || null,
      data.email || null,
      data.manager_name || null,
      data.warehouse_id || null,
      data.is_active ?? true,
      isMain,
    ]
  );

  // إن لم يوجد أي فرع رئيسي بعد (أول فرع)، اجعله رئيسياً تلقائياً
  if (!isMain) {
    const { rows } = await client.query(
      `SELECT 1 FROM branches WHERE company_id = $1 AND is_main = TRUE LIMIT 1`,
      [companyId]
    );
    if (rows.length === 0) {
      const upd = await client.query(
        `UPDATE branches SET is_main = TRUE, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [r.rows[0].id]
      );
      return upd.rows[0];
    }
  }

  return r.rows[0];
}

  static async update(client, companyId, id, data) {
  // 1) إن كان الطلب يريد جعل هذا الفرع رئيسياً → ألغِ تعيين الرئيسي الآخر أولاً
  if (data.is_main === true) {
    await client.query(
      `UPDATE branches
       SET is_main = FALSE, updated_at = NOW()
       WHERE company_id = $1 AND is_main = TRUE AND id <> $2`,
      [companyId, id]
    );
  }

  // 2) إن كان الطلب يريد إلغاء تعيين هذا الفرع كرئيسي → امنع إن كان الوحيد
  if (data.is_main === false) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS mains
       FROM branches
       WHERE company_id = $1 AND is_main = TRUE`,
      [companyId]
    );
    const mains = rows[0].mains;
    if (mains <= 1) {
      throw new Error('لا يمكن إلغاء تعيين الفرع الرئيسي الوحيد. عيّن فرعاً رئيسياً آخر أولاً.');
    }
  }

  // 3) تحديث الحقول
  const r = await client.query(
    `UPDATE branches
     SET name         = COALESCE($1, name),
         code         = COALESCE($2, code),
         address      = COALESCE($3, address),
         phone        = COALESCE($4, phone),
         email        = COALESCE($5, email),
         manager_name = COALESCE($6, manager_name),
         warehouse_id = COALESCE($7, warehouse_id),
         is_active    = COALESCE($8, is_active),
         is_main      = COALESCE($9, is_main),
         updated_at   = NOW()
     WHERE id = $10 AND company_id = $11
     RETURNING *`,
    [
      data.name,
      data.code,
      data.address,
      data.phone,
      data.email,
      data.manager_name,
      data.warehouse_id,
      data.is_active,
      data.is_main, // null → يبقى كما هو
      id,
      companyId,
    ]
  );
  return r.rows[0] || null;
}

  static async delete(client, companyId, id) {
    const r = await client.query(
      `DELETE FROM branches WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }
}

module.exports = Branch;