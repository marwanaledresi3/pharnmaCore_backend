const {pool} = require('../config/pool');

class PurchaseOrder {
  static async list(companyId, { status, supplier_id, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['po.company_id = $1'];

    if (status) { params.push(status); conds.push(`po.status = $${params.length}`); }
    if (supplier_id) { params.push(supplier_id); conds.push(`po.supplier_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`po.order_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`po.order_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT po.id, po.order_number, po.order_date, po.status,
              po.subtotal, po.tax_total, po.total,
              s.name AS supplier_name, po.created_at
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE ${conds.join(' AND ')}
       ORDER BY po.order_date DESC, po.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM purchase_orders po WHERE ${conds.join(' AND ')}`,
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
      `SELECT po.*, s.name AS supplier_name, cu.code AS currency_code
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN currencies cu ON cu.id = po.currency_id
       WHERE po.id = $1 AND po.company_id = $2`,
      [id, companyId]
    );
    const order = head.rows[0];
    if (!order) return null;

    const items = await pool.query(
      `SELECT poi.*, p.name AS product_name, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1`,
      [id]
    );
    order.items = items.rows;
    return order;
  }

  static async nextNumber(client, companyId) {
    const r = await client.query(
      `SELECT COUNT(*)::int + 1 AS next FROM purchase_orders WHERE company_id = $1`,
      [companyId]
    );
    return `PO-${String(r.rows[0].next).padStart(5, '0')}`;
  }
}

module.exports = PurchaseOrder;