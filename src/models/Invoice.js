const {pool} = require('../config/pool');

class Invoice {
  static async list(companyId, { status, invoice_type, customer_id, supplier_id,
                                  date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['i.company_id = $1'];

    if (status) { params.push(status); conds.push(`i.status = $${params.length}`); }
    if (invoice_type) { params.push(invoice_type); conds.push(`i.invoice_type = $${params.length}`); }
    if (customer_id) { params.push(customer_id); conds.push(`i.customer_id = $${params.length}`); }
    if (supplier_id) { params.push(supplier_id); conds.push(`i.supplier_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`i.invoice_date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`i.invoice_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.due_date,
              i.total, i.paid_amount, (i.total - i.paid_amount)::numeric AS balance,
              i.status, i.customer_id, i.supplier_id,
              COALESCE(c.name, s.name) AS party_name,
              cu.code AS currency_code, i.created_at
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       JOIN currencies cu ON cu.id = i.currency_id
       WHERE ${conds.join(' AND ')}
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM invoices i WHERE ${conds.join(' AND ')}`,
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
      `SELECT i.*,
              COALESCE(c.name, s.name) AS party_name,
              COALESCE(c.phone, s.phone) AS party_phone,
              COALESCE(c.email, s.email) AS party_email,
              COALESCE(c.address, s.address) AS party_address,
              COALESCE(c.tax_number, s.tax_number) AS party_tax_number,
              cu.code AS currency_code, cu.symbol AS currency_symbol
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      JOIN currencies cu ON cu.id = i.currency_id
      WHERE i.id = $1 AND i.company_id = $2`,
      [id, companyId]
    );
    const inv = head.rows[0];
    if (!inv) return null;

    inv.items = await this.getItemsForInvoice(companyId, inv);
    inv.subtotal = round2(
    inv.items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0)
    );
    inv.tax_amount = round2(
      inv.items.reduce((s, it) => s + Number(it.tax_amount || 0), 0)
    );
    inv.discount_amount = round2(
      Number(inv.subtotal) + Number(inv.tax_amount) - Number(inv.total)
    );


    const payments = await pool.query(
      `SELECT p.id, p.amount, p.payment_date, p.method, p.reference,
              p.payment_type, p.notes, p.created_at
      FROM payments p WHERE p.invoice_id = $1 ORDER BY p.payment_date`,
      [id]
    );
    inv.payments = payments.rows;

    return inv;
  }

  /**
   * جلب بنود الفاتورة من الجدول المرتبط
   * - sale → sales_order_items
   * - purchase → purchase_order_items
   */
  static async getItemsForInvoice(companyId, invoice) {
    if (!invoice.reference_id) return [];

    if (invoice.reference_type === 'sales_order') {
      const r = await pool.query(
        `SELECT soi.id, soi.product_id, p.name AS product_name, p.sku, p.unit,
                soi.quantity, soi.unit_price, soi.tax_rate, soi.tax_amount,
                soi.line_total, soi.batch_id,
                COALESCE((SELECT SUM(r.quantity) FROM return_items ri
                          JOIN returns r ON r.id = ri.return_id
                          WHERE r.invoice_id = $2 AND ri.product_id = soi.product_id
                            AND r.status = 'confirmed'), 0)::numeric AS returned_qty
        FROM sales_order_items soi
        JOIN products p ON p.id = soi.product_id
        WHERE soi.order_id = $1
        ORDER BY soi.id`,
        [invoice.reference_id, invoice.id]
      );
      return r.rows;
    }

    if (invoice.reference_type === 'purchase_order') {
      const r = await pool.query(
        `SELECT poi.id, poi.product_id, p.name AS product_name, p.sku, p.unit,
                poi.quantity, poi.unit_price, poi.tax_rate, poi.tax_amount,
                poi.line_total, poi.batch_number, poi.expiry_date
        FROM purchase_order_items poi
        JOIN products p ON p.id = poi.product_id
        WHERE poi.order_id = $1
        ORDER BY poi.id`,
        [invoice.reference_id]
      );
      return r.rows;
    }

    return [];
  }

  static async findByOrder(companyId, orderId) {
    const r = await pool.query(
      `SELECT id FROM invoices
       WHERE company_id = $1 AND reference_type = 'sales_order' AND reference_id = $2`,
      [companyId, orderId]
    );
    return r.rows[0] || null;
  }

  static async nextNumber(client, companyId, prefix = 'INV-') {
    const r = await client.query(
      `SELECT COUNT(*)::int + 1 AS next FROM invoices WHERE company_id = $1`,
      [companyId]
    );
    return `${prefix}${String(r.rows[0].next).padStart(5, '0')}`;
  }

  static async create(client, companyId, data) {
    const number = await this.nextNumber(client, companyId);
    const r = await client.query(
      `INSERT INTO invoices
         (company_id, invoice_number, invoice_type, reference_type, reference_id,
          customer_id, supplier_id, invoice_date, due_date, currency_id,
          total, paid_amount, status, journal_entry_id, exchange_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 'unpaid', $12, $13)
       RETURNING id, invoice_number, total, status, journal_entry_id`,
      [
        companyId, number, data.invoice_type,
        data.reference_type || null, data.reference_id || null,
        data.customer_id || null, data.supplier_id || null,
        data.invoice_date, data.due_date || null,
        data.currency_id, data.total, data.journal_entry_id || null, data.exchange_rate || 1]
      
    );
    return r.rows[0];
  }

  static async updatePaidAmount(client, invoiceId) {
    const r = await client.query(
      `UPDATE invoices SET
         paid_amount = COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0),
         status = CASE
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0) >= total THEN 'paid'
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END
       WHERE id = $1
       RETURNING id, paid_amount, status`,
      [invoiceId]
    );
    return r.rows[0];
  }

  static async cancel(client, companyId, id) {
    const r = await client.query(
      `UPDATE invoices SET status = 'cancelled'
       WHERE id = $1 AND company_id = $2 AND status IN ('unpaid')
       RETURNING id, status`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }
}
function round2(n) { return Math.round(Number(n) * 100) / 100; }
module.exports = Invoice;