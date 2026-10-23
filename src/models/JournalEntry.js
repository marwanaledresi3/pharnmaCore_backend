const {pool} = require('../config/pool');

class JournalEntry {
  /**
   * قائمة القيود مع فلترة
   */
  static async list(companyId, { status, source_type, date_from, date_to, page = 1, limit = 20 }) {
    const params = [companyId];
    const conds = ['je.company_id = $1'];

    if (status) {
      params.push(status);
      conds.push(`je.status = $${params.length}`);
    }
    if (source_type) {
      params.push(source_type);
      conds.push(`je.source_type = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conds.push(`je.entry_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`je.entry_date <= $${params.length}`);
    }

    const where = conds.join(' AND ');
    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT je.id, je.entry_number, je.entry_date, je.description,
              je.source_type, je.source_id, je.status,
              je.created_at, je.posted_at,
              COALESCE(SUM(jel.debit), 0)::numeric AS total_debit,
              COALESCE(SUM(jel.credit), 0)::numeric AS total_credit,
              COUNT(jel.id)::int AS lines_count
       FROM journal_entries je
       LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       WHERE ${where}
       GROUP BY je.id
       ORDER BY je.entry_date DESC, je.entry_number DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM journal_entries je WHERE ${where}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  /**
   * قيد واحد مع سطوره
   */
  static async findById(companyId, id) {
    const head = await pool.query(
      `SELECT id, entry_number, entry_date, description,
              source_type, source_id, status, created_by, created_at, posted_at
       FROM journal_entries WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    const entry = head.rows[0];
    if (!entry) return null;

    const lines = await pool.query(
      `SELECT jel.id, jel.account_id, a.code AS account_code, a.name AS account_name,
              jel.debit, jel.credit, jel.description
       FROM journal_entry_lines jel
       JOIN chart_of_accounts a ON a.id = jel.account_id
       WHERE jel.journal_entry_id = $1
       ORDER BY jel.id ASC`,
      [id]
    );
    entry.lines = lines.rows;
    return entry;
  }

  /**
   * توليد رقم القيد التالي داخل الشركة (يُستدعى داخل transaction)
   */
  static async nextNumber(client, companyId) {
    const r = await client.query(
      `SELECT COALESCE(MAX(entry_number), 0) + 1 AS next
       FROM journal_entries WHERE company_id = $1`,
      [companyId]
    );
    return r.rows[0].next;
  }

  /**
   * إنشاء قيد جديد (draft)
   */
  static async create(client, companyId, { entry_date, description, source_type, source_id, created_by, lines }) {
    const entryNumber = await this.nextNumber(client, companyId);

    const head = await client.query(
      `INSERT INTO journal_entries
        (company_id, entry_number, entry_date, description, source_type, source_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING id, entry_number, entry_date, description, status, created_at`,
      [companyId, entryNumber, entry_date, description || null,
       source_type || 'manual', source_id || null, created_by]
    );
    const entry = head.rows[0];

    for (const line of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.id, line.account_id, line.debit || 0, line.credit || 0, line.description || null]
      );
    }
    return entry;
  }

  /**
   * تعديل قيد (draft فقط) — استبدال كامل للسطور
   */
  static async update(client, companyId, id, { entry_date, description, lines }) {
    const check = await client.query(
      `SELECT status FROM journal_entries WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (!check.rowCount) return { notFound: true };
    if (check.rows[0].status !== 'draft') return { notDraft: true };

    await client.query(
      `UPDATE journal_entries SET entry_date = $1, description = $2
       WHERE id = $3 AND company_id = $4`,
      [entry_date, description || null, id, companyId]
    );

    // استبدال السطور
    await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`, [id]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, line.account_id, line.debit || 0, line.credit || 0, line.description || null]
      );
    }
    return { ok: true };
  }

  /**
   * ترحيل
   */
  static async post(client, companyId, id, userId) {
    const r = await client.query(
      `UPDATE journal_entries SET status = 'posted', posted_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'draft'
       RETURNING id, status, posted_at`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * إلغاء الترحيل
   */
  static async unpost(client, companyId, id) {
    const r = await client.query(
      `UPDATE journal_entries SET status = 'draft', posted_at = NULL
       WHERE id = $1 AND company_id = $2 AND status = 'posted'
       RETURNING id, status`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * حذف (draft فقط)
   */
  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM journal_entries WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * ميزان المراجعة (Trial Balance)
   */
  static async trialBalance(companyId, { date_from, date_to } = {}) {
    const params = [companyId];
    const conds = ['je.company_id = $1', `je.status = 'posted'`];

    if (date_from) {
      params.push(date_from);
      conds.push(`je.entry_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`je.entry_date <= $${params.length}`);
    }

    const r = await pool.query(
      `SELECT a.id AS account_id, a.code, a.name, a.account_type,
              COALESCE(SUM(jel.debit), 0)::numeric AS total_debit,
              COALESCE(SUM(jel.credit), 0)::numeric AS total_credit,
              COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
         AND ${conds.join(' AND ')}
       WHERE a.company_id = $1
       GROUP BY a.id
       HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
       ORDER BY a.code ASC`,
      params
    );

    const totals = r.rows.reduce(
      (acc, row) => {
        acc.total_debit += Number(row.total_debit);
        acc.total_credit += Number(row.total_credit);
        return acc;
      },
      { total_debit: 0, total_credit: 0 }
    );

    return {
      accounts: r.rows,
      totals,
      balanced: Math.abs(totals.total_debit - totals.total_credit) < 0.01,
    };
  }
}

module.exports = JournalEntry;