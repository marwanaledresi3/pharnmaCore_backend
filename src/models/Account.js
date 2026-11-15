// models/Account.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

class Account {
  // ═══════════════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════════════

  static async list(companyId) {
    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active, created_at
       FROM chart_of_accounts
       WHERE company_id = $1
       ORDER BY code ASC`,
      [companyId]
    );
    return r.rows;
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active, created_at
       FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async findByCode(companyId, code) {
    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active
       FROM chart_of_accounts
       WHERE company_id = $1 AND code = $2`,
      [companyId, code]
    );
    return r.rows[0] || null;
  }

  static async existsByCode(companyId, code) {
    const r = await pool.query(
      `SELECT 1 FROM chart_of_accounts WHERE company_id = $1 AND code = $2`,
      [companyId, code]
    );
    return r.rowCount > 0;
  }

  static async listFiltered(companyId, { type, is_active, search } = {}) {
    const params = [companyId];
    const conds = ['company_id = $1'];

    if (type) {
      params.push(type);
      conds.push(`account_type = $${params.length}`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`is_active = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conds.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }

    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active, created_at
       FROM chart_of_accounts
       WHERE ${conds.join(' AND ')}
       ORDER BY code ASC`,
      params
    );
    return r.rows;
  }

  static async getTree(companyId) {
    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active
       FROM chart_of_accounts
       WHERE company_id = $1
       ORDER BY code ASC`,
      [companyId]
    );
    return buildTree(r.rows);
  }

  /**
   * الحسابات القابلة للترحيل (ليس لها أبناء + نشطة).
   */
  static async listPostable(companyId) {
    const r = await pool.query(
      `SELECT a.id, a.code, a.name, a.account_type
       FROM chart_of_accounts a
       WHERE a.company_id = $1
         AND a.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM chart_of_accounts c WHERE c.parent_id = a.id
         )
       ORDER BY a.code ASC`,
      [companyId]
    );
    return r.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Checks
  // ═══════════════════════════════════════════════════════════════════════

  static async hasChildren(companyId, id) {
    const r = await pool.query(
      `SELECT 1 FROM chart_of_accounts
       WHERE parent_id = $1 AND company_id = $2
       LIMIT 1`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * هل الحساب مستخدم في قيود مرحّلة؟
   * ✅ FIX #6: يتحقق من company_id
   */
  static async hasJournalLines(companyId, id) {
    const r = await pool.query(
      `SELECT 1
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE jel.account_id = $1 AND je.company_id = $2
       LIMIT 1`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * هل accountId من نسل ancestorId؟
   * (يمنع الدورات: لا يمكن تعيين descendant كأب)
   */
  static async isDescendantOf(companyId, accountId, ancestorId) {
    if (accountId === ancestorId) return true;

    const r = await pool.query(
      `WITH RECURSIVE tree AS (
         SELECT id, parent_id
         FROM chart_of_accounts
         WHERE id = $1 AND company_id = $3
         UNION ALL
         SELECT c.id, c.parent_id
         FROM chart_of_accounts c
         JOIN tree t ON c.parent_id = t.id
         WHERE c.company_id = $3
       )
       SELECT 1 FROM tree WHERE id = $2 LIMIT 1`,
      [ancestorId, accountId, companyId]
    );
    return r.rowCount > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Writes
  // ═══════════════════════════════════════════════════════════════════════

  static async create(client, companyId, {
    code,
    name,
    account_type,
    parent_id = null,
  }) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts
         (company_id, code, name, account_type, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, account_type, parent_id`,
      [companyId, code, name, account_type, parent_id]
    );
    return r.rows[0];
  }

  static async createOrGet(client, companyId, {
    code,
    name,
    account_type,
    parent_id = null,
  }) {
    const inserted = await client.query(
      `INSERT INTO chart_of_accounts
         (company_id, code, name, account_type, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, code) DO NOTHING
       RETURNING id, code, name, account_type, parent_id`,
      [companyId, code, name, account_type, parent_id]
    );

    if (inserted.rows.length > 0) {
      return inserted.rows[0];
    }

    const existing = await client.query(
      `SELECT id, code, name, account_type, parent_id
       FROM chart_of_accounts
       WHERE company_id = $1 AND code = $2
       LIMIT 1`,
      [companyId, code]
    );

    if (existing.rows.length === 0) {
      throw new ApiError(500, `Failed to create or retrieve account: ${code}`);
    }

    return existing.rows[0];
  }

  /**
   * إنشاء حساب مع تحقق كامل.
   *
   * ✅ FIX #2: لا نعتمد على existsByCode المسبق (race condition).
   *            بل نلتقط unique_violation من INSERT.
   */
  static async createValidated(companyId, {
    code,
    name,
    account_type,
    parent_id = null,
  }) {
    // 1) تحقق من parent
    if (parent_id) {
      const parent = await this.findById(companyId, parent_id);
      if (!parent) {
        throw new ApiError(400, 'Parent account not found');
      }
      if (parent.account_type !== account_type) {
        throw new ApiError(
          400,
          `Account type must match parent (${parent.account_type})`
        );
      }
    }

    // 2) INSERT — نعتمد على UNIQUE (company_id, code)
    try {
      const r = await pool.query(
        `INSERT INTO chart_of_accounts
           (company_id, code, name, account_type, parent_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, name, account_type, parent_id, is_active, created_at`,
        [companyId, code, name, account_type, parent_id || null]
      );
      return r.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        // unique_violation — قد يكون company_id+code
        throw new ApiError(409, 'Account code already exists');
      }
      throw err;
    }
  }

  static async update(companyId, id, payload) {
    const allowed = ['code', 'name', 'parent_id', 'is_active'];
    const fields = [];
    const params = [];

    for (const k of allowed) {
      if (payload[k] !== undefined) {
        params.push(payload[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return null;

    params.push(id, companyId);
    try {
      const r = await pool.query(
        `UPDATE chart_of_accounts SET ${fields.join(', ')}
         WHERE id = $${params.length - 1} AND company_id = $${params.length}
         RETURNING id, code, name, account_type, parent_id, is_active`,
        params
      );
      return r.rows[0] || null;
    } catch (err) {
      if (err.code === '23505') {
        throw new ApiError(409, 'Account code already exists');
      }
      throw err;
    }
  }

  static async setStatus(companyId, id, is_active) {
    const r = await pool.query(
      `UPDATE chart_of_accounts SET is_active = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id, code, name, is_active`,
      [is_active, id, companyId]
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Ledger
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * كشف حساب.
   *
   * ✅ FIX #8: opening_balance يُحسب أولاً، ثم running_balance يبدأ منه
   * ✅ التاريخ بالترتيب التصاعدي، والرصيد الجاري صحيح
   */
  static async getLedger(companyId, accountId, {
    date_from,
    date_to,
    posted_only = true,
  } = {}) {
    // ─── 1) opening_balance (قبل date_from) ────────────────────────
    let opening_balance = 0;
    if (date_from) {
      const obConds = [
        'je.company_id = $1',
        'jel.account_id = $2',
        'je.entry_date < $3',
      ];
      if (posted_only) obConds.push(`je.status = 'posted'`);

      const ob = await pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS bal
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE ${obConds.join(' AND ')}`,
        [companyId, accountId, date_from]
      );
      opening_balance = Number(ob.rows[0].bal);
    }

    // ─── 2) lines في الفترة ────────────────────────────────────────
    const params = [companyId, accountId];
    const conds = ['je.company_id = $1', 'jel.account_id = $2'];

    if (posted_only) conds.push(`je.status = 'posted'`);
    if (date_from) {
      params.push(date_from);
      conds.push(`je.entry_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`je.entry_date <= $${params.length}`);
    }

    const r = await pool.query(
      `SELECT
         je.id AS journal_entry_id,
         je.entry_number,
         je.entry_date,
         je.description AS entry_description,
         jel.description AS line_description,
         jel.debit,
         jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE ${conds.join(' AND ')}
       ORDER BY je.entry_date ASC, je.entry_number ASC`,
      params
    );

    // ─── 3) running_balance بدءاً من opening_balance ──────────────
    let balance = opening_balance;
    const lines = r.rows.map((row) => {
      balance += Number(row.debit) - Number(row.credit);
      return { ...row, running_balance: round2(balance) };
    });

    return {
      opening_balance: round2(opening_balance),
      lines,
      closing_balance: round2(balance),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function buildTree(rows) {
  const map = new Map();
  const roots = [];

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }
  for (const row of rows) {
    const node = map.get(row.id);
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

module.exports = Account;