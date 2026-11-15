// models/PurchaseOrder.js
const { pool } = require('../config/pool');

class PurchaseOrder {

  /**
   * قائمة أوامر الشراء مع الفلاتر والترقيم.
   *
   * الفلاتر المدعومة:
   * - status: draft | pending_approval | approved | rejected | confirmed | cancelled
   * - supplier_id: uuid
   * - supplier_company_id: uuid (للطلبات الشبكية)
   * - date_from, date_to: YYYY-MM-DD
   * - payment_type: cash | credit | partial
   * - payment_method: cash | bank | cheque | card | wallet | other
   * - search: بحث في order_number, supplier_invoice_number, supplier_name
   * - is_overdue: true → الطلبات الآجلة المتأخرة
   * - page, limit
   */
  static async list(companyId, {
    status,
    supplier_id,
    supplier_company_id,
    date_from,
    date_to,
    payment_type,
    payment_method,
    search,
    is_overdue,
    page = 1,
    limit = 20,
  } = {}) {
    const params = [companyId];
    const conds = ['po.company_id = $1'];

    if (status) {
      params.push(status);
      conds.push(`po.status = $${params.length}`);
    }
    if (supplier_id) {
      params.push(supplier_id);
      conds.push(`po.supplier_id = $${params.length}`);
    }
    if (supplier_company_id) {
      params.push(supplier_company_id);
      conds.push(`po.supplier_company_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`po.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`po.order_date <= $${params.length}`);
    }
    if (payment_type) {
      params.push(payment_type);
      conds.push(`po.payment_type = $${params.length}`);
    }
    if (payment_method) {
      params.push(payment_method);
      conds.push(`po.payment_method = $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        po.order_number ILIKE $${p}
        OR po.supplier_invoice_number ILIKE $${p}
        OR s.name ILIKE $${p}
        OR sc.name ILIKE $${p}
      )`);
    }
    if (is_overdue === true) {
      conds.push(`po.due_date IS NOT NULL
                  AND po.due_date < CURRENT_DATE
                  AND po.paid_amount < po.total - 0.01
                  AND po.status IN ('approved', 'confirmed')`);
    } else if (is_overdue === false) {
      conds.push(`(po.due_date IS NULL
                  OR po.due_date >= CURRENT_DATE
                  OR po.paid_amount >= po.total - 0.01
                  OR po.status NOT IN ('approved', 'confirmed'))`);
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    params.push(safeLimit, offset);

    const rows = await pool.query(
      `SELECT
         po.id,
         po.order_number,
         po.order_date,
         po.status,

         -- العملة
         po.currency_id,
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,

         -- المبالغ
         po.subtotal,
         po.tax_total,
         po.total,
         po.exchange_rate,

         -- المورد
         po.supplier_id,
         s.name AS supplier_name,
         po.supplier_company_id,
         sc.name AS supplier_company_name,

         -- الدفع
         po.payment_type,
         po.payment_method,
         po.payment_terms_days,
         po.due_date,
         po.paid_amount,
         po.paid_at,

         -- فاتورة المورد الورقية
         po.supplier_invoice_number,
         po.supplier_invoice_date,

         -- الموافقة/الرفض
         po.approved_by,
         po.approved_at,
         po.rejected_by,
         po.rejected_at,
         po.rejection_reason,

         -- المنشئ
         po.created_by,
         u.name AS created_by_name,

         -- طوابع زمنية
         po.created_at,
         po.updated_at,

         -- مؤشر التأخر (اختياري — للواجهة)
         CASE
           WHEN po.due_date IS NOT NULL
             AND po.due_date < CURRENT_DATE
             AND po.paid_amount < po.total - 0.01
             AND po.status IN ('approved', 'confirmed')
           THEN TRUE
           ELSE FALSE
         END AS is_overdue

       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN companies sc ON sc.id = po.supplier_company_id
       LEFT JOIN currencies cu ON cu.id = po.currency_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE ${conds.join(' AND ')}
       ORDER BY po.order_date DESC, po.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN companies sc ON sc.id = po.supplier_company_id
       WHERE ${conds.join(' AND ')}`,
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
      `SELECT po.*,
              s.name AS supplier_name,
              sc.name AS supplier_company_name,
              cu.code AS currency_code,
              cu.symbol AS currency_symbol,
              u.name AS created_by_name,
              bc.name AS buyer_company_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN currencies cu ON cu.id = po.currency_id
       LEFT JOIN companies sc ON sc.id = po.supplier_company_id
       LEFT JOIN companies bc ON bc.id = po.company_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE po.id = $1
         AND (po.company_id = $2 OR po.supplier_company_id = $2)`,
      [id, companyId]
    );
    const order = head.rows[0];
    if (!order) return null;

    const items = await pool.query(
      `SELECT poi.*, p.name AS product_name, p.sku,
              u.code AS unit_code, u.name AS unit_name
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       LEFT JOIN units u ON u.id = poi.unit_id
       WHERE poi.order_id = $1`,
      [id]
    );
    order.items = items.rows;
    return order;
  }

  /**
   * توليد رقم أمر شراء آمن تحت التزامن.
   * - نستخدم عمود counter في جدول company_sequences.
   */
  static async nextNumber(client, companyId) {
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
  }

  /**
   * الطلبات الواردة من الشركات الأخرى (للمورد).
   * - تدعم pagination + فلترة status.
   */
  static async getIncoming(companyId, {
    status = 'pending_approval',
    page = 1,
    limit = 20,
    search,
    date_from,
    date_to,
  } = {}) {
    const params = [companyId];
    const conds = ['po.supplier_company_id = $1'];

    if (status) {
      params.push(status);
      conds.push(`po.status = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`po.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`po.order_date <= $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      conds.push(`(
        po.order_number ILIKE $${params.length}
        OR bc.name ILIKE $${params.length}
      )`);
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    params.push(safeLimit, offset);

    const rows = await pool.query(
      `SELECT
         po.id,
         po.company_id      AS buyer_company_id,
         bc.name            AS buyer_company_name,
         po.order_number,
         po.order_date,
         po.currency_id,
         cu.code            AS currency_code,
         cu.symbol          AS currency_symbol,
         po.exchange_rate,
         po.subtotal,
         po.tax_total,
         po.total,
         po.payment_type,
         po.payment_method,
         po.due_date,
         po.status,
         po.created_at
       FROM purchase_orders po
       JOIN companies bc ON bc.id = po.company_id
       JOIN currencies cu ON cu.id = po.currency_id
       WHERE ${conds.join(' AND ')}
       ORDER BY po.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM purchase_orders po
       JOIN companies bc ON bc.id = po.company_id
       WHERE ${conds.join(' AND ')}`,
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
}

module.exports = PurchaseOrder;