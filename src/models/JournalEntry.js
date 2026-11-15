// models/JournalEntry.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('../services/numberingService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

// ⚠️ يجب أن يطابق CHECK constraint في schema
const VALID_SOURCE_TYPES = [
  'sales',
  'purchase',
  'payment',
  'expense',
  'sale_return',
  'purchase_return',
  'manual',
  'adjustment',
  'sales_invoice',
  'sale_cogs',
  'purchase_payment',
  'sales_payment',
  'purchase_invoice',
  'goods_receipt',
  'credit_note',
  'debit_note',
];

class JournalEntry {
  // ═══════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════
  static async list(companyId, {
    status,
    source_type,
    date_from,
    date_to,
    search,
    page = 1,
    limit = 20,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
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
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        je.description ILIKE $${p}
        OR je.entry_number::text ILIKE $${p}
      )`);
    }

    const where = conds.join(' AND ');
    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT
         je.id,
         je.entry_number,
         je.entry_date,
         je.description,
         je.source_type,
         je.source_id,
         je.status,
         je.created_by,
         u.name AS created_by_name,
         je.created_at,
         je.posted_at,
         COALESCE(SUM(jel.debit), 0)::numeric AS total_debit,
         COALESCE(SUM(jel.credit), 0)::numeric AS total_credit,
         COUNT(jel.id)::int AS lines_count
       FROM journal_entries je
       LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       LEFT JOIN users u ON u.id = je.created_by
       WHERE ${where}
       GROUP BY je.id, u.name
       ORDER BY je.entry_date DESC, je.entry_number DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM journal_entries je
       WHERE ${where}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;
    return {
      items: rows.rows,
      pagination: {
        page: pg,
        limit: lm,
        total,
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
         je.id, je.entry_number, je.entry_date, je.description,
         je.source_type, je.source_id, je.status,
         je.created_by, u.name AS created_by_name,
         je.created_at, je.posted_at
       FROM journal_entries je
       LEFT JOIN users u ON u.id = je.created_by
       WHERE je.id = $1 AND je.company_id = $2`,
      [id, companyId]
    );
    const entry = head.rows[0];
    if (!entry) return null;

    const lines = await executor.query(
      `SELECT
         jel.id,
         jel.account_id,
         a.code AS account_code,
         a.name AS account_name,
         jel.debit,
         jel.credit,
         jel.description
       FROM journal_entry_lines jel
       JOIN chart_of_accounts a ON a.id = jel.account_id
       WHERE jel.journal_entry_id = $1
       ORDER BY jel.id ASC`,
      [id]
    );
    entry.lines = lines.rows;
    return entry;
  }

  // ═══════════════════════════════════════════════════════════════
  // NEXT NUMBER
  // ═══════════════════════════════════════════════════════════════
  static async nextNumber(client, companyId) {
    return NumberingService.next(client, companyId, 'journal_entry');
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════
  static async create(client, companyId, {
    entry_date,
    description,
    source_type,
    source_id,
    created_by,
    lines,
  }) {
    // ═══ 1) تحقق من السطور ═══
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new ApiError(400, 'Entry must have at least 2 lines');
    }

    // ═══ 2) تحقق من source_type ═══
    const st = source_type || 'manual';
    if (!VALID_SOURCE_TYPES.includes(st)) {
      throw new ApiError(
        400,
        `Invalid source_type: '${st}'. Allowed: ${VALID_SOURCE_TYPES.join(', ')}`
      );
    }

    // ═══ 3) تحقق من السطور (account_id, debit/credit, توازن) ═══
    let totalDebit = 0;
    let totalCredit = 0;
    const accountIds = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.account_id) {
        throw new ApiError(400, `Line ${i + 1}: account_id is required`);
      }
      accountIds.add(line.account_id);

      const d = round2(line.debit || 0);
      const c = round2(line.credit || 0);

      if (d < 0 || c < 0) {
        throw new ApiError(400, `Line ${i + 1}: debit/credit must be >= 0`);
      }
      if (d > 0 && c > 0) {
        throw new ApiError(400, `Line ${i + 1}: cannot have both debit and credit`);
      }
      if (d === 0 && c === 0) {
        throw new ApiError(400, `Line ${i + 1}: must have debit OR credit > 0`);
      }

      totalDebit = round2(totalDebit + d);
      totalCredit = round2(totalCredit + c);
    }

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new ApiError(
        400,
        `Entry not balanced (debit: ${totalDebit}, credit: ${totalCredit})`
      );
    }

    // ═══ 4) تحقق من الحسابات (موجودة + نشطة + postable) ═══
    const accountsRes = await client.query(
      `SELECT
         a.id, a.code, a.is_active,
         EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.parent_id = a.id) AS has_children
       FROM chart_of_accounts a
       WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])`,
      [companyId, Array.from(accountIds)]
    );

    if (accountsRes.rowCount !== accountIds.size) {
      const found = accountsRes.rows.map((r) => r.id);
      const missing = Array.from(accountIds).filter((id) => !found.includes(id));
      throw new ApiError(
        400,
        `One or more accounts not found in this company: ${missing.join(', ')}`
      );
    }

    for (const acc of accountsRes.rows) {
      if (!acc.is_active) {
        throw new ApiError(400, `Account ${acc.code} is inactive`);
      }
      if (acc.has_children) {
        throw new ApiError(400, `Account ${acc.code} is not postable (has children)`);
      }
    }

    // ═══ 5) رقم القيد ═══
    const entryNumber = await this.nextNumber(client, companyId);

    // ═══ 6) إدراج الرأس ═══
    const head = await client.query(
      `INSERT INTO journal_entries
        (company_id, entry_number, entry_date, description, source_type, source_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING id, entry_number, entry_date, description, status, created_at`,
      [
        companyId,
        entryNumber,
        entry_date,
        description || null,
        st,
        source_id || null,
        created_by,
      ]
    );
    const entry = head.rows[0];

    // ═══ 7) إدراج السطور ═══
    for (const line of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines
           (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          entry.id,
          line.account_id,
          round2(line.debit || 0),
          round2(line.credit || 0),
          line.description || null,
        ]
      );
    }

    return entry;
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════
  static async update(client, companyId, id, { entry_date, description, lines }) {
    // ═══ 1) تحقق من السطور ═══
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new ApiError(400, 'Entry must have at least 2 lines');
    }

    // ═══ 2) قفل القيد + تحقق من الحالة ═══
    const check = await client.query(
      `SELECT status FROM journal_entries
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    if (!check.rowCount) return { notFound: true };
    if (check.rows[0].status !== 'draft') return { notDraft: true };

    // ═══ 3) تحقق من السطور ═══
    let totalDebit = 0;
    let totalCredit = 0;
    const accountIds = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.account_id) {
        throw new ApiError(400, `Line ${i + 1}: account_id is required`);
      }
      accountIds.add(line.account_id);

      const d = round2(line.debit || 0);
      const c = round2(line.credit || 0);

      if (d < 0 || c < 0) throw new ApiError(400, `Line ${i + 1}: debit/credit must be >= 0`);
      if (d > 0 && c > 0) throw new ApiError(400, `Line ${i + 1}: cannot have both debit and credit`);
      if (d === 0 && c === 0) throw new ApiError(400, `Line ${i + 1}: must have debit OR credit > 0`);

      totalDebit = round2(totalDebit + d);
      totalCredit = round2(totalCredit + c);
    }

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new ApiError(
        400,
        `Entry not balanced (debit: ${totalDebit}, credit: ${totalCredit})`
      );
    }

    // ═══ 4) تحقق من الحسابات ═══
    const accountsRes = await client.query(
      `SELECT
         a.id, a.code, a.is_active,
         EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.parent_id = a.id) AS has_children
       FROM chart_of_accounts a
       WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])`,
      [companyId, Array.from(accountIds)]
    );

    if (accountsRes.rowCount !== accountIds.size) {
      const found = accountsRes.rows.map((r) => r.id);
      const missing = Array.from(accountIds).filter((id) => !found.includes(id));
      throw new ApiError(
        400,
        `One or more accounts not found in this company: ${missing.join(', ')}`
      );
    }

    for (const acc of accountsRes.rows) {
      if (!acc.is_active) throw new ApiError(400, `Account ${acc.code} is inactive`);
      if (acc.has_children) throw new ApiError(400, `Account ${acc.code} is not postable (has children)`);
    }

    // ═══ 5) تحديث الرأس ═══
    await client.query(
      `UPDATE journal_entries SET entry_date = $1, description = $2
       WHERE id = $3 AND company_id = $4`,
      [entry_date, description || null, id, companyId]
    );

    // ═══ 6) حذف السطور القديمة + إدراج الجديدة ═══
    await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`, [id]);

    for (const line of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines
           (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, line.account_id, round2(line.debit || 0), round2(line.credit || 0), line.description || null]
      );
    }

    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // POST
  // ✅ يتحقق من source_type + توازن القيد قبل الترحيل
  // ═══════════════════════════════════════════════════════════════
  static async post(client, companyId, id, userId) {
    // 1) قفل + جلب source_type
    const lock = await client.query(
      `SELECT id, status, source_type
       FROM journal_entries
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const entry = lock.rows[0];
    if (!entry) return null;
    if (entry.status !== 'draft') {
      throw new ApiError(400, `Cannot post entry in status: ${entry.status}`);
    }

    // 2) تحقق من source_type
    if (entry.source_type && !VALID_SOURCE_TYPES.includes(entry.source_type)) {
      throw new ApiError(
        400,
        `Invalid source_type: '${entry.source_type}'. Allowed: ${VALID_SOURCE_TYPES.join(', ')}`
      );
    }

    // 3) تحقق من التوازن
    const balance = await client.query(
      `SELECT
         COALESCE(SUM(debit), 0)::numeric AS total_debit,
         COALESCE(SUM(credit), 0)::numeric AS total_credit,
         COUNT(*)::int AS lines_count
       FROM journal_entry_lines
       WHERE journal_entry_id = $1`,
      [id]
    );
    const b = balance.rows[0];
    if (b.lines_count < 2) {
      throw new ApiError(400, `Cannot post entry with fewer than 2 lines (got ${b.lines_count})`);
    }
    if (Math.abs(Number(b.total_debit) - Number(b.total_credit)) > 0.005) {
      throw new ApiError(
        400,
        `Cannot post unbalanced entry (debit=${b.total_debit}, credit=${b.total_credit})`
      );
    }

    // 4) ترحيل
    const r = await client.query(
      `UPDATE journal_entries
       SET status = 'posted', posted_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'draft'
       RETURNING id, status, posted_at`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // UNPOST
  // ═══════════════════════════════════════════════════════════════
  static async unpost(client, companyId, id) {
    const r = await client.query(
      `UPDATE journal_entries
       SET status = 'draft', posted_at = NULL
       WHERE id = $1 AND company_id = $2 AND status = 'posted'
       RETURNING id, status`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // DELETE
  // ✅ يحذف السطور صراحةً (في حال لا يوجد CASCADE)
  // ═══════════════════════════════════════════════════════════════
  static async delete(client, companyId, id) {
    const executor = client || pool;

    // 1) قفل + تحقق من الحالة
    const lock = await executor.query(
      `SELECT id, status FROM journal_entries
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const entry = lock.rows[0];
    if (!entry) return null;
    if (entry.status !== 'draft') {
      throw new ApiError(400, 'Only draft entries can be deleted');
    }

    // 2) حذف السطور (في حال لا يوجد ON DELETE CASCADE)
    await executor.query(
      `DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [id]
    );

    // 3) حذف الرأس
    const r = await executor.query(
      `DELETE FROM journal_entries
       WHERE id = $1 AND company_id = $2 AND status = 'draft'
       RETURNING id, entry_number`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // TRIAL BALANCE
  // ═══════════════════════════════════════════════════════════════
  static async trialBalance(companyId, {
    date_from,
    date_to,
    include_zero_balances = false,
  } = {}) {
    const params = [companyId];
    const dateConds = [];

    if (date_from) {
      params.push(date_from);
      dateConds.push(`je.entry_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      dateConds.push(`je.entry_date <= $${params.length}`);
    }

    const dateFilter = dateConds.length ? `AND ${dateConds.join(' AND ')}` : '';

    const havingClause = include_zero_balances
      ? ''
      : `HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0`;

    const r = await pool.query(
      `SELECT
         a.id AS account_id,
         a.code,
         a.name,
         a.account_type,
         COALESCE(SUM(jel.debit), 0)::numeric AS total_debit,
         COALESCE(SUM(jel.credit), 0)::numeric AS total_credit,
         COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
         AND je.company_id = a.company_id
         AND je.status = 'posted'
         ${dateFilter}
       WHERE a.company_id = $1
       GROUP BY a.id, a.code, a.name, a.account_type
       ${havingClause}
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
      totals: {
        total_debit: round2(totals.total_debit),
        total_credit: round2(totals.total_credit),
      },
      balanced: Math.abs(totals.total_debit - totals.total_credit) < 0.01,
    };
  }
}

module.exports = JournalEntry;
module.exports.VALID_SOURCE_TYPES = VALID_SOURCE_TYPES;