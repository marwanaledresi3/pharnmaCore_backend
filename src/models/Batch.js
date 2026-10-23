const {pool} = require('../config/pool');

class Batch {
  static async list(companyId, { product_id, warehouse_id, expiring_soon, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['b.company_id = $1'];

    if (product_id) { params.push(product_id); conds.push(`b.product_id = $${params.length}`); }
    if (warehouse_id) { params.push(warehouse_id); conds.push(`b.warehouse_id = $${params.length}`); }
    if (expiring_soon) {
      conds.push(`b.expiry_date <= CURRENT_DATE + INTERVAL '30 days'`);
      conds.push(`b.quantity > 0`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT b.id, b.product_id, p.name AS product_name, p.sku,
              b.warehouse_id, w.name AS warehouse_name,
              b.batch_number, b.expiry_date, b.cost_price, b.quantity, b.created_at
       FROM product_batches b
       JOIN products p ON p.id = b.product_id
       JOIN warehouses w ON w.id = b.warehouse_id
       WHERE ${conds.join(' AND ')}
       ORDER BY b.expiry_date ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return rows.rows;
  }

  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO product_batches
         (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, batch_number, quantity, expiry_date, cost_price`,
      [companyId, data.product_id, data.warehouse_id, data.batch_number,
       data.expiry_date, data.cost_price || 0, data.quantity]
    );
    return r.rows[0];
  }
}

module.exports = Batch;