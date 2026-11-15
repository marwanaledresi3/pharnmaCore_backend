// models/ProductUnit.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

class ProductUnit {
  /**
   * قائمة وحدات منتج.
   */
  static async listByProduct(companyId, productId) {
    // تحقق من أن المنتج تابع للشركة
    const p = await pool.query(
      `SELECT id FROM products WHERE id = $1 AND company_id = $2`,
      [productId, companyId]
    );
    if (!p.rowCount) throw new ApiError(404, 'Product not found');

    const r = await pool.query(
      `SELECT pu.id, pu.unit_id, pu.conversion_factor, pu.is_base_unit,
              pu.sale_price, pu.purchase_price, pu.barcode,
              u.code, u.name, u.name_en
       FROM product_units pu
       JOIN units u ON u.id = pu.unit_id
       WHERE pu.product_id = $1
       ORDER BY pu.is_base_unit DESC, u.name`,
      [productId]
    );
    return r.rows;
  }

  /**
   * إضافة وحدة لمنتج.
   * - لا يسمح بإضافة وحدة أساسية ثانية.
   * - conversion_factor > 0.
   * - unit_id يجب أن يكون في نفس الشركة.
   */
  static async create(companyId, productId, data) {
    // تحقق من المنتج
    const p = await pool.query(
      `SELECT id, selling_price, cost_price FROM products
       WHERE id = $1 AND company_id = $2`,
      [productId, companyId]
    );
    if (!p.rowCount) throw new ApiError(404, 'Product not found');

    // تحقق من الوحدة
    const u = await pool.query(
      `SELECT id FROM units WHERE id = $1 AND company_id = $2`,
      [data.unit_id, companyId]
    );
    if (!u.rowCount) throw new ApiError(400, `Unit ${data.unit_id} not found`);

    // إذا is_base_unit = TRUE → تحقق من عدم وجود أساسية أخرى
    if (data.is_base_unit === true) {
      const existing = await pool.query(
        `SELECT 1 FROM product_units WHERE product_id = $1 AND is_base_unit = TRUE`,
        [productId]
      );
      if (existing.rowCount) {
        throw new ApiError(400, 'Product already has a base unit');
      }
      // يجب أن يكون factor = 1
      if (Number(data.conversion_factor) !== 1) {
        throw new ApiError(400, 'Base unit must have conversion_factor = 1');
      }
    }

    // factor > 0
    const factor = Number(data.conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new ApiError(400, 'conversion_factor must be > 0');
    }

    const r = await pool.query(
      `INSERT INTO product_units
         (product_id, unit_id, conversion_factor, is_base_unit, sale_price, purchase_price, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, unit_id, conversion_factor, is_base_unit, sale_price, purchase_price, barcode`,
      [
        productId,
        data.unit_id,
        factor,
        data.is_base_unit === true,
        data.sale_price != null ? Number(data.sale_price) : null,
        data.purchase_price != null ? Number(data.purchase_price) : null,
        data.barcode || null,
      ]
    );
    return r.rows[0];
  }

  /**
   * تعديل وحدة (factor، أسعار، باركود).
   */
  static async update(companyId, productId, id, data) {
    const pu = await pool.query(
      `SELECT pu.id, pu.is_base_unit
       FROM product_units pu
       JOIN products p ON p.id = pu.product_id
       WHERE pu.id = $1 AND pu.product_id = $2 AND p.company_id = $3`,
      [id, productId, companyId]
    );
    if (!pu.rowCount) throw new ApiError(404, 'Product unit not found');

    const fields = [];
    const params = [];

    if (data.conversion_factor !== undefined) {
      const factor = Number(data.conversion_factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new ApiError(400, 'conversion_factor must be > 0');
      }
      if (pu.rows[0].is_base_unit && factor !== 1) {
        throw new ApiError(400, 'Base unit must have conversion_factor = 1');
      }
      params.push(factor);
      fields.push(`conversion_factor = $${params.length}`);
    }
    if (data.sale_price !== undefined) {
      params.push(data.sale_price != null ? Number(data.sale_price) : null);
      fields.push(`sale_price = $${params.length}`);
    }
    if (data.purchase_price !== undefined) {
      params.push(data.purchase_price != null ? Number(data.purchase_price) : null);
      fields.push(`purchase_price = $${params.length}`);
    }
    if (data.barcode !== undefined) {
      params.push(data.barcode || null);
      fields.push(`barcode = $${params.length}`);
    }

    if (!fields.length) return null;

    params.push(id);
    const r = await pool.query(
      `UPDATE product_units SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, unit_id, conversion_factor, is_base_unit, sale_price, purchase_price, barcode`,
      params
    );
    return r.rows[0] || null;
  }

  /**
   * حذف وحدة.
   * - لا يسمح بحذف الوحدة الأساسية.
   * - لا يسمح بالحذف إذا كانت مستخدمة في بنود.
   */
  static async delete(companyId, productId, id) {
    const pu = await pool.query(
      `SELECT pu.id, pu.unit_id, pu.is_base_unit
       FROM product_units pu
       JOIN products p ON p.id = pu.product_id
       WHERE pu.id = $1 AND pu.product_id = $2 AND p.company_id = $3`,
      [id, productId, companyId]
    );
    if (!pu.rowCount) throw new ApiError(404, 'Product unit not found');
    if (pu.rows[0].is_base_unit) {
      throw new ApiError(400, 'Cannot delete base unit');
    }

    // هل الوحدة مستخدمة في بنود؟
    const used = await pool.query(
      `SELECT 1 FROM sales_order_items WHERE unit_id = $1 LIMIT 1
       UNION ALL
       SELECT 1 FROM purchase_order_items WHERE unit_id = $1 LIMIT 1
       UNION ALL
       SELECT 1 FROM invoice_items WHERE unit_id = $1 LIMIT 1
       UNION ALL
       SELECT 1 FROM return_items WHERE unit_id = $1 LIMIT 1
       LIMIT 1`,
      [pu.rows[0].unit_id]
    );
    if (used.rowCount) {
      throw new ApiError(400, 'Cannot delete unit: used in orders/invoices');
    }

    await pool.query(`DELETE FROM product_units WHERE id = $1`, [id]);
    return true;
  }
}

module.exports = ProductUnit;