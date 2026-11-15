
const { pool } = require('../config/pool');

class UnitsModel {
  // GET: قائمة الوحدات
  static async findAll(companyId, { search, is_active } = {}) {
    const params = [companyId];
    const conds = ['company_id = $1'];

    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`is_active = $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;

      conds.push(`(
        code ILIKE $${p}
        OR name ILIKE $${p}
        OR name_en ILIKE $${p}
      )`);
    }

    const { rows } = await pool.query(
      `SELECT id, code, name, name_en, is_active, created_at
       FROM units
       WHERE ${conds.join(' AND ')}
       ORDER BY name ASC`,
      params
    );

    return rows;
  }

  // GET: وحدة واحدة
  static async findById(id, companyId) {
    const { rows } = await pool.query(
      `SELECT id, code, name, name_en, is_active, created_at
       FROM units
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    return rows[0] || null;
  }

  // POST: التحقق من تكرار الوحدة
  static async findDuplicate(companyId, code, name) {
    const { rowCount } = await pool.query(
      `SELECT 1
       FROM units
       WHERE company_id = $1
       AND (code = $2 OR name = $3)
       LIMIT 1`,
      [companyId, code, name]
    );

    return rowCount > 0;
  }

  // POST: إنشاء وحدة
  static async create(companyId, { code, name, name_en }) {
    const { rows } = await pool.query(
      `INSERT INTO units (
        company_id, code, name, name_en, is_active
      )
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING id, code, name, name_en, is_active, created_at`,
      [companyId, code, name, name_en || null]
    );

    return rows[0];
  }

  // PATCH: تعديل وحدة
  static async update(id, companyId, data) {
    const fields = [];
    const params = [];

    if (data.code !== undefined) {
      params.push(String(data.code).trim());
      fields.push(`code = $${params.length}`);
    }

    if (data.name !== undefined) {
      params.push(String(data.name).trim());
      fields.push(`name = $${params.length}`);
    }

    if (data.name_en !== undefined) {
      params.push(data.name_en
        ? String(data.name_en).trim()
        : null);
      fields.push(`name_en = $${params.length}`);
    }

    if (data.is_active !== undefined) {
      params.push(data.is_active);
      fields.push(`is_active = $${params.length}`);
    }

    if (!fields.length) return null;

    params.push(id, companyId);

    const { rows } = await pool.query(
      `UPDATE units
       SET ${fields.join(', ')}
       WHERE id = $${params.length - 1}
       AND company_id = $${params.length}
       RETURNING id, code, name, name_en, is_active, created_at`,
      params
    );

    return rows[0] || null;
  }

  // DELETE: التحقق من استخدام الوحدة
  static async isUsed(id, companyId) {
    const { rowCount } = await pool.query(
      `SELECT 1
       FROM product_units pu
       JOIN products p ON p.id = pu.product_id
       WHERE pu.unit_id = $1
       AND p.company_id = $2
       LIMIT 1`,
      [id, companyId]
    );

    return rowCount > 0;
  }

  // DELETE: حذف الوحدة
  static async delete(id, companyId) {
    const { rows } = await pool.query(
      `DELETE FROM units
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [id, companyId]
    );

    return rows[0] || null;
  }
}

module.exports = UnitsModel;
