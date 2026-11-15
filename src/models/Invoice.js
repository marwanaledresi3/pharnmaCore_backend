// models/Invoice.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('../services/numberingService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

const VALID_INVOICE_TYPES = ['sales', 'purchase'];
const VALID_REFERENCE_TYPES = ['sales_order', 'purchase_order', 'delivery_note', 'manual', 'other'];
const VALID_STATUSES = ['unpaid', 'partial', 'paid', 'cancelled'];

class Invoice {
  // ═══════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════
  static async list(companyId, {
    status,
    invoice_type,
    customer_id,
    supplier_id,
    reference_type,
    date_from,
    date_to,
    search,
    page = 1,
    limit = 20,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [companyId];
    const conds = ['i.company_id = $1'];

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        throw new ApiError(400, `Invalid status: ${status}`);
      }
      params.push(status);
      conds.push(`i.status = $${params.length}`);
    }
    if (invoice_type) {
      if (!VALID_INVOICE_TYPES.includes(invoice_type)) {
        throw new ApiError(400, `Invalid invoice_type: ${invoice_type}`);
      }
      params.push(invoice_type);
      conds.push(`i.invoice_type = $${params.length}`);
    }
    if (customer_id) {
      params.push(customer_id);
      conds.push(`i.customer_id = $${params.length}`);
    }
    if (supplier_id) {
      params.push(supplier_id);
      conds.push(`i.supplier_id = $${params.length}`);
    }
    if (reference_type) {
      params.push(reference_type);
      conds.push(`i.reference_type = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`i.invoice_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`i.invoice_date <= $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        i.invoice_number ILIKE $${p}
        OR c.name ILIKE $${p}
        OR s.name ILIKE $${p}
      )`);
    }

    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT
         i.id,
         i.invoice_number,
         i.invoice_type,
         i.invoice_date,
         i.due_date,
         i.total,
         i.paid_amount,
         (i.total - i.paid_amount)::numeric AS balance,
         i.status,
         i.reference_type,
         i.reference_id,
         i.customer_id,
         i.supplier_id,
         COALESCE(c.name, s.name) AS party_name,
         COALESCE(c.code, s.code) AS party_code,
         i.journal_entry_id,
         i.currency_id,
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,
         i.exchange_rate,
         i.created_at,
         CASE
           WHEN i.due_date IS NOT NULL
             AND i.due_date < CURRENT_DATE
             AND i.status IN ('unpaid', 'partial')
           THEN TRUE
           ELSE FALSE
         END AS is_overdue
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
      `SELECT COUNT(*)::int AS total
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;
    return {
      items: rows.rows,
      pagination: {
        page: pg, limit: lm, total,
        pages: Math.ceil(total / lm),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FIND BY ID
  // ✅ يدعم client (داخل transaction)
  // ═══════════════════════════════════════════════════════════════
  static async findById(companyId, id, client = null) {
    const executor = client || pool;

    const head = await executor.query(
      `SELECT
         i.*,
         COALESCE(c.name, s.name) AS party_name,
         COALESCE(c.code, s.code) AS party_code,
         COALESCE(c.phone, s.phone) AS party_phone,
         COALESCE(c.email, s.email) AS party_email,
         COALESCE(c.address, s.address) AS party_address,
         COALESCE(c.tax_number, s.tax_number) AS party_tax_number,
         cu.code AS currency_code,
         cu.symbol AS currency_symbol
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       JOIN currencies cu ON cu.id = i.currency_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [id, companyId]
    );
    const inv = head.rows[0];
    if (!inv) return null;

    inv.items = await this.getItemsForInvoice(companyId, inv, executor);

    // ✅ حساب subtotal من line_total - tax_amount (أدق من quantity × unit_price)
    inv.subtotal = round2(
      inv.items.reduce(
        (s, it) => s + (Number(it.line_total) - Number(it.tax_amount || 0)),
        0
      )
    );
    inv.tax_amount = round2(
      inv.items.reduce((s, it) => s + Number(it.tax_amount || 0), 0)
    );
    inv.discount_amount = round2(
      Number(inv.subtotal) + Number(inv.tax_amount) - Number(inv.total)
    );
    inv.balance = round2(Number(inv.total) - Number(inv.paid_amount || 0));

    inv.payments = await this.getPayments(companyId, id, executor);

    return inv;
  }

  // ═══════════════════════════════════════════════════════════════
  // GET ITEMS FOR INVOICE
  // ═══════════════════════════════════════════════════════════════
  static async getItemsForInvoice(companyId, invoice, executor = null) {
    const ex = executor || pool;

    if (!invoice.reference_id) {
      return this.getDirectInvoiceItems(invoice.id, invoice.invoice_type, ex);
    }

    if (invoice.reference_type === 'sales_order') {
      const r = await ex.query(
        `SELECT
           soi.id,
           soi.product_id,
           p.name AS product_name,
           p.sku,
           COALESCE(u.name, p.unit) AS unit,
           soi.quantity,
           soi.paid_quantity,
           soi.bonus_quantity,
           soi.unit_price,
           soi.net_unit_price,
           soi.discount_rate,
           soi.discount_amount,
           soi.tax_rate,
           soi.tax_amount,
           soi.line_total,
           soi.batch_id,
           soi.unit_id,
           soi.conversion_factor,
           (soi.quantity * COALESCE(soi.conversion_factor, 1))::numeric AS base_quantity,
           COALESCE((
             SELECT SUM(ri.quantity + COALESCE(ri.bonus_quantity, 0))
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
             WHERE r.invoice_id = $2
               AND ri.product_id = soi.product_id
               AND r.return_type = 'sales'
               AND r.status = 'confirmed'
           ), 0)::numeric AS returned_qty
         FROM sales_order_items soi
         JOIN products p ON p.id = soi.product_id
         LEFT JOIN units u ON u.id = soi.unit_id
         WHERE soi.order_id = $1
         ORDER BY soi.id`,
        [invoice.reference_id, invoice.id]
      );
      return r.rows;
    }

    if (invoice.reference_type === 'purchase_order') {
      const r = await ex.query(
        `SELECT
           poi.id,
           poi.product_id,
           p.name AS product_name,
           p.sku,
           COALESCE(u.name, p.unit) AS unit,
           poi.quantity,
           poi.paid_quantity,
           poi.bonus_quantity,
           poi.unit_price,
           poi.net_unit_price,
           poi.discount_rate,
           poi.discount_amount,
           poi.tax_rate,
           poi.tax_amount,
           poi.line_total,
           poi.batch_number,
           poi.expiry_date,
           poi.unit_id,
           poi.conversion_factor,
           (poi.quantity * COALESCE(poi.conversion_factor, 1))::numeric AS base_quantity,
           COALESCE((
             SELECT SUM(ri.quantity + COALESCE(ri.bonus_quantity, 0))
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
             WHERE r.invoice_id = $2
               AND ri.product_id = poi.product_id
               AND r.return_type = 'purchase'
               AND r.status = 'confirmed'
           ), 0)::numeric AS returned_qty
         FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         LEFT JOIN units u ON u.id = poi.unit_id
         WHERE poi.order_id = $1
         ORDER BY poi.id`,
        [invoice.reference_id, invoice.id]
      );
      return r.rows;
    }

    if (invoice.reference_type === 'delivery_note') {
      const r = await ex.query(
        `SELECT
           dni.id,
           dni.product_id,
           p.name AS product_name,
           p.sku,
           p.unit,
           dni.quantity,
           dni.unit_price,
           0::numeric AS tax_rate,
           0::numeric AS tax_amount,
           (dni.quantity * dni.unit_price)::numeric AS line_total,
           dni.batch_id,
           NULL::uuid AS unit_id,
           1::numeric AS conversion_factor,
           dni.quantity::numeric AS base_quantity,
           COALESCE((
             SELECT SUM(ri.quantity + COALESCE(ri.bonus_quantity, 0))
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
             WHERE r.invoice_id = $2
               AND ri.product_id = dni.product_id
               AND r.return_type = 'sales'
               AND r.status = 'confirmed'
           ), 0)::numeric AS returned_qty
         FROM delivery_note_items dni
         JOIN products p ON p.id = dni.product_id
         WHERE dni.delivery_note_id = $1
         ORDER BY dni.sort_order ASC, dni.created_at ASC`,
        [invoice.reference_id, invoice.id]
      );
      return r.rows;
    }

    return this.getDirectInvoiceItems(invoice.id, invoice.invoice_type, ex);
  }

  // ═══════════════════════════════════════════════════════════════
  // GET DIRECT INVOICE ITEMS
  // ✅ يحسب returned_qty من return_items
  // ═══════════════════════════════════════════════════════════════
  static async getDirectInvoiceItems(invoiceId, invoiceType = null, executor = null) {
    const ex = executor || pool;
    const returnType = invoiceType === 'sales' ? 'sales' : 'purchase';

    const r = await ex.query(
      `SELECT
         ii.id,
         ii.product_id,
         p.name AS product_name,
         p.sku,
         COALESCE(u.name, p.unit) AS unit,
         ii.quantity,
         ii.bonus_quantity,
         ii.unit_price,
         ii.net_unit_price,
         ii.discount_rate,
         ii.discount_amount,
         ii.tax_rate,
         ii.tax_amount,
         ii.line_total,
         ii.batch_id,
         ii.unit_id,
         ii.conversion_factor,
         (ii.quantity * COALESCE(ii.conversion_factor, 1))::numeric AS base_quantity,
         COALESCE((
           SELECT SUM(ri.quantity + COALESCE(ri.bonus_quantity, 0))
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           WHERE r.invoice_id = $1
             AND ri.product_id = ii.product_id
             AND r.return_type = $2
             AND r.status = 'confirmed'
         ), 0)::numeric AS returned_qty
       FROM invoice_items ii
       JOIN products p ON p.id = ii.product_id
       LEFT JOIN units u ON u.id = ii.unit_id
       WHERE ii.invoice_id = $1
       ORDER BY ii.sort_order ASC, ii.id ASC`,
      [invoiceId, returnType]
    );
    return r.rows;
  }

  // ═══════════════════════════════════════════════════════════════
  // GET PAYMENTS
  // ✅ يدعم client
  // ═══════════════════════════════════════════════════════════════
  static async getPayments(companyId, invoiceId, executor = null) {
    const ex = executor || pool;

    const check = await ex.query(
      `SELECT id FROM invoices WHERE id = $1 AND company_id = $2`,
      [invoiceId, companyId]
    );
    if (!check.rowCount) return null;

    const r = await ex.query(
      `SELECT
         p.id,
         p.amount,
         p.payment_date,
         p.method,
         p.reference,
         p.external_reference,
         p.voucher_number,
         p.payment_type,
         p.notes,
         p.description,
         p.created_at
       FROM payments p
       WHERE p.invoice_id = $1
       ORDER BY p.payment_date ASC, p.created_at ASC`,
      [invoiceId]
    );
    return r.rows;
  }

  // ═══════════════════════════════════════════════════════════════
  // FIND BY REFERENCE
  // ═══════════════════════════════════════════════════════════════
  static async findBySalesOrder(client, companyId, orderId) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT id FROM invoices
       WHERE company_id = $1
         AND reference_type = 'sales_order'
         AND reference_id = $2
         AND status <> 'cancelled'
       LIMIT 1`,
      [companyId, orderId]
    );
    return r.rows[0] || null;
  }

  static async findByPurchaseOrder(client, companyId, orderId) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT id FROM invoices
       WHERE company_id = $1
         AND reference_type = 'purchase_order'
         AND reference_id = $2
         AND status <> 'cancelled'
       LIMIT 1`,
      [companyId, orderId]
    );
    return r.rows[0] || null;
  }

  static async findByDeliveryNote(client, companyId, deliveryNoteId) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT id FROM invoices
       WHERE company_id = $1
         AND reference_type = 'delivery_note'
         AND reference_id = $2
         AND status <> 'cancelled'
       LIMIT 1`,
      [companyId, deliveryNoteId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // NEXT NUMBER
  // ═══════════════════════════════════════════════════════════════
  static async nextNumber(client, companyId) {
    return NumberingService.next(client, companyId, 'invoice');
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE
  // ✅ يتحقق من invoice_type, reference_type, currency, total
  // ═══════════════════════════════════════════════════════════════
  static async create(client, companyId, data) {
    // 1) تحقق من invoice_type
    if (!VALID_INVOICE_TYPES.includes(data.invoice_type)) {
      throw new ApiError(400, `Invalid invoice_type: '${data.invoice_type}'. Allowed: ${VALID_INVOICE_TYPES.join(', ')}`);
    }

    // 2) تحقق من reference_type
    if (data.reference_type && !VALID_REFERENCE_TYPES.includes(data.reference_type)) {
      throw new ApiError(400, `Invalid reference_type: '${data.reference_type}'. Allowed: ${VALID_REFERENCE_TYPES.join(', ')}`);
    }

    // 3) تحقق من total
    const totalNum = Number(data.total);
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      throw new ApiError(400, `Invalid total: ${data.total}`);
    }

    // 4) تحقق من currency
    const currencyCheck = await client.query(
      `SELECT id FROM currencies WHERE id = $1`,
      [data.currency_id]
    );
    if (!currencyCheck.rowCount) {
      throw new ApiError(400, `Currency ${data.currency_id} not found`);
    }

    // 5) رقم الفاتورة
    const number = await this.nextNumber(client, companyId);

    // 6) إدراج
    const r = await client.query(
      `INSERT INTO invoices
         (company_id, invoice_number, invoice_type, reference_type, reference_id,
          customer_id, supplier_id, invoice_date, due_date, currency_id,
          total, paid_amount, status, journal_entry_id, exchange_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 'unpaid', $12, $13)
       RETURNING id, invoice_number, total, status, journal_entry_id, exchange_rate`,
      [
        companyId, number, data.invoice_type,
        data.reference_type || null, data.reference_id || null,
        data.customer_id || null, data.supplier_id || null,
        data.invoice_date, data.due_date || null,
        data.currency_id, round2(totalNum),
        data.journal_entry_id || null,
        data.exchange_rate || 1,
      ]
    );
    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE PAID AMOUNT
  // ✅ يقفل الصف + هامش 0.01
  // ⚠️ يفترض أن payments.amount بنفس عملة invoices.total
  // ═══════════════════════════════════════════════════════════════
  static async updatePaidAmount(client, invoiceId) {
    // 1) قفل الصف
    const lock = await client.query(
      `SELECT id FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    if (!lock.rowCount) return null;

    // 2) حساب المجموع + الحالة
    const r = await client.query(
      `UPDATE invoices SET
         paid_amount = COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0),
         status = CASE
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0) >= total - 0.01 THEN 'paid'
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END
       WHERE id = $1
       RETURNING id, paid_amount, status`,
      [invoiceId]
    );
    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // CANCEL
  // ✅ لا يعكس القيد (يفعلها المستدعي)
  // ✅ يقفل الصف
  // ═══════════════════════════════════════════════════════════════
  static async cancel(client, companyId, id) {
    // 1) قفل الصف
    const lock = await client.query(
      `SELECT id, status, journal_entry_id FROM invoices
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const inv = lock.rows[0];
    if (!inv) return null;

    if (inv.status !== 'unpaid') {
      throw new ApiError(400, `Cannot cancel invoice in status: ${inv.status}. Only 'unpaid' can be cancelled.`);
    }

    // 2) تحديث الحالة
    const r = await client.query(
      `UPDATE invoices SET status = 'cancelled'
       WHERE id = $1 AND company_id = $2 AND status = 'unpaid'
       RETURNING id, status, journal_entry_id`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }
}

module.exports = Invoice;