// models/Return.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('../services/numberingService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

const VALID_RETURN_TYPES = ['sale', 'purchase'];
const VALID_STATUSES = ['draft', 'confirmed', 'cancelled'];

class Return {
  // ═══════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════
  static async list(companyId, {
    return_type,
    status,
    invoice_id,
    date_from,
    date_to,
    search,
    page = 1,
    limit = 20,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [companyId];
    const conds = ['r.company_id = $1'];

    if (return_type) {
      if (!VALID_RETURN_TYPES.includes(return_type)) {
        throw new ApiError(400, `Invalid return_type: ${return_type}`);
      }
      params.push(return_type);
      conds.push(`r.return_type = $${params.length}`);
    }
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        throw new ApiError(400, `Invalid status: ${status}`);
      }
      params.push(status);
      conds.push(`r.status = $${params.length}`);
    }
    if (invoice_id) {
      params.push(invoice_id);
      conds.push(`r.invoice_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`r.return_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`r.return_date <= $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        r.return_number ILIKE $${p}
        OR c.name ILIKE $${p}
        OR s.name ILIKE $${p}
        OR i.invoice_number ILIKE $${p}
      )`);
    }

    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT
         r.id,
         r.return_number,
         r.return_type,
         r.return_date,
         r.status,
         r.currency_id,
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,
         r.exchange_rate,
         r.subtotal,
         r.tax_total,
         r.total,
         r.invoice_id,
         i.invoice_number,
         r.customer_id,
         r.supplier_id,
         COALESCE(c.name, s.name) AS party_name,
         COALESCE(c.code, s.code) AS party_code,
         r.journal_entry_id,
         r.created_by,
         u.name AS created_by_name,
         (SELECT COUNT(*)::int
          FROM return_items ri
          WHERE ri.return_id = r.id) AS items_count,
         r.created_at,
         r.updated_at
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       JOIN currencies cu ON cu.id = r.currency_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE ${conds.join(' AND ')}
       ORDER BY r.return_date DESC, r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;
    return {
      items: rows.rows,
      pagination: { page: pg, limit: lm, total, pages: Math.ceil(total / lm) },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FIND BY ID
  // ✅ يدعم client
  // ═══════════════════════════════════════════════════════════════
  static async findById(companyId, id, client = null) {
    const executor = client || pool;

    const head = await executor.query(
      `SELECT
         r.*,
         COALESCE(c.name, s.name) AS party_name,
         COALESCE(c.code, s.code) AS party_code,
         i.invoice_number,
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,
         u.name    AS created_by_name
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       JOIN currencies cu ON cu.id = r.currency_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = $1 AND r.company_id = $2`,
      [id, companyId]
    );
    const ret = head.rows[0];
    if (!ret) return null;

    const items = await executor.query(
      `SELECT
         ri.*,
         p.name AS product_name,
         p.sku,
         u.code AS unit_code,
         u.name AS unit_name
       FROM return_items ri
       JOIN products p ON p.id = ri.product_id
       LEFT JOIN units u ON u.id = ri.unit_id
       WHERE ri.return_id = $1
       ORDER BY ri.id`,
      [id]
    );
    ret.items = items.rows;
    return ret;
  }

  // ═══════════════════════════════════════════════════════════════
  // NEXT NUMBER
  // ✅ يستخدم 'sale' (بدون s) — متوافق مع CHECK
  // ═══════════════════════════════════════════════════════════════
  static async nextNumber(client, companyId, returnType) {
    if (!VALID_RETURN_TYPES.includes(returnType)) {
      throw new ApiError(400, `Invalid return_type: ${returnType}`);
    }
    const prefix = returnType === 'sale' ? 'SR' : 'PR';
    const seqName = returnType === 'sale' ? 'sale_return' : 'purchase_return';
    return NumberingService.next(client, companyId, seqName, { prefix, pad: 5 });
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE
  // ✅ يتحقق من return_type, quantity, total
  // ✅ يحفظ bonus_quantity, discount_rate, discount_amount, net_unit_price
  // ✅ يحسب subtotal, tax_total, total من البنود
  // ═══════════════════════════════════════════════════════════════
  static async create(client, companyId, data) {
    // 1) تحقق من return_type
    if (!VALID_RETURN_TYPES.includes(data.return_type)) {
      throw new ApiError(400, `Invalid return_type: '${data.return_type}'. Allowed: ${VALID_RETURN_TYPES.join(', ')}`);
    }

    // 2) تحقق من party
    if (data.return_type === 'sale' && !data.customer_id) {
      throw new ApiError(400, 'sale return requires customer_id');
    }
    if (data.return_type === 'purchase' && !data.supplier_id) {
      throw new ApiError(400, 'purchase return requires supplier_id');
    }

    // 3) تحقق من items
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new ApiError(400, 'At least one item is required');
    }

    // 4) حساب الإجماليات من البنود
    let subtotal = 0;
    let taxTotal = 0;
    let total = 0;

    for (const item of data.items) {
      const paidQty = Number(item.quantity);
      const bonusQty = Number(item.bonus_quantity || 0);
      const price = Number(item.unit_price);
      const taxRate = Number(item.tax_rate || 0);
      const discountRate = Number(item.discount_rate || 0);
      const discountAmount = Number(item.discount_amount || 0);

      if (!Number.isFinite(paidQty) || paidQty <= 0) {
        throw new ApiError(400, `Invalid quantity for product ${item.product_id}`);
      }
      if (!Number.isFinite(bonusQty) || bonusQty < 0) {
        throw new ApiError(400, `Invalid bonus_quantity for product ${item.product_id}`);
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new ApiError(400, `Invalid unit_price for product ${item.product_id}`);
      }
      if (taxRate < 0 || taxRate > 100) {
        throw new ApiError(400, `Invalid tax_rate for product ${item.product_id}`);
      }
      if (discountRate < 0 || discountRate > 100) {
        throw new ApiError(400, `Invalid discount_rate for product ${item.product_id}`);
      }

      const gross = round2(paidQty * price);
      const disc = discountAmount > 0 ? round2(discountAmount) : round2(gross * discountRate / 100);
      const net = round2(gross - disc);
      const tax = round2(net * taxRate / 100);
      const lineTotal = round2(net + tax);

      subtotal = round2(subtotal + net);
      taxTotal = round2(taxTotal + tax);
      total = round2(total + lineTotal);
    }

    // 5) رقم المرتجع
    const number = await this.nextNumber(client, companyId, data.return_type);

    // 6) إدراج الرأس
    const r = await client.query(
      `INSERT INTO returns
         (company_id, return_number, return_type, invoice_id, reference_type, reference_id,
          customer_id, supplier_id, return_date, currency_id, exchange_rate,
          subtotal, tax_total, total, reason, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16)
       RETURNING id, return_number, status, subtotal, tax_total, total`,
      [
        companyId, number, data.return_type,
        data.invoice_id || null, data.reference_type || null, data.reference_id || null,
        data.customer_id || null, data.supplier_id || null,
        data.return_date, data.currency_id, data.exchange_rate || 1,
        subtotal, taxTotal, total,
        data.reason || null, data.created_by,
      ]
    );
    const ret = r.rows[0];

    // 7) إدراج البنود
    for (const item of data.items) {
      const paidQty = Number(item.quantity);
      const bonusQty = Number(item.bonus_quantity || 0);
      const price = Number(item.unit_price);
      const taxRate = Number(item.tax_rate || 0);
      const discountRate = Number(item.discount_rate || 0);
      const discountAmount = Number(item.discount_amount || 0);

      const gross = round2(paidQty * price);
      const disc = discountAmount > 0 ? round2(discountAmount) : round2(gross * discountRate / 100);
      const net = round2(gross - disc);
      const tax = round2(net * taxRate / 100);
      const lineTotal = round2(net + tax);
      const netUnitPrice = paidQty > 0 ? round2(net / paidQty) : 0;

      await client.query(
        `INSERT INTO return_items
           (return_id, original_item_id, product_id, batch_id, quantity, bonus_quantity,
            unit_price, net_unit_price, discount_rate, discount_amount,
            tax_rate, tax_amount, line_total, cost_price,
            unit_id, conversion_factor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          ret.id,
          item.original_item_id || null,
          item.product_id,
          item.batch_id || null,
          paidQty,
          bonusQty,
          price,
          netUnitPrice,
          discountRate,
          disc,
          taxRate,
          tax,
          lineTotal,
          Number(item.cost_price || 0),
          item.unit_id || null,
          Number(item.conversion_factor || 1),
        ]
      );
    }

    return ret;
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE STATUS
  // ✅ يتحقق من الحالة الجديدة
  // ═══════════════════════════════════════════════════════════════
  static async updateStatus(companyId, id, newStatus, client = null) {
    if (!VALID_STATUSES.includes(newStatus)) {
      throw new ApiError(400, `Invalid status: ${newStatus}. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    const executor = client || pool;
    const r = await executor.query(
      `UPDATE returns SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, status`,
      [newStatus, id, companyId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // LINK JOURNAL ENTRY
  // ═══════════════════════════════════════════════════════════════
  static async linkJournalEntry(companyId, id, journalEntryId, client = null) {
    const executor = client || pool;
    const r = await executor.query(
      `UPDATE returns SET journal_entry_id = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, journal_entry_id`,
      [journalEntryId, id, companyId]
    );
    return r.rows[0] || null;
  }
}

module.exports = Return;