const {pool} = require('../config/pool');

class SalesOrder {
  static async list(companyId, { status, customer_id, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['so.company_id = $1'];

    if (status) { params.push(status); conds.push(`so.status = $${params.length}`); }
    if (customer_id) { params.push(customer_id); conds.push(`so.customer_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`so.order_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`so.order_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT so.id, so.order_number, so.order_date, so.status,
              so.subtotal, so.tax_total, so.total,
              c.name AS customer_name, so.created_at
       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
       WHERE ${conds.join(' AND ')}
       ORDER BY so.order_date DESC, so.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM sales_orders so WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page), limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  static async findById(companyId, id) {
    const head = await pool.query(
      `SELECT so.*, c.name AS customer_name, cu.code AS currency_code
       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
       JOIN currencies cu ON cu.id = so.currency_id
       WHERE so.id = $1 AND so.company_id = $2`,
      [id, companyId]
    );
    const order = head.rows[0];
    if (!order) return null;

    const items = await pool.query(
      `SELECT soi.*, p.name AS product_name, p.sku
       FROM sales_order_items soi
       JOIN products p ON p.id = soi.product_id
       WHERE soi.order_id = $1`,
      [id]
    );
    order.items = items.rows;
    return order;
  }
}

module.exports = SalesOrder;