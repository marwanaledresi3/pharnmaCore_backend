// models/CashRegister.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const VALID_TRANSFER_STATUSES = ['draft', 'confirmed', 'cancelled'];

class CashRegister {
  // ═══════════════════════════════════════════════════════════════
  // RESOLVE ACCOUNT
  // ✅ يحدد الصندوق وحسابه المحاسبي المناسب:
  //    1) cash_register_id الممرر صراحةً
  //    2) الصندوق المرتبط بفرع المستخدم (branch_id)
  //    3) الصندوق الافتراضي للشركة (is_default = true)
  // ═══════════════════════════════════════════════════════════════
  static async resolveAccount(client, companyId, { cash_register_id = null, branch_id = null } = {}) {
    const executor = client || pool;

    if (cash_register_id) {
      const r = await executor.query(
        `SELECT id, account_id, currency_id, name
         FROM cash_registers
         WHERE id = $1 AND company_id = $2 AND is_active = true`,
        [cash_register_id, companyId]
      );
      if (!r.rowCount) {
        throw new ApiError(400, 'الصندوق النقدي المحدد غير موجود أو غير نشط');
      }
      return r.rows[0];
    }

    if (branch_id) {
      const br = await executor.query(
        `SELECT id, account_id, currency_id, name
         FROM cash_registers
         WHERE company_id = $1 AND branch_id = $2 AND is_active = true
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
        [companyId, branch_id]
      );
      if (br.rowCount) {
        return br.rows[0];
      }
    }

    const def = await executor.query(
      `SELECT id, account_id, currency_id, name
       FROM cash_registers
       WHERE company_id = $1 AND is_default = true AND is_active = true
       LIMIT 1`,
      [companyId]
    );
    if (!def.rowCount) {
      throw new ApiError(400, 'لا يوجد صندوق نقدي افتراضي نشط للشركة');
    }

    return def.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE CASH REGISTER
  // ✅ ينشئ حساباً فرعياً تلقائياً تحت 1111 في شجرة الحسابات
  // ═══════════════════════════════════════════════════════════════
  static async create(client, companyId, data) {
    const {
      name,
      code,
      branch_id,
      currency_id,
      responsible_user_id,
      is_default = false,
      notes,
    } = data;

    if (!name || !String(name).trim()) {
      throw new ApiError(400, 'اسم الصندوق مطلوب');
    }

    // 1) تحديد العملة
    let targetCurrencyId = currency_id;
    if (!targetCurrencyId) {
      const compRes = await client.query(
        `SELECT currency_id FROM companies WHERE id = $1`,
        [companyId]
      );
      if (!compRes.rowCount) {
        throw new ApiError(404, 'الشركة غير موجودة');
      }
      targetCurrencyId = compRes.rows[0].currency_id;
    } else {
      const curCheck = await client.query(`SELECT id FROM currencies WHERE id = $1`, [targetCurrencyId]);
      if (!curCheck.rowCount) {
        throw new ApiError(400, `Currency ${targetCurrencyId} not found`);
      }
    }

    // 2) التحقق من الفرع والمستخدم إن وُجدا
    if (branch_id) {
      const bCheck = await client.query(
        `SELECT id FROM branches WHERE id = $1 AND company_id = $2`,
        [branch_id, companyId]
      );
      if (!bCheck.rowCount) {
        throw new ApiError(400, 'الفرع المحدد غير موجود في هذه الشركة');
      }
    }

    if (responsible_user_id) {
      const uCheck = await client.query(
        `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
        [responsible_user_id, companyId]
      );
      if (!uCheck.rowCount) {
        throw new ApiError(400, 'المستخدم المسؤول غير موجود في هذه الشركة');
      }
    }

    // 3) جلب الحساب الأب للصناديق (1111)
    const parentAccRes = await client.query(
      `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND code = '1111' LIMIT 1`,
      [companyId]
    );
    if (!parentAccRes.rowCount) {
      throw new ApiError(400, 'حساب النقدية بالصناديق الرئيسي (1111) غير موجود في شجرة الحسابات');
    }
    const parentAccountId = parentAccRes.rows[0].id;

    // 4) توليد كود الحساب الفرعي التالي (111102, 111103...)
    const maxCodeRes = await client.query(
      `SELECT COALESCE(MAX(CAST(code AS BIGINT)), 111100) + 1 AS next_code
       FROM chart_of_accounts
       WHERE company_id = $1 AND parent_id = $2 AND code ~ '^[0-9]+$'`,
      [companyId, parentAccountId]
    );
    const nextAccountCode = String(maxCodeRes.rows[0].next_code);

    // 5) إنشاء الحساب المحاسبي للصندوق
    const accInsert = await client.query(
      `INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_id, is_active)
       VALUES ($1, $2, $3, 'asset', $4, true)
       RETURNING id`,
      [companyId, nextAccountCode, String(name).trim(), parentAccountId]
    );
    const newAccountId = accInsert.rows[0].id;

    // 6) إلغاء الافتراضية عن الصناديق الأخرى إذا كان هذا افتراضياً
    if (Boolean(is_default)) {
      await client.query(
        `UPDATE cash_registers SET is_default = false WHERE company_id = $1 AND is_default = true`,
        [companyId]
      );
    }

    const registerCode = code && String(code).trim()
      ? String(code).trim()
      : `CASH-${nextAccountCode.slice(-2)}`;

    // 7) إدراج الصندوق
    const r = await client.query(
      `INSERT INTO cash_registers (
        company_id, branch_id, code, name, account_id, currency_id,
        responsible_user_id, is_default, is_active, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
      RETURNING *`,
      [
        companyId,
        branch_id || null,
        registerCode,
        String(name).trim(),
        newAccountId,
        targetCurrencyId,
        responsible_user_id || null,
        Boolean(is_default),
        notes || null,
      ]
    );

    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE CASH REGISTER
  // ═══════════════════════════════════════════════════════════════
  static async update(client, companyId, id, data) {
    const {
      name,
      code,
      branch_id,
      responsible_user_id,
      is_default,
      is_active,
      notes,
    } = data;

    const lock = await client.query(
      `SELECT * FROM cash_registers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (!lock.rowCount) return null;

    const existing = lock.rows[0];

    if (is_default === true) {
      await client.query(
        `UPDATE cash_registers SET is_default = false WHERE company_id = $1 AND id <> $2`,
        [companyId, id]
      );
    }

    const r = await client.query(
      `UPDATE cash_registers
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           branch_id = $3,
           responsible_user_id = $4,
           is_default = COALESCE($5, is_default),
           is_active = COALESCE($6, is_active),
           notes = COALESCE($7, notes)
       WHERE id = $8 AND company_id = $9
       RETURNING *`,
      [
        name !== undefined ? String(name).trim() : null,
        code !== undefined ? String(code).trim() : null,
        branch_id !== undefined ? branch_id : existing.branch_id,
        responsible_user_id !== undefined ? responsible_user_id : existing.responsible_user_id,
        is_default !== undefined ? Boolean(is_default) : null,
        is_active !== undefined ? Boolean(is_active) : null,
        notes !== undefined ? notes : null,
        id,
        companyId,
      ]
    );

    if (name !== undefined || is_active !== undefined) {
      await client.query(
        `UPDATE chart_of_accounts
         SET name = COALESCE($1, name),
             is_active = COALESCE($2, is_active)
         WHERE id = $3`,
        [
          name !== undefined ? String(name).trim() : null,
          is_active !== undefined ? Boolean(is_active) : null,
          existing.account_id,
        ]
      );
    }

    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // FIND BY ID
  // ═══════════════════════════════════════════════════════════════
  static async findById(client, companyId, id) {
    const executor = client || pool;
    const r = await executor.query(
      `SELECT
         cr.*,
         coa.code AS account_code,
         coa.name AS account_name,
         b.name AS branch_name,
         c.code AS currency_code,
         c.symbol AS currency_symbol,
         u.name AS responsible_user_name,
         COALESCE((
           SELECT SUM(jel.debit - jel.credit)
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE jel.account_id = cr.account_id
             AND je.company_id = cr.company_id
             AND je.status = 'posted'
         ), 0)::numeric AS current_balance
       FROM cash_registers cr
       JOIN chart_of_accounts coa ON coa.id = cr.account_id
       JOIN currencies c ON c.id = cr.currency_id
       LEFT JOIN branches b ON b.id = cr.branch_id
       LEFT JOIN users u ON u.id = cr.responsible_user_id
       WHERE cr.id = $1 AND cr.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════
  static async list(companyId, filters = {}) {
    const { branch_id, is_active, search } = filters;

    const params = [companyId];
    const conds = ['cr.company_id = $1'];

    if (branch_id) {
      params.push(branch_id);
      conds.push(`cr.branch_id = $${params.length}`);
    }
    if (is_active !== undefined) {
      params.push(is_active === true || is_active === 'true');
      conds.push(`cr.is_active = $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(cr.name ILIKE $${p} OR cr.code ILIKE $${p} OR coa.code ILIKE $${p})`);
    }

    const where = conds.join(' AND ');

    const { rows } = await pool.query(
      `SELECT
         cr.*,
         coa.code AS account_code,
         coa.name AS account_name,
         b.name AS branch_name,
         c.code AS currency_code,
         c.symbol AS currency_symbol,
         u.name AS responsible_user_name,
         COALESCE((
           SELECT SUM(jel.debit - jel.credit)
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE jel.account_id = cr.account_id
             AND je.company_id = cr.company_id
             AND je.status = 'posted'
         ), 0)::numeric AS current_balance
       FROM cash_registers cr
       JOIN chart_of_accounts coa ON coa.id = cr.account_id
       JOIN currencies c ON c.id = cr.currency_id
       LEFT JOIN branches b ON b.id = cr.branch_id
       LEFT JOIN users u ON u.id = cr.responsible_user_id
       WHERE ${where}
       ORDER BY cr.is_default DESC, cr.created_at ASC`,
      params
    );

    return rows;
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE CASH TRANSFER
  // ✅ تحويل نقدي بين صندوقين أو بين صندوق وبنك
  // ═══════════════════════════════════════════════════════════════
  static async createTransfer(client, companyId, data) {
    const {
      transfer_number,
      transfer_date,
      from_cash_register_id,
      to_cash_register_id,
      from_account_id,
      to_account_id,
      currency_id,
      exchange_rate = 1,
      amount,
      status = 'draft',
      journal_entry_id = null,
      notes,
      created_by,
      confirmed_by = null,
    } = data;

    const amountNum = round2(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new ApiError(400, `Invalid amount: ${amount}. Must be > 0`);
    }

    if (!VALID_TRANSFER_STATUSES.includes(status)) {
      throw new ApiError(400, `Invalid status: '${status}'`);
    }

    if (!currency_id) {
      throw new ApiError(400, 'currency_id is required');
    }

    let resolvedFromAcc = from_account_id;
    let resolvedToAcc = to_account_id;

    if (from_cash_register_id) {
      const r = await client.query(
        `SELECT account_id FROM cash_registers WHERE id = $1 AND company_id = $2 AND is_active = true`,
        [from_cash_register_id, companyId]
      );
      if (!r.rowCount) throw new ApiError(400, 'الصندوق المحوَّل منه غير موجود أو غير نشط');
      resolvedFromAcc = r.rows[0].account_id;
    }

    if (to_cash_register_id) {
      const r = await client.query(
        `SELECT account_id FROM cash_registers WHERE id = $1 AND company_id = $2 AND is_active = true`,
        [to_cash_register_id, companyId]
      );
      if (!r.rowCount) throw new ApiError(400, 'الصندوق المحوَّل إليه غير موجود أو غير نشط');
      resolvedToAcc = r.rows[0].account_id;
    }

    if (!resolvedFromAcc || !resolvedToAcc || resolvedFromAcc === resolvedToAcc) {
      throw new ApiError(400, 'يجب تحديد حسابين مختلفين للتحويل النقدي');
    }

    const r = await client.query(
      `INSERT INTO cash_transfers (
        company_id, transfer_number, transfer_date,
        from_cash_register_id, to_cash_register_id,
        from_account_id, to_account_id, currency_id, exchange_rate,
        amount, status, journal_entry_id, notes, created_by,
        confirmed_by, confirmed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        companyId,
        transfer_number,
        transfer_date || new Date().toISOString().slice(0, 10),
        from_cash_register_id || null,
        to_cash_register_id || null,
        resolvedFromAcc,
        resolvedToAcc,
        currency_id,
        exchange_rate,
        amountNum,
        status,
        journal_entry_id,
        notes || null,
        created_by || null,
        status === 'confirmed' ? (confirmed_by || created_by || null) : null,
        status === 'confirmed' ? new Date() : null,
      ]
    );

    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // LIST TRANSFERS
  // ═══════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════
  // LIST TRANSFERS
  // ═══════════════════════════════════════════════════════════════
  static async listTransfers(companyId, filters = {}) {
    const {
      cash_register_id,
      register_id,
      status,
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
    const conds = ['ct.company_id = $1'];

    const targetRegisterId = cash_register_id || register_id;
    if (targetRegisterId) {
      params.push(targetRegisterId);
      const p = params.length;
      conds.push(`(ct.from_cash_register_id = $${p} OR ct.to_cash_register_id = $${p})`);
    }

    if (status && VALID_TRANSFER_STATUSES.includes(status)) {
      params.push(status);
      conds.push(`ct.status = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conds.push(`ct.transfer_date >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conds.push(`ct.transfer_date <= $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        ct.transfer_number ILIKE $${p}
        OR ct.notes ILIKE $${p}
        OR fr.name ILIKE $${p}
        OR tr.name ILIKE $${p}
      )`);
    }

    const where = conds.join(' AND ');
    params.push(safeLimit, offset);

    const { rows } = await pool.query(
      `SELECT
         ct.*,
         ct.from_cash_register_id AS from_register_id,
         ct.to_cash_register_id   AS to_register_id,
         fr.name AS from_register_name,
         fr.code AS from_register_code,
         tr.name AS to_register_name,
         tr.code AS to_register_code,
         fa.code AS from_account_code,
         fa.name AS from_account_name,
         ta.code AS to_account_code,
         ta.name AS to_account_name,
         c.code  AS currency_code,
         c.symbol AS currency_symbol,
         u.name  AS created_by_name
       FROM cash_transfers ct
       LEFT JOIN cash_registers fr ON fr.id = ct.from_cash_register_id
       LEFT JOIN cash_registers tr ON tr.id = ct.to_cash_register_id
       JOIN chart_of_accounts fa ON fa.id = ct.from_account_id
       JOIN chart_of_accounts ta ON ta.id = ct.to_account_id
       JOIN currencies c ON c.id = ct.currency_id
       LEFT JOIN users u ON u.id = ct.created_by
       WHERE ${where}
       ORDER BY ct.transfer_date DESC, ct.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM cash_transfers ct
       LEFT JOIN cash_registers fr ON fr.id = ct.from_cash_register_id
       LEFT JOIN cash_registers tr ON tr.id = ct.to_cash_register_id
       WHERE ${where}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;

    return {
      items: rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }
}

module.exports = CashRegister;