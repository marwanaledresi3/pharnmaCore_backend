const {pool} = require('../config/pool');

class Account {
  static async list(companyId) {
    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active
       FROM chart_of_accounts
       WHERE company_id = $1
       ORDER BY code ASC`,
      [companyId]
    );
    return r.rows;
  }

  static async finpoolyId(companyId, id) {
    const r = await pool.query(
      `SELECT id, code, name, account_type, parent_id, is_active
       FROM chart_of_accounts WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  static async finpoolyCode(companyId, code) {
    const r = await pool.query(
      `SELECT id, code, name, account_type FROM chart_of_accounts
       WHERE company_id = $1 AND code = $2`,
      [companyId, code]
    );
    return r.rows[0] || null;
  }

  static async create(client, companyId, { code, name, account_type, parent_id = null }) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, account_type, parent_id`,
      [companyId, code, name, account_type, parent_id]
    );
    return r.rows[0];
  }

  static async existsByCode(companyId, code) {
    const r = await pool.query(
      `SELECT 1 FROM chart_of_accounts WHERE company_id = $1 AND code = $2`,
      [companyId, code]
    );
    return r.rowCount > 0;
  }
/**
   * قائمة مسطحة مع فلترة اختيارية
   */
  static async listFiltered(companyId, { type, is_active, search }) {
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

  /**
   * شجرة الحسابات كاملة (nested)
   */
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
   * الحسابات القابلة للترحيل (ليس لها أبناء + نشطة)
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

  /**
   * هل للحساب أبناء؟
   */
  static async hasChildren(companyId, id) {
    const r = await pool.query(
      `SELECT 1 FROM chart_of_accounts WHERE parent_id = $1 AND company_id = $2 LIMIT 1`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * هل للحساب قيود محاسبية؟
   */
  static async hasJournalLines(id) {
    const r = await pool.query(
      `SELECT 1 FROM journal_entry_lines WHERE account_id = $1 LIMIT 1`,
      [id]
    );
    return r.rowCount > 0;
  }

  /**
   * هل الحساب من سلالة أب معيّن؟ (لمنع الدوران)
   */
  static async isDescendantOf(companyId, accountId, ancestorId) {
    const r = await pool.query(
      `WITH RECURSIVE tree AS (
         SELECT id, parent_id FROM chart_of_accounts WHERE id = $1 AND company_id = $3
         UNION ALL
         SELECT c.id, c.parent_id FROM chart_of_accounts c
         JOIN tree t ON c.parent_id = t.id
         WHERE c.company_id = $3
       )
       SELECT 1 FROM tree WHERE id = $2 LIMIT 1`,
      [ancestorId, accountId, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * إنشاء حساب مع التحقق
   */
  static async createValidated(companyId, { code, name, account_type, parent_id }) {
    // 1) تحقق من parent
    let parentType = account_type;
    if (parent_id) {
      const parent = await this.findById(companyId, parent_id);
      if (!parent) throw new Error('Parent account not found');
      parentType = parent.account_type;
      if (parentType !== account_type) {
        throw new Error(`Account type must match parent (${parentType})`);
      }
    }

    // 2) تحقق من التكرار
    if (await this.existsByCode(companyId, code)) {
      throw new Error('Account code already exists');
    }

    // 3) إدراج
    const r = await pool.query(
      `INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, account_type, parent_id, is_active, created_at`,
      [companyId, code, name, account_type, parent_id || null]
    );
    return r.rows[0];
  }

  /**
   * تعديل حساب (بدون account_type)
   */
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
    const r = await pool.query(
      `UPDATE chart_of_accounts SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, code, name, account_type, parent_id, is_active`,
      params
    );
    return r.rows[0] || null;
  }

  /**
   * تفعيل/تعطيل
   */
  static async setStatus(companyId, id, is_active) {
    const r = await pool.query(
      `UPDATE chart_of_accounts SET is_active = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id, code, name, is_active`,
      [is_active, id, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * حذف
   */
  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM chart_of_accounts WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * كشف حساب (Ledger) مع رصيد جاري
   */
  static async getLedger(companyId, accountId, { date_from, date_to, posted_only = true } = {}) {
    const params = [accountId];
    const conds = ['jel.account_id = $1'];

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
      `SELECT je.id AS journal_entry_id,
              je.entry_number,
              je.entry_date,
              je.description AS entry_description,
              jel.description AS line_description,
              jel.debit,
              jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE je.company_id = $${params.length + 1}
         AND ${conds.join(' AND ')}
       ORDER BY je.entry_date ASC, je.entry_number ASC`,
      [...params, companyId]
    );

    // حساب الرصيد الجاري
    let balance = 0;
    const lines = r.rows.map((row) => {
      balance += Number(row.debit) - Number(row.credit);
      return { ...row, running_balance: balance };
    });

    // رصيد افتتاحي (قبل date_from)
    let opening_balance = 0;
    if (date_from) {
      const ob = await pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS bal
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = $1 AND je.company_id = $2
           AND je.status = 'posted' AND je.entry_date < $3`,
        [accountId, companyId, date_from]
      );
      opening_balance = Number(ob.rows[0].bal);
    }

    return { opening_balance, lines, closing_balance: opening_balance + balance };
  }
}

/**
 * يبني شجرة من قائمة مسطحة
 */
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