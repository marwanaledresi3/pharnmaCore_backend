// models/FixedAsset.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const VALID_STATUSES = ['active', 'under_maintenance', 'disposed', 'fully_depreciated', 'inactive', 'sold', 'written_off'];
const VALID_METHODS = ['straight_line', 'declining_balance'];

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

class FixedAsset {
  static async list(companyId, filters = {}) {
    const {
      category_id, branch_id, department_id, status, search,
      page = 1, limit = 20,
    } = filters;

    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [companyId];
    const conds = ['fa.company_id = $1'];

    if (category_id) { params.push(category_id); conds.push(`fa.category_id = $${params.length}`); }
    if (branch_id) { params.push(branch_id); conds.push(`fa.branch_id = $${params.length}`); }
    if (department_id) { params.push(department_id); conds.push(`fa.department_id = $${params.length}`); }
    if (status) {
      if (!VALID_STATUSES.includes(status)) throw new ApiError(400, `حالة أصل غير صالحة: ${status}`);
      params.push(status); conds.push(`fa.status = $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(fa.name ILIKE $${p} OR fa.asset_number ILIKE $${p}
                OR COALESCE(fa.serial_number,'') ILIKE $${p}
                OR COALESCE(fa.barcode,'') ILIKE $${p})`);
    }

    const where = conds.join(' AND ');
    params.push(lm, offset);

    const { rows } = await pool.query(
      `SELECT
         fa.*,
         ac.name AS category_name, ac.code AS category_code,
         b.name AS branch_name,
         d.name AS department_name,
         e.full_name AS custodian_name
       FROM fixed_assets fa
       LEFT JOIN asset_categories ac ON ac.id = fa.category_id
       LEFT JOIN branches b ON b.id = fa.branch_id
       LEFT JOIN departments d ON d.id = fa.department_id
       LEFT JOIN employees e ON e.id = fa.custodian_employee_id
       WHERE ${where}
       ORDER BY fa.created_at DESC, fa.asset_number DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM fixed_assets fa WHERE ${where}`,
      params.slice(0, -2)
    );
    const total = countRes.rows[0].total;

    return {
      items: rows,
      pagination: { page: pg, limit: lm, total, pages: Math.ceil(total / lm) },
    };
  }

  static async findById(companyId, id, client = null) {
    const executor = client || pool;
    const { rows } = await executor.query(
      `SELECT
         fa.*,
         ac.name AS category_name, ac.code AS category_code,
         b.name AS branch_name,
         d.name AS department_name,
         e.full_name AS custodian_name,
         s.name AS supplier_name
       FROM fixed_assets fa
       LEFT JOIN asset_categories ac ON ac.id = fa.category_id
       LEFT JOIN branches b ON b.id = fa.branch_id
       LEFT JOIN departments d ON d.id = fa.department_id
       LEFT JOIN employees e ON e.id = fa.custodian_employee_id
       LEFT JOIN suppliers s ON s.id = fa.supplier_id
       WHERE fa.id = $1 AND fa.company_id = $2`,
      [id, companyId]
    );
    return rows[0] || null;
  }

  static async create(client, companyId, data) {
    const {
      asset_number, name, name_en, description,
      category_id, branch_id = null, department_id = null,
      custodian_employee_id = null, supplier_id = null,
      serial_number = null, barcode = null,
      purchase_date, depreciation_start_date = null,
      purchase_cost, salvage_value = 0,
      useful_life_years, depreciation_method = 'straight_line',
      journal_entry_id = null, notes = null, created_by = null,
    } = data;

    if (!name || !String(name).trim()) throw new ApiError(400, 'اسم الأصل الثابت مطلوب');
    const cost = round2(purchase_cost);
    if (!Number.isFinite(cost) || cost <= 0) throw new ApiError(400, 'تكلفة الشراء يجب أن تكون أكبر من صفر');
    const salvage = round2(salvage_value);
    if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost) {
      throw new ApiError(400, 'قيمة الخردة غير صالحة');
    }
    const lifeYears = Number(useful_life_years);
    if (!Number.isFinite(lifeYears) || lifeYears <= 0) {
      throw new ApiError(400, 'العمر الإنتاجي بالسنوات يجب أن يكون أكبر من صفر');
    }
    if (!VALID_METHODS.includes(depreciation_method)) {
      throw new ApiError(400, `طريقة إهلاك غير صالحة: ${depreciation_method}`);
    }

    const pDate = purchase_date || new Date().toISOString().slice(0, 10);
    const depStart = depreciation_start_date || pDate;

    const { rows } = await client.query(
      `INSERT INTO fixed_assets (
         company_id, asset_number, name, name_en, description,
         category_id, branch_id, department_id, custodian_employee_id,
         supplier_id, serial_number, barcode,
         purchase_date, depreciation_start_date,
         purchase_cost, salvage_value, accumulated_depreciation,
         useful_life_years, depreciation_method,
         status, journal_entry_id, notes, created_by
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14,
         $15, $16, 0,
         $17, $18,
         'active', $19, $20, $21
       )
       RETURNING *`,
      [
        companyId, asset_number, String(name).trim(),
        name_en ? String(name_en).trim() : null, description || null,
        category_id, branch_id, department_id, custodian_employee_id,
        supplier_id, serial_number ? String(serial_number).trim() : null,
        barcode ? String(barcode).trim() : null,
        pDate, depStart,
        cost, salvage,
        lifeYears, depreciation_method,
        journal_entry_id, notes, created_by,
      ]
    );

    return rows[0];
  }

  static async update(client, companyId, id, data) {
    const lock = await client.query(
      `SELECT * FROM fixed_assets WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (!lock.rowCount) return null;
    const ex = lock.rows[0];

    if (ex.status === 'disposed' || ex.status === 'sold' || ex.status === 'written_off') {
      throw new ApiError(400, 'لا يمكن تعديل أصل تم استبعاده أو بيعه');
    }

    const nextStatus = data.status ?? ex.status;
    if (!VALID_STATUSES.includes(nextStatus)) {
      throw new ApiError(400, `حالة أصل غير صالحة: ${nextStatus}`);
    }

    const { rows } = await client.query(
      `UPDATE fixed_assets
       SET name = $1, name_en = $2, description = $3,
           branch_id = $4, department_id = $5, custodian_employee_id = $6,
           serial_number = $7, barcode = $8, status = $9, notes = $10,
           updated_at = NOW()
       WHERE id = $11 AND company_id = $12
       RETURNING *`,
      [
        data.name !== undefined ? String(data.name).trim() : ex.name,
        data.name_en !== undefined ? (data.name_en ? String(data.name_en).trim() : null) : ex.name_en,
        data.description !== undefined ? data.description : ex.description,
        data.branch_id !== undefined ? data.branch_id : ex.branch_id,
        data.department_id !== undefined ? data.department_id : ex.department_id,
        data.custodian_employee_id !== undefined ? data.custodian_employee_id : ex.custodian_employee_id,
        data.serial_number !== undefined ? data.serial_number : ex.serial_number,
        data.barcode !== undefined ? data.barcode : ex.barcode,
        nextStatus,
        data.notes !== undefined ? data.notes : ex.notes,
        id, companyId,
      ]
    );

    return rows[0];
  }

  static async delete(client, companyId, id) {
    const lock = await client.query(
      `SELECT id, accumulated_depreciation, status
       FROM fixed_assets WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (!lock.rowCount) return null;

    const asset = lock.rows[0];
    if (Number(asset.accumulated_depreciation || 0) > 0 || asset.status === 'disposed') {
      throw new ApiError(400, 'لا يمكن حذف أصل له إهلاك مسجل أو تم استبعاده');
    }

    const del = await client.query(
      `DELETE FROM fixed_assets WHERE id = $1 AND company_id = $2 RETURNING id, asset_number`,
      [id, companyId]
    );
    return del.rows[0] || null;
  }
}

module.exports = FixedAsset;
module.exports.VALID_STATUSES = VALID_STATUSES;
module.exports.VALID_METHODS = VALID_METHODS;