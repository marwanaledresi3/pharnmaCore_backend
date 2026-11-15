
const { pool } = require('../config/pool');

class Document {
  static DOCUMENT_TYPES = [
    'invoice_sales',
    'invoice_purchase',
    'payment_receive',
    'payment_pay',
    'payment_refund',
    'payment_credit_apply',
    'expense',
    'return_sale',
    'return_purchase',
    'journal_entry',
    'note_credit',
    'note_debit',
    'delivery_note',
    'stock_transfer',
    'stock_adjustment',
  ];

  /**
   * الاستعلام الموحد لجميع المستندات
   */
  static getUnifiedQuery() {
    return `
      SELECT
        'invoice_' || i.invoice_type::text AS document_type,
        i.id AS document_id,
        i.invoice_number AS document_number,
        i.invoice_date AS document_date,
        i.total AS amount,
        i.status AS status,
        CASE
          WHEN i.invoice_type = 'sales' THEN c.name
          WHEN i.invoice_type = 'purchase' THEN s.name
        END AS party_name,
        CASE
          WHEN i.invoice_type = 'sales' THEN c.id
          WHEN i.invoice_type = 'purchase' THEN s.id
        END AS party_id,
        i.journal_entry_id AS journal_entry_id,
        NULL::uuid AS source_id,
        i.created_at
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.company_id = $1

      UNION ALL

      SELECT
        'payment_' || p.payment_type::text,
        p.id,
        COALESCE(p.voucher_number, 'PAY-' || substring(p.id::text, 1, 8)),
        p.payment_date,
        p.amount,
        'posted',
        COALESCE(c.name, s.name, p.description),
        COALESCE(c.id, s.id),
        p.journal_entry_id,
        NULL::uuid,
        p.created_at
      FROM payments p
      LEFT JOIN customers c ON c.id = p.customer_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.company_id = $1

      UNION ALL

      SELECT
        'expense',
        e.id,
        e.expense_number,
        e.expense_date,
        e.amount,
        e.status,
        s.name,
        s.id,
        e.journal_entry_id,
        NULL::uuid,
        e.created_at
      FROM expenses e
      LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE e.company_id = $1

      UNION ALL

      SELECT
        'return_' || r.return_type::text,
        r.id,
        r.return_number,
        r.return_date,
        r.total,
        r.status,
        CASE
          WHEN r.return_type = 'sale' THEN c.name
          WHEN r.return_type = 'purchase' THEN s.name
        END,
        CASE
          WHEN r.return_type = 'sale' THEN c.id
          WHEN r.return_type = 'purchase' THEN s.id
        END,
        r.journal_entry_id,
        NULL::uuid,
        r.created_at
      FROM returns r
      LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      WHERE r.company_id = $1

      UNION ALL

      SELECT
        'journal_entry',
        je.id,
        'JE-' || LPAD(je.entry_number::text, 4, '0'),
        je.entry_date,
        0::numeric,
        je.status,
        je.description,
        NULL::uuid,
        je.id,
        NULL::uuid,
        je.created_at
      FROM journal_entries je
      WHERE je.company_id = $1
        AND je.source_type = 'manual'

      UNION ALL

      SELECT
        'note_' || n.note_type::text,
        n.id,
        n.note_number,
        n.note_date,
        n.total,
        n.status,
        COALESCE(c.name, s.name),
        COALESCE(c.id, s.id),
        n.journal_entry_id,
        n.invoice_id,
        n.created_at
      FROM notes n
      LEFT JOIN customers c ON c.id = n.customer_id
      LEFT JOIN suppliers s ON s.id = n.supplier_id
      WHERE n.company_id = $1

      UNION ALL

      SELECT
        'delivery_note',
        dn.id,
        dn.delivery_number,
        dn.delivery_date,
        (
          SELECT COALESCE(SUM(quantity * unit_price), 0)::numeric
          FROM delivery_note_items
          WHERE delivery_note_id = dn.id
        ),
        dn.status,
        c.name,
        c.id,
        NULL::uuid,
        dn.invoice_id,
        dn.created_at
      FROM delivery_notes dn
      LEFT JOIN customers c ON c.id = dn.customer_id
      WHERE dn.company_id = $1

      UNION ALL

      SELECT
        'stock_transfer',
        st.id,
        st.transfer_number,
        st.transfer_date,
        (
          SELECT COALESCE(
            SUM(quantity * COALESCE(unit_cost, 0)), 0
          )::numeric
          FROM stock_transfer_items
          WHERE transfer_id = st.id
        ),
        st.status,
        fw.name || ' → ' || tw.name,
        NULL::uuid,
        NULL::uuid,
        NULL::uuid,
        st.created_at
      FROM stock_transfers st
      LEFT JOIN warehouses fw ON fw.id = st.from_warehouse_id
      LEFT JOIN warehouses tw ON tw.id = st.to_warehouse_id
      WHERE st.company_id = $1

      UNION ALL

      SELECT
        'stock_adjustment',
        sa.id,
        sa.adjustment_number,
        sa.adjustment_date,
        (
          SELECT COALESCE(
            SUM(ABS(difference) * COALESCE(unit_cost, 0)), 0
          )::numeric
          FROM stock_adjustment_items
          WHERE adjustment_id = sa.id
        ),
        sa.status,
        w.name,
        NULL::uuid,
        sa.journal_entry_id,
        NULL::uuid,
        sa.created_at
      FROM stock_adjustments sa
      LEFT JOIN warehouses w ON w.id = sa.warehouse_id
      WHERE sa.company_id = $1
    `;
  }

  /**
   * قائمة المستندات الموحدة مع التصفية والترقيم
   */
  static async list(companyId, {
    document_type,
    status,
    date_from,
    date_to,
    party_id,
    search,
    page = 1,
    limit = 50,
  } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const params = [companyId];
    const conditions = [];

    if (document_type) {
      params.push(document_type);
      conditions.push(`doc.document_type = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`doc.status = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conditions.push(`doc.document_date >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(`doc.document_date <= $${params.length}`);
    }

    if (party_id) {
      params.push(party_id);
      conditions.push(`doc.party_id = $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const index = params.length;

      conditions.push(`(
        doc.document_number ILIKE $${index}
        OR doc.party_name ILIKE $${index}
      )`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const unified = this.getUnifiedQuery();

    const listParams = [...params, safeLimit, offset];

    const sql = `
      SELECT *
      FROM (${unified}) AS doc
      ${where}
      ORDER BY doc.document_date DESC, doc.created_at DESC
      LIMIT $${listParams.length - 1}
      OFFSET $${listParams.length}
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM (${unified}) AS doc
      ${where}
    `;

    const [listResult, countResult] = await Promise.all([
      pool.query(sql, listParams),
      pool.query(countSql, params),
    ]);

    const total = countResult.rows[0].total;

    return {
      items: listResult.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * إحصائيات المستندات حسب النوع
   */
  static async getStats(companyId, {
    date_from,
    date_to,
  } = {}) {
    const params = [companyId];
    const conditions = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`docs.document_date >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(`docs.document_date <= $${params.length}`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const sql = `
      WITH docs AS (
        SELECT
          'invoice_sales' AS type,
          invoice_date AS document_date,
          total AS amount
        FROM invoices
        WHERE company_id = $1 AND invoice_type = 'sales'

        UNION ALL

        SELECT
          'invoice_purchase',
          invoice_date,
          total
        FROM invoices
        WHERE company_id = $1 AND invoice_type = 'purchase'

        UNION ALL

        SELECT
          'payment_receive',
          payment_date,
          amount
        FROM payments
        WHERE company_id = $1 AND payment_type = 'receive'

        UNION ALL

        SELECT
          'payment_pay',
          payment_date,
          amount
        FROM payments
        WHERE company_id = $1 AND payment_type = 'pay'

        UNION ALL

        SELECT
          'expense',
          expense_date,
          amount
        FROM expenses
        WHERE company_id = $1

        UNION ALL

        SELECT
          'return_sale',
          return_date,
          total
        FROM returns
        WHERE company_id = $1 AND return_type = 'sale'

        UNION ALL

        SELECT
          'return_purchase',
          return_date,
          total
        FROM returns
        WHERE company_id = $1 AND return_type = 'purchase'

        UNION ALL

        SELECT
          'note_credit',
          note_date,
          total
        FROM notes
        WHERE company_id = $1 AND note_type = 'credit'

        UNION ALL

        SELECT
          'note_debit',
          note_date,
          total
        FROM notes
        WHERE company_id = $1 AND note_type = 'debit'

        UNION ALL

        SELECT
          'delivery_note',
          dn.delivery_date,
          (
            SELECT COALESCE(SUM(quantity * unit_price), 0)
            FROM delivery_note_items
            WHERE delivery_note_id = dn.id
          )
        FROM delivery_notes dn
        WHERE dn.company_id = $1

        UNION ALL

        SELECT
          'stock_transfer',
          transfer_date,
          0::numeric
        FROM stock_transfers
        WHERE company_id = $1

        UNION ALL

        SELECT
          'stock_adjustment',
          adjustment_date,
          0::numeric
        FROM stock_adjustments
        WHERE company_id = $1
      )

      SELECT
        docs.type,
        COUNT(*)::int AS count,
        COALESCE(SUM(docs.amount), 0)::numeric AS total_amount
      FROM docs
      ${where}
      GROUP BY docs.type
      ORDER BY docs.type
    `;

    const { rows } = await pool.query(sql, params);

    const totals = rows.reduce(
      (acc, row) => {
        acc.count += Number(row.count);
        acc.amount += Number(row.total_amount);
        return acc;
      },
      { count: 0, amount: 0 }
    );

    return {
      by_type: rows,
      totals,
    };
  }
}

module.exports = Document;
