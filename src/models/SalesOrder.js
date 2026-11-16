// models/SalesOrder.js
const { pool } = require('../config/pool');

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

class SalesOrder {
  /**
   * قائمة أوامر البيع مع الفلاتر والترقيم.
   */
  static async list(companyId, {
    status,
    customer_id,
    warehouse_id,
    cash_register_id, // ← جديد
    date_from,
    date_to,
    search,
    has_journal_entry,
    page = 1,
    limit = 20,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [companyId];
    const conds = ['so.company_id = $1'];

    if (status) {
      params.push(status);
      conds.push(`so.status = $${params.length}`);
    }
    if (customer_id) {
      params.push(customer_id);
      conds.push(`so.customer_id = $${params.length}`);
    }
    if (warehouse_id) {
      params.push(warehouse_id);
      conds.push(`so.warehouse_id = $${params.length}`);
    }
    if (cash_register_id) {
      params.push(cash_register_id);
      conds.push(`so.cash_register_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`so.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`so.order_date <= $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        so.order_number ILIKE $${p}
        OR c.name ILIKE $${p}
        OR c.code ILIKE $${p}
      )`);
    }
    if (has_journal_entry === true) {
      conds.push(`so.journal_entry_id IS NOT NULL`);
    } else if (has_journal_entry === false) {
      conds.push(`so.journal_entry_id IS NULL`);
    }

    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT
         so.id,
         so.order_number,
         so.order_date,
         so.status,

         so.payment_type,
         so.payment_method,
         so.paid_amount,

         so.currency_id,
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,
         so.exchange_rate,

         so.subtotal,
         so.tax_total,
         so.total,

         so.customer_id,
         c.name AS customer_name,
         c.code AS customer_code,

         so.warehouse_id,
         w.name AS warehouse_name,

         so.cash_register_id,
         cr.name AS cash_register_name,
         cr.code AS cash_register_code,

         so.journal_entry_id,

         so.created_by,
         u.name AS created_by_name,

         (SELECT COUNT(*)::int
          FROM sales_order_items soi
          WHERE soi.order_id = so.id) AS items_count,

         so.created_at,
         so.updated_at

       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
       JOIN currencies cu ON cu.id = so.currency_id
       LEFT JOIN warehouses w ON w.id = so.warehouse_id
       LEFT JOIN cash_registers cr ON cr.id = so.cash_register_id
       LEFT JOIN users u ON u.id = so.created_by
       WHERE ${conds.join(' AND ')}
       ORDER BY so.order_date DESC, so.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
       WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;
    return {
      items: rows.rows,
      pagination: {
        page: pg,
        limit: lm,
        total,
        pages: Math.ceil(total / lm),
      },
    };
  }

  /**
   * تفاصيل أمر بيع واحد + البنود.
   */
  static async findById(companyId, id) {
    const head = await pool.query(
      `SELECT
         so.*,
         c.name      AS customer_name,
         c.code      AS customer_code,
         cu.code     AS currency_code,
         cu.symbol   AS currency_symbol,
         u.name      AS created_by_name,
         w.name      AS warehouse_name,
         w.code      AS warehouse_code,
         cr.name     AS cash_register_name,
         cr.code     AS cash_register_code
       FROM sales_orders so
       JOIN customers c ON c.id = so.customer_id
       JOIN currencies cu ON cu.id = so.currency_id
       LEFT JOIN warehouses w ON w.id = so.warehouse_id
       LEFT JOIN cash_registers cr ON cr.id = so.cash_register_id
       LEFT JOIN users u ON u.id = so.created_by
       WHERE so.id = $1 AND so.company_id = $2`,
      [id, companyId]
    );
    const order = head.rows[0];
    if (!order) return null;

    const items = await pool.query(
      `SELECT
         soi.*,
         p.name AS product_name,
         p.sku,
         u.code AS unit_code,
         u.name AS unit_name
       FROM sales_order_items soi
       JOIN products p ON p.id = soi.product_id
       LEFT JOIN units u ON u.id = soi.unit_id
       WHERE soi.order_id = $1
       ORDER BY soi.id`,
      [id]
    );
    order.items = items.rows;
    return order;
  }
}

module.exports = SalesOrder;