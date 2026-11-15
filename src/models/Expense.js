// models/Expense.js
const { pool } = require('../config/pool');

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

class Expense {
  /**
   * قائمة المصروفات مع الفلاتر والترقيم.
   *
   * الفلاتر:
   * - status, category, supplier_id, date_from, date_to
   * - search (expense_number, description, supplier_name, external_reference)
   * - page, limit
   */
  static async list(companyId, {
    status,
    category,
    supplier_id,
    date_from,
    date_to,
    search,
    page = 1,
    limit = 20,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [companyId];
    const conds = ['e.company_id = $1'];

    if (status) {
      params.push(status);
      conds.push(`e.status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conds.push(`e.expense_category = $${params.length}`);
    }
    if (supplier_id) {
      params.push(supplier_id);
      conds.push(`e.supplier_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`e.expense_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`e.expense_date <= $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        e.expense_number ILIKE $${p}
        OR e.description ILIKE $${p}
        OR e.external_reference ILIKE $${p}
        OR s.name ILIKE $${p}
      )`);
    }

    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT
         e.id,
         e.expense_number,
         e.expense_date,
         e.expense_category,
         e.description,
         e.amount,
         e.currency_id,
         e.exchange_rate,
         e.payment_type,
         e.payment_method,
         e.paid_amount,
         e.due_date,
         e.status,
         e.journal_entry_id,
         e.external_reference,
         e.supplier_id,
         e.created_by,
         e.created_at,
         e.updated_at,

         -- العملة
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,

         -- المورد
         s.name AS supplier_name,
         s.code AS supplier_code,

         -- الحساب
         a.code AS account_code,
         a.name AS account_name,

         -- المنشئ
         u.name AS created_by_name,

         -- المتبقي
         (e.amount - COALESCE(e.paid_amount, 0))::numeric AS remaining_amount

       FROM expenses e
       JOIN currencies cu ON cu.id = e.currency_id
       JOIN chart_of_accounts a ON a.id = e.expense_account_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE ${conds.join(' AND ')}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM expenses e
       LEFT JOIN suppliers s ON s.id = e.supplier_id
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

  /**
   * تفاصيل مصروف واحد.
   */
  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT
         e.*,
         cu.code   AS currency_code,
         cu.symbol AS currency_symbol,
         s.name    AS supplier_name,
         s.code    AS supplier_code,
         a.code    AS account_code,
         a.name    AS account_name,
         u.name    AS created_by_name,
         (e.amount - COALESCE(e.paid_amount, 0))::numeric AS remaining_amount
       FROM expenses e
       JOIN currencies cu ON cu.id = e.currency_id
       JOIN chart_of_accounts a ON a.id = e.expense_account_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = $1 AND e.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * إنشاء مصروف.
   */
  static async create(client, companyId, data) {
    const r = await client.query(
      `INSERT INTO expenses
         (company_id, expense_number, expense_date, expense_category,
          expense_account_id, supplier_id, description, amount,
          currency_id, exchange_rate, payment_type, payment_method,
          paid_amount, due_date, status, journal_entry_id,
          external_reference, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id, expense_number, status, amount, paid_amount`,
      [
        companyId,
        data.expense_number,
        data.expense_date,
        data.expense_category,
        data.expense_account_id,
        data.supplier_id || null,
        data.description,
        data.amount,
        data.currency_id,
        data.exchange_rate || 1,
        data.payment_type,
        data.payment_method || null,
        data.paid_amount || 0,
        data.due_date || null,
        data.status || 'posted',
        data.journal_entry_id || null,
        data.external_reference || null,
        data.created_by,
      ]
    );
    return r.rows[0];
  }

  /**
   * تحديث حالة المصروف.
   */
  static async updateStatus(companyId, id, status, client = null) {
    const executor = client || pool;
    const r = await executor.query(
      `UPDATE expenses SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING id, status`,
      [status, id, companyId]
    );
    return r.rows[0] || null;
  }
}

module.exports = Expense;