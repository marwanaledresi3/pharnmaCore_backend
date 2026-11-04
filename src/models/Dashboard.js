const { pool } = require('../config/pool');

class Dashboard {
  /**
   * ملخّص KPIs للشركة — قابل للتخصيص حسب الصلاحيات
   * يُرجع جميع المؤشرات؛ الواجهة تُظهر ما يملك المستخدم صلاحيته فقط
   */
  static async getSummary(companyId, { period = 'month' } = {}) {
    const { fromDate, toDate } = Dashboard._periodRange(period);

    const r = await pool.query(
      `WITH
        -- فواتير الفترة
        inv AS (
          SELECT COUNT(*)::int AS count,
                 COALESCE(SUM(total), 0)::numeric AS total,
                 COALESCE(SUM(paid_amount), 0)::numeric AS paid
          FROM invoices
          WHERE company_id = $1 AND invoice_date BETWEEN $2 AND $3
            AND status <> 'cancelled'
        ),
        -- أوامر شراء الفترة
        po AS (
          SELECT COUNT(*)::int AS count,
                 COALESCE(SUM(total), 0)::numeric AS total
          FROM purchase_orders
          WHERE company_id = $1 AND order_date BETWEEN $2 AND $3
            AND status NOT IN ('draft', 'rejected', 'cancelled')
        ),
        -- عملاء/موردون
        cust AS (SELECT COUNT(*)::int AS count FROM customers WHERE company_id = $1 AND is_active = TRUE),
        sup AS (SELECT COUNT(*)::int AS count FROM suppliers WHERE company_id = $1 AND is_active = TRUE),
        -- مخزون
        stock AS (
          SELECT
            COALESCE(SUM(quantity), 0)::numeric AS qty,
            COALESCE(SUM(quantity * cost_price), 0)::numeric AS value
          FROM product_batches
          WHERE company_id = $1 AND quantity > 0
        ),
        low_stock AS (
          SELECT COUNT(*)::int AS count
          FROM (
            SELECT p.id, p.min_stock_level,
                   COALESCE(SUM(b.quantity), 0) AS total_qty
            FROM products p
            LEFT JOIN product_batches b
              ON b.product_id = p.id AND b.company_id = p.company_id
            WHERE p.company_id = $1 AND p.is_active = TRUE
            GROUP BY p.id, p.min_stock_level
            HAVING COALESCE(SUM(b.quantity), 0) < p.min_stock_level
          ) t
        ),
        -- مستحقات
        receivables AS (
          SELECT COALESCE(SUM(total - paid_amount), 0)::numeric AS amount
          FROM invoices
          WHERE company_id = $1
            AND status IN ('unpaid', 'partial')
            AND total > paid_amount
        ),
        payables AS (
          SELECT COALESCE(SUM(total - paid_amount), 0)::numeric AS amount
          FROM purchase_orders
          WHERE company_id = $1
            AND payment_type IN ('credit', 'partial')
            AND status NOT IN ('draft', 'rejected', 'cancelled')
            AND total > paid_amount
        ),
        -- موظفون وفروع
        emp AS (SELECT COUNT(*)::int AS count FROM users WHERE company_id = $1 AND user_type = 'internal' AND is_active = TRUE),
        br AS (SELECT COUNT(*)::int AS count FROM branches WHERE company_id = $1 AND is_active = TRUE)
      SELECT
        (SELECT row_to_json(inv) FROM inv) AS invoices,
        (SELECT row_to_json(po) FROM po) AS purchase_orders,
        (SELECT count FROM cust) AS customers_count,
        (SELECT count FROM sup) AS suppliers_count,
        (SELECT row_to_json(stock) FROM stock) AS stock,
        (SELECT count FROM low_stock) AS low_stock_count,
        (SELECT amount FROM receivables) AS receivables,
        (SELECT amount FROM payables) AS payables,
        (SELECT count FROM emp) AS employees_count,
        (SELECT count FROM br) AS branches_count`,
      [companyId, fromDate, toDate]
    );

    return { ...r.rows[0], period: { from: fromDate, to: toDate } };
  }

  /** آخر الأحداث من audit_logs + notifications */
  static async getRecentActivity(companyId, { limit = 10 } = {}) {
    const r = await pool.query(
      `SELECT a.id, a.action, a.table_name, a.record_id,
              a.created_at, u.name AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.company_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return r.rows;
  }

  /** إحصائيات عامة للزائر — بلا بيانات حساسة */
  static async getPublicStats() {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM companies WHERE is_active = TRUE) AS companies_count,
         (SELECT COUNT(*)::int FROM global_products) AS global_products_count,
         (SELECT COUNT(*)::int FROM company_posts WHERE is_public = TRUE) AS posts_count`
    );
    return r.rows[0];
  }

  static _periodRange(period) {
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10);
    let from = new Date(now);
    if (period === 'today') { /* from = today */ }
    else if (period === 'week') from.setDate(now.getDate() - 7);
    else if (period === 'year') from.setFullYear(now.getFullYear() - 1);
    else from.setDate(now.getDate() - 30); // month
    return { fromDate: from.toISOString().slice(0, 10), toDate };
  }
}

module.exports = Dashboard;