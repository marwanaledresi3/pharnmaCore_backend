const {pool} = require('../config/pool');

class Product {

  static async list(companyId, { search, is_active, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['p.company_id = $1'];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`p.is_active = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT p.id, p.sku, p.barcode, p.name, p.unit,
              p.category, p.cost_price, p.selling_price,
              p.tax_rate_id, p.min_stock_level, p.is_active, p.created_at,
              tr.name AS tax_rate_name, tr.rate AS tax_rate_value,
              COALESCE((SELECT SUM(quantity) FROM product_batches
                        WHERE product_id = p.id AND quantity > 0), 0)::numeric AS current_stock
      FROM products p
      LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
      WHERE ${conds.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM products p WHERE ${conds.join(' AND ')}`,
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
      `SELECT id, sku, barcode, name, unit,
              category, cost_price, selling_price,
              tax_rate_id, revenue_account_id, inventory_account_id, cogs_account_id,
              min_stock_level, is_active, created_at
      FROM products WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO products
        (company_id, sku, barcode, name, unit, category, cost_price, selling_price,
          tax_rate_id, revenue_account_id, inventory_account_id, cogs_account_id, min_stock_level)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, sku, barcode, name, unit, category, cost_price, selling_price,
                is_active, created_at`,
      [
        companyId, data.sku, data.barcode || null, data.name, data.unit,
        data.category || null, data.cost_price || 0, data.selling_price || 0,
        data.tax_rate_id || null,
        data.revenue_account_id || null,
        data.inventory_account_id || null,
        data.cogs_account_id || null,
        data.min_stock_level || 0,
      ]
    );
    return r.rows[0];
  }

  static async update(companyId, id, payload) {
    const allowed = ['sku', 'barcode', 'name', 'unit', 'category',
                    'cost_price', 'selling_price', 'tax_rate_id',
                    'revenue_account_id', 'inventory_account_id', 'cogs_account_id',
                    'min_stock_level', 'is_active'];
    const fields = [];
    const params = [];
    for (const k of allowed) {
      if (payload[k] !== undefined) {
        params.push(payload[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return null;
    params.push(id, companyId);
    const r = await pool.query(
      `UPDATE products SET ${fields.join(', ')}
      WHERE id = $${params.length - 1} AND company_id = $${params.length}
      RETURNING id, sku, name, unit, category, cost_price, selling_price, is_active`,
      params
    );
    return r.rows[0] || null;
  }

  static async existsBySku(companyId, sku) {
    const r = await pool.query(
      `SELECT 1 FROM products WHERE company_id = $1 AND sku = $2 LIMIT 1`,
      [companyId, sku]
    );
    return r.rowCount > 0;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM products WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * حساب المخزون الحالي (مجموع كميات الـ batches)
   */
  static async getStock(companyId, productId) {
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(b.quantity), 0)::numeric AS total_quantity,
         json_agg(json_build_object(
           'warehouse_id', b.warehouse_id,
           'warehouse_name', w.name,
           'batch_id', b.id,
           'batch_number', b.batch_number,
           'expiry_date', b.expiry_date,
           'quantity', b.quantity
         )) FILTER (WHERE b.quantity > 0) AS batches
       FROM product_batches b
       JOIN warehouses w ON w.id = b.warehouse_id
       WHERE b.product_id = $1 AND b.company_id = $2
       GROUP BY b.product_id`,
      [productId, companyId]
    );
    if (!r.rowCount) return { total_quantity: 0, batches: [] };
    return r.rows[0];
  }
}

module.exports = Product;