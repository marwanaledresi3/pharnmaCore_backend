// models/AssetCategory.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

const VALID_METHODS = ['straight_line', 'declining_balance'];

class AssetCategory {
  static async list(companyId, { is_active, search } = {}) {
    const params = [companyId];
    const conds = ['ac.company_id = $1'];

    if (is_active !== undefined) {
      params.push(is_active === true || is_active === 'true');
      conds.push(`ac.is_active = $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(ac.name ILIKE $${p} OR ac.code ILIKE $${p} OR ac.description ILIKE $${p})`);
    }

    const { rows } = await pool.query(
      `SELECT
         ac.*,
         aa.code AS asset_account_code, aa.name AS asset_account_name,
         da.code AS accumulated_depreciation_account_code, da.name AS accumulated_depreciation_account_name,
         ea.code AS expense_account_code, ea.name AS expense_account_name,
         (SELECT COUNT(*)::int FROM fixed_assets fa WHERE fa.category_id = ac.id) AS assets_count
       FROM asset_categories ac
       LEFT JOIN chart_of_accounts aa ON aa.id = ac.asset_account_id
       LEFT JOIN chart_of_accounts da ON da.id = ac.accumulated_depreciation_account_id
       LEFT JOIN chart_of_accounts ea ON ea.id = ac.depreciation_expense_account_id
       WHERE ${conds.join(' AND ')}
       ORDER BY ac.code ASC NULLS LAST, ac.name ASC`,
      params
    );

    return rows;
  }

  static async findById(companyId, id, client = null) {
    const executor = client || pool;
    const { rows } = await executor.query(
      `SELECT
         ac.*,
         aa.code AS asset_account_code, aa.name AS asset_account_name,
         da.code AS accumulated_depreciation_account_code, da.name AS accumulated_depreciation_account_name,
         ea.code AS expense_account_code, ea.name AS expense_account_name
       FROM asset_categories ac
       LEFT JOIN chart_of_accounts aa ON aa.id = ac.asset_account_id
       LEFT JOIN chart_of_accounts da ON da.id = ac.accumulated_depreciation_account_id
       LEFT JOIN chart_of_accounts ea ON ea.id = ac.depreciation_expense_account_id
       WHERE ac.id = $1 AND ac.company_id = $2`,
      [id, companyId]
    );
    return rows[0] || null;
  }

  static async create(client, companyId, data) {
    const {
      name,
      code,
      description,
      depreciation_method = 'straight_line',
      useful_life_years,
      salvage_value_percent = 0,
      asset_account_id = null,
      accumulated_depreciation_account_id = null,
      depreciation_expense_account_id = null,
      is_active = true,
    } = data;

    if (!name || !String(name).trim()) {
      throw new ApiError(400, 'اسم تصنيف الأصل مطلوب');
    }
    if (!VALID_METHODS.includes(depreciation_method)) {
      throw new ApiError(400, `طريقة إهلاك غير صالحة: ${depreciation_method}`);
    }
    const lifeYears = Number(useful_life_years);
    if (!Number.isFinite(lifeYears) || lifeYears <= 0) {
      throw new ApiError(400, 'العمر الإنتاجي بالسنوات يجب أن يكون أكبر من صفر');
    }

    const { rows } = await client.query(
      `INSERT INTO asset_categories (
         company_id, name, code, description, depreciation_method,
         useful_life_years, salvage_value_percent,
         asset_account_id, accumulated_depreciation_account_id,
         depreciation_expense_account_id, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        companyId,
        String(name).trim(),
        code ? String(code).trim() : null,
        description || null,
        depreciation_method,
        lifeYears,
        Number(salvage_value_percent) || 0,
        asset_account_id,
        accumulated_depreciation_account_id,
        depreciation_expense_account_id,
        Boolean(is_active),
      ]
    );

    return rows[0];
  }

  static async update(client, companyId, id, data) {
    const lock = await client.query(
      `SELECT * FROM asset_categories WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (!lock.rowCount) return null;
    const ex = lock.rows[0];

    const method = data.depreciation_method ?? ex.depreciation_method;
    if (!VALID_METHODS.includes(method)) {
      throw new ApiError(400, `طريقة إهلاك غير صالحة: ${method}`);
    }

    const lifeYears = data.useful_life_years !== undefined
      ? Number(data.useful_life_years)
      : Number(ex.useful_life_years);
    if (!Number.isFinite(lifeYears) || lifeYears <= 0) {
      throw new ApiError(400, 'العمر الإنتاجي بالسنوات يجب أن يكون أكبر من صفر');
    }

    const { rows } = await client.query(
      `UPDATE asset_categories
       SET name = $1,
           code = $2,
           description = $3,
           depreciation_method = $4,
           useful_life_years = $5,
           salvage_value_percent = $6,
           asset_account_id = $7,
           accumulated_depreciation_account_id = $8,
           depreciation_expense_account_id = $9,
           is_active = $10,
           updated_at = NOW()
       WHERE id = $11 AND company_id = $12
       RETURNING *`,
      [
        data.name !== undefined ? String(data.name).trim() : ex.name,
        data.code !== undefined ? (data.code ? String(data.code).trim() : null) : ex.code,
        data.description !== undefined ? data.description : ex.description,
        method,
        lifeYears,
        data.salvage_value_percent !== undefined ? Number(data.salvage_value_percent) : ex.salvage_value_percent,
        data.asset_account_id !== undefined ? data.asset_account_id : ex.asset_account_id,
        data.accumulated_depreciation_account_id !== undefined
          ? data.accumulated_depreciation_account_id
          : ex.accumulated_depreciation_account_id,
        data.depreciation_expense_account_id !== undefined
          ? data.depreciation_expense_account_id
          : ex.depreciation_expense_account_id,
        data.is_active !== undefined ? Boolean(data.is_active) : ex.is_active,
        id,
        companyId,
      ]
    );

    return rows[0];
  }

  static async delete(client, companyId, id) {
    const inUse = await client.query(
      `SELECT 1 FROM fixed_assets WHERE category_id = $1 AND company_id = $2 LIMIT 1`,
      [id, companyId]
    );
    if (inUse.rowCount) {
      throw new ApiError(400, 'لا يمكن حذف تصنيف مرتبط بأصول ثابتة');
    }

    const res = await client.query(
      `DELETE FROM asset_categories WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return res.rowCount > 0;
  }
}

module.exports = AssetCategory;