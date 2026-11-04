const { pool } = require('../config/pool');

class PurchaseOrder {
  static async list(companyId, { status, supplier_id, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['po.company_id = $1'];

    if (status) { params.push(status); conds.push(`po.status = $${params.length}`); }
    if (supplier_id) { params.push(supplier_id); conds.push(`po.supplier_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`po.order_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`po.order_date <= $${params.length}`); }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    params.push(safeLimit, offset);

    const rows = await pool.query(
      `SELECT po.id, po.order_number, po.order_date, po.status,
              po.subtotal, po.tax_total, po.total,
              po.supplier_invoice_number, po.supplier_invoice_date,
              s.name AS supplier_name, po.supplier_id, po.created_at
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
        page: safePage,
        limit: safeLimit,
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / safeLimit),
      },
    };
  }

  /**
   * جلب أمر شراء للمشتري أو للمورد (حسب سياق الشركة).
   * - إذا كانت companyId = buyer → تُرجع الطلب.
   * - إذا كانت companyId = supplier (شبكي) → تُرجع الطلب أيضاً عبر supplier_company_id.
   */
  static async findById(companyId, id) {
    const head = await pool.query(
      `SELECT po.*, s.name AS supplier_name, cu.code AS currency_code
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN currencies cu ON cu.id = po.currency_id
       WHERE po.id = $1
         AND (po.company_id = $2 OR po.supplier_company_id = $2)`,
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

  /**
   * توليد رقم أمر شراء آمن تحت التزامن.
   * - نستخدم عمود counter في جدول company_sequences (يُنشأ تلقائياً إن لم يوجد).
   * - بديل: قفل صف على counter موجود.
   * - إن لم يوجد جدول counter، نرجع إلى COUNT(*) + 1 مع قفل الجدول — أقل كفاءة لكن آمن.
   */
  static async nextNumber(client, companyId) {
    // المحاولة الأولى: جدول عدّاد مخصص
    try {
      await client.query(
        `INSERT INTO company_sequences (company_id, seq_name, next_value)
         VALUES ($1, 'purchase_order', 1)
         ON CONFLICT (company_id, seq_name) DO NOTHING`,
        [companyId]
      );

      const upd = await client.query(
        `UPDATE company_sequences
         SET next_value = next_value + 1
         WHERE company_id = $1 AND seq_name = 'purchase_order'
         RETURNING next_value - 1 AS current`,
        [companyId]
      );

      const n = Number(upd.rows[0].current);
      return `PO-${String(n).padStart(5, '0')}`;
    } catch (err) {
      // جدول العدّاد غير موجود → fallback بقفل على الجدول
      if (err.code !== '42P01' /* undefined_table */) throw err;

      await client.query('LOCK TABLE purchase_orders IN SHARE ROW EXCLUSIVE MODE');
      const r = await client.query(
        `SELECT COUNT(*)::int + 1 AS next FROM purchase_orders WHERE company_id = $1`,
        [companyId]
      );
      return `PO-${String(r.rows[0].next).padStart(5, '0')}`;
    }
  }
  static async getIncoming  (companyId){
    const result = await pool.query(
      `SELECT po.id,
              po.company_id AS buyer_company_id,
              bc.name AS buyer_company_name,   
              po.order_number,
              po.order_date,
              po.currency_id,
              po.exchange_rate,
              po.subtotal, po.tax_total, po.total,
              po.status, po.created_at
      FROM purchase_orders po
      JOIN companies bc ON bc.id = po.company_id  
      WHERE po.supplier_company_id = $1
        AND po.status = 'pending_approval'
      ORDER BY po.created_at DESC`,
      [companyId]
    );
    return result.rows;
  }
}

module.exports = PurchaseOrder;