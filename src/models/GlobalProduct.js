const { pool } = require('../config/pool');

class GlobalProduct {
  // البحث في الدليل الموحد بالاسم، المادة الفعالة، أو الباركود
  static async search({ search, page = 1, limit = 20 }) {
    const params = [];
    const conds = [];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`(name ILIKE $${params.length} OR scientific_name ILIKE $${params.length} OR barcode ILIKE $${params.length})`);
    }

    const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT id, barcode, sku, name, scientific_name, unit, category, created_by_company_id, is_verified, created_at
       FROM global_products
       ${whereClause}
       ORDER BY name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return rows.rows;
  }

  // إضافة صنف جديد للدليل الموحد (بواسطة صيدلية أو شركة)
  static async create(companyId, data) {
    const r = await pool.query(
      `INSERT INTO global_products (barcode, sku, name, scientific_name, unit, category, created_by_company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (barcode) DO NOTHING
       RETURNING *`,
      [
        data.barcode || null,
        data.sku || null,
        data.name,
        data.scientific_name || null,
        data.unit,
        data.category || null,
        companyId
      ]
    );
    return r.rows[0] || null;
  }
}

module.exports = GlobalProduct;