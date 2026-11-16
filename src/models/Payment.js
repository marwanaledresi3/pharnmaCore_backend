// models/Payment.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const VALID_PAYMENT_TYPES = ['receive', 'pay', 'refund', 'credit_apply'];
const VALID_METHODS = ['cash', 'bank', 'cheque', 'card', 'wallet', 'other'];

class Payment {
  // ═══════════════════════════════════════════════════════════════
  // CREATE
  // ✅ يتحقق من amount, payment_type, method, currency, invoice, cash_register_id
  // ✅ يتحقق من تطابق payment_type مع customer_id/supplier_id
  // ═══════════════════════════════════════════════════════════════
  static async create(client, companyId, data) {
    const {
      invoice_id,
      supplier_id,
      customer_id,
      cash_register_id,
      payment_type,
      amount,
      currency_id,
      payment_date,
      method,
      reference,
      voucher_number,
      external_reference,
      description,
      notes,
      journal_entry_id,
      created_by,
      refund_of_payment_id,
    } = data;

    // ═══ 1) تحقق من payment_type ═══
    if (!VALID_PAYMENT_TYPES.includes(payment_type)) {
      throw new ApiError(400, `Invalid payment_type: '${payment_type}'. Allowed: ${VALID_PAYMENT_TYPES.join(', ')}`);
    }

    // ═══ 2) تحقق من amount ═══
    const amountNum = round2(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new ApiError(400, `Invalid amount: ${amount}. Must be > 0`);
    }

    // ═══ 3) تحقق من method ═══
    if (method && !VALID_METHODS.includes(method)) {
      throw new ApiError(400, `Invalid method: '${method}'. Allowed: ${VALID_METHODS.join(', ')}`);
    }

    // ═══ 4) تحقق من currency ═══
    if (!currency_id) {
      throw new ApiError(400, 'currency_id is required');
    }
    const currencyCheck = await client.query(
      `SELECT id FROM currencies WHERE id = $1`,
      [currency_id]
    );
    if (!currencyCheck.rowCount) {
      throw new ApiError(400, `Currency ${currency_id} not found`);
    }

    // ═══ 5) تحقق من invoice (إن وُجد) ═══
    if (invoice_id) {
      const invCheck = await client.query(
        `SELECT id FROM invoices WHERE id = $1 AND company_id = $2`,
        [invoice_id, companyId]
      );
      if (!invCheck.rowCount) {
        throw new ApiError(400, `Invoice ${invoice_id} not found in this company`);
      }
    }

    // ═══ 6) تحقق من cash_register_id (إن وُجد) ═══
    if (cash_register_id) {
      const regCheck = await client.query(
        `SELECT id, is_active FROM cash_registers WHERE id = $1 AND company_id = $2`,
        [cash_register_id, companyId]
      );
      if (!regCheck.rowCount) {
        throw new ApiError(400, `Cash register ${cash_register_id} not found in this company`);
      }
      if (!regCheck.rows[0].is_active) {
        throw new ApiError(400, 'Selected cash register is inactive');
      }
    }

    // ═══ 7) تحقق من تطابق payment_type مع party ═══
    if (payment_type === 'receive' && !customer_id) {
      throw new ApiError(400, 'receive requires customer_id');
    }
    if (payment_type === 'pay' && !supplier_id) {
      throw new ApiError(400, 'pay requires supplier_id');
    }
    if (payment_type === 'credit_apply' && !customer_id) {
      throw new ApiError(400, 'credit_apply requires customer_id');
    }
    if (payment_type === 'refund' && !customer_id && !supplier_id) {
      throw new ApiError(400, 'refund requires customer_id or supplier_id');
    }

    // ═══ 8) إدراج ═══
    const r = await client.query(
      `INSERT INTO payments (
        company_id, invoice_id, supplier_id, customer_id, cash_register_id,
        payment_type, amount, currency_id, payment_date,
        method, reference, voucher_number, external_reference,
        description, notes, journal_entry_id, created_by,
        refund_of_payment_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id, company_id, invoice_id, cash_register_id, payment_type, amount,
                currency_id, payment_date, method, voucher_number,
                journal_entry_id, created_at`,
      [
        companyId,
        invoice_id || null,
        supplier_id || null,
        customer_id || null,
        cash_register_id || null,
        payment_type,
        amountNum,
        currency_id,
        payment_date || new Date().toISOString().slice(0, 10),
        method || null,
        reference || null,
        voucher_number || null,
        external_reference || null,
        description || null,
        notes || null,
        journal_entry_id || null,
        created_by || null,
        refund_of_payment_id || null,
      ]
    );

    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // FIND BY ID
  // ✅ يدعم client + يجلب بيانات الصندوق
  // ═══════════════════════════════════════════════════════════════
  static async findById(client, companyId, id) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT
         p.*,
         c.name AS customer_name,
         s.name AS supplier_name,
         i.invoice_number,
         cr.name AS cash_register_name,
         cr.code AS cash_register_code,
         u.name AS created_by_name,
         p2.voucher_number AS refunded_payment_voucher
       FROM payments p
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN cash_registers cr ON cr.id = p.cash_register_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN payments p2 ON p2.id = p.refund_of_payment_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // GET CUSTOMER CREDIT
  // ═══════════════════════════════════════════════════════════════
  static async getCustomerCredit(client, companyId, customerId) {
    if (!customerId) return 0;

    const executor = client || pool;
    const r = await executor.query(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN payment_type = 'receive' THEN amount
             WHEN payment_type = 'credit_apply' THEN -amount
             WHEN payment_type = 'refund' THEN -amount
             ELSE 0
           END
         ), 0)::numeric AS credit
       FROM payments
       WHERE company_id = $1
         AND customer_id = $2`,
      [companyId, customerId]
    );

    return Number(r.rows[0].credit) || 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // GET SUPPLIER BALANCE
  // ✅ يشمل refund (استرداد من مورد)
  // ═══════════════════════════════════════════════════════════════
  static async getSupplierBalance(client, companyId, supplierId) {
    if (!supplierId) return 0;

    const executor = client || pool;
    const r = await executor.query(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN payment_type = 'pay' THEN amount
             WHEN payment_type = 'refund' THEN -amount
             ELSE 0
           END
         ), 0)::numeric AS paid
       FROM payments
       WHERE company_id = $1
         AND supplier_id = $2`,
      [companyId, supplierId]
    );

    return Number(r.rows[0].paid) || 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // DELETE
  // ✅ يقفل الصف + يتحقق من journal_entry_id
  // ═══════════════════════════════════════════════════════════════
  static async delete(client, companyId, id) {
    // 1) قفل الصف
    const lock = await client.query(
      `SELECT id, journal_entry_id FROM payments
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    if (!lock.rowCount) return null;

    const payment = lock.rows[0];

    // 2) إذا كانت هناك قيد مرحّل، ارفض الحذف (يجب عكسه أولاً)
    if (payment.journal_entry_id) {
      throw new ApiError(
        400,
        'Cannot delete payment with journal entry. Reverse the journal entry first.'
      );
    }

    // 3) حذف
    const r = await client.query(
      `DELETE FROM payments
       WHERE id = $1 AND company_id = $2
       RETURNING id, invoice_id, cash_register_id, voucher_number, amount, payment_type`,
      [id, companyId]
    );

    if (!r.rowCount) return null;

    return {
      id: r.rows[0].id,
      invoice_id: r.rows[0].invoice_id,
      cash_register_id: r.rows[0].cash_register_id,
      voucher_number: r.rows[0].voucher_number,
      amount: Number(r.rows[0].amount),
      payment_type: r.rows[0].payment_type,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // LIST
  // ✅ يدعم الفلترة بـ cash_register_id وإرجاع اسمه
  // ═══════════════════════════════════════════════════════════════
  static async list(companyId, filters = {}) {
    const {
      invoice_id,
      customer_id,
      supplier_id,
      cash_register_id,
      payment_type,
      method,
      date_from,
      date_to,
      search,
      page = 1,
      limit = 20,
    } = filters;

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const params = [companyId];
    const conds = ['p.company_id = $1'];

    if (invoice_id) {
      params.push(invoice_id);
      conds.push(`p.invoice_id = $${params.length}`);
    }
    if (customer_id) {
      params.push(customer_id);
      conds.push(`p.customer_id = $${params.length}`);
    }
    if (supplier_id) {
      params.push(supplier_id);
      conds.push(`p.supplier_id = $${params.length}`);
    }
    if (cash_register_id) {
      params.push(cash_register_id);
      conds.push(`p.cash_register_id = $${params.length}`);
    }
    if (payment_type) {
      if (!VALID_PAYMENT_TYPES.includes(payment_type)) {
        throw new ApiError(400, `Invalid payment_type: '${payment_type}'`);
      }
      params.push(payment_type);
      conds.push(`p.payment_type = $${params.length}`);
    }
    if (method) {
      if (!VALID_METHODS.includes(method)) {
        throw new ApiError(400, `Invalid method: '${method}'`);
      }
      params.push(method);
      conds.push(`p.method = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`p.payment_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`p.payment_date <= $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        p.voucher_number ILIKE $${p}
        OR p.reference ILIKE $${p}
        OR p.external_reference ILIKE $${p}
        OR p.description ILIKE $${p}
      )`);
    }

    const where = conds.join(' AND ');
    params.push(safeLimit, offset);
    const lm = params.length - 1;
    const off = params.length;

    const { rows } = await pool.query(
      `SELECT
         p.id, p.voucher_number, p.payment_type, p.amount,
         p.payment_date, p.method, p.reference, p.external_reference,
         p.description, p.notes, p.created_at,
         p.invoice_id, i.invoice_number,
         p.customer_id, c.name AS customer_name,
         p.supplier_id, s.name AS supplier_name,
         p.cash_register_id, cr.name AS cash_register_name, cr.code AS cash_register_code,
         p.journal_entry_id,
         u.name AS created_by_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN cash_registers cr ON cr.id = p.cash_register_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE ${where}
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT $${lm} OFFSET $${off}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payments p WHERE ${where}`,
      params.slice(0, -2)
    );

    return {
      items: rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / safeLimit),
      },
    };
  }
}

module.exports = Payment;