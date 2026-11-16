// services/cashRegisterService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const CashRegister = require('../models/CashRegister');
const JournalEntry = require('../models/JournalEntry');
const NumberingService = require('./numberingService');
const currencyUtil = require('../utils/currency');
const {
  round2,
  assertBalanced,
  verifyJournalEntry,
} = require('./journalHelper');

/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * ضبط متغيرات الجلسة الخاصة بـ audit_trigger (إن وُجد في قاعدة البيانات)
 */
async function setAuditContext(client, companyId, userId) {
  await client.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);
  if (userId) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  }
}

/**
 * التحقق من ملكية ونشاط الحساب المحاسبي داخل الشركة
 */
async function assertActiveAccount(client, companyId, accountId, label) {
  const r = await client.query(
    `SELECT id, code, name
     FROM chart_of_accounts
     WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [accountId, companyId]
  );
  if (!r.rowCount) {
    throw new ApiError(400, `${label}: الحساب المحاسبي غير موجود أو غير نشط`);
  }
  return r.rows[0];
}

/* ============================================================
 * 1) إنشاء صندوق نقدي جديد (+ توليد حساب فرعي تحت 1111)
 * ============================================================ */
const createRegister = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const created = await CashRegister.create(client, companyId, payload);

    await client.query('COMMIT');
    transactionStarted = false;

    return await CashRegister.findById(null, companyId, created.id);
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[cashRegister.createRegister] ROLLBACK failed:', e.message); }
    }
    if (err.code === '23505') {
      throw new ApiError(409, 'اسم الصندوق أو رمزه مستخدم مسبقاً في هذه الشركة');
    }
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * 2) تحديث بيانات صندوق نقدي (+ مزامنة الحساب المحاسبي)
 * ============================================================ */
const updateRegister = async (companyId, userId, id, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    if (payload.is_active === false) {
      const current = await CashRegister.findById(client, companyId, id);
      if (!current) throw new ApiError(404, 'الصندوق غير موجود');
      if (current.is_default) {
        throw new ApiError(400, 'لا يمكن تعطيل الصندوق الافتراضي للشركة قبل تعيين صندوق افتراضي آخر');
      }
    }

    const updated = await CashRegister.update(client, companyId, id, payload);
    if (!updated) {
      throw new ApiError(404, 'الصندوق غير موجود');
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return await CashRegister.findById(null, companyId, updated.id);
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[cashRegister.updateRegister] ROLLBACK failed:', e.message); }
    }
    if (err.code === '23505') {
      throw new ApiError(409, 'اسم الصندوق أو رمزه مستخدم مسبقاً في هذه الشركة');
    }
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * 3) إنشاء تحويل نقدي بين صندوقين أو بين صندوق وبنك
 * القيد المحاسبي:
 *   Dr حساب المستلم (to_account_id)
 *   Cr حساب المُرسِل (from_account_id)
 * ============================================================ */
const createTransfer = async (companyId, userId, payload) => {
  const from_cash_register_id = payload.from_cash_register_id || payload.from_register_id || null;
  const to_cash_register_id = payload.to_cash_register_id || payload.to_register_id || null;
  const {
    transfer_date,
    from_account_id = null,
    to_account_id = null,
    amount,
    notes = null,
    auto_confirm = true,
  } = payload;

  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new ApiError(400, 'المبلغ يجب أن يكون أكبر من صفر');
  }

  const tDate = transfer_date || new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    // 1) تحديد الحساب المحاسبي للمُرسِل (من)
    let resolvedFromAccountId = from_account_id;
    let fromLabel = '';
    let inferredCurrencyId = payload.currency_id || null;

    if (from_cash_register_id) {
      const fromReg = await CashRegister.resolveAccount(client, companyId, {
        cash_register_id: from_cash_register_id,
      });
      resolvedFromAccountId = fromReg.account_id;
      fromLabel = fromReg.name;
      if (!inferredCurrencyId) inferredCurrencyId = fromReg.currency_id;
    } else if (resolvedFromAccountId) {
      const acc = await assertActiveAccount(client, companyId, resolvedFromAccountId, 'الحساب المحوَّل منه');
      fromLabel = acc.name;
    } else {
      throw new ApiError(400, 'يجب تحديد الصندوق أو الحساب المحوَّل منه');
    }

    // 2) تحديد الحساب المحاسبي للمُستلِم (إلى)
    let resolvedToAccountId = to_account_id;
    let toLabel = '';

    if (to_cash_register_id) {
      const toReg = await CashRegister.resolveAccount(client, companyId, {
        cash_register_id: to_cash_register_id,
      });
      resolvedToAccountId = toReg.account_id;
      toLabel = toReg.name;
      if (!inferredCurrencyId) inferredCurrencyId = toReg.currency_id;
    } else if (resolvedToAccountId) {
      const acc = await assertActiveAccount(client, companyId, resolvedToAccountId, 'الحساب المحوَّل إليه');
      toLabel = acc.name;
    } else {
      throw new ApiError(400, 'يجب تحديد الصندوق أو الحساب المحوَّل إليه');
    }

    if (resolvedFromAccountId === resolvedToAccountId) {
      throw new ApiError(400, 'لا يمكن التحويل من وإلى نفس الحساب أو الصندوق');
    }

    // 3) تحديد العملة وسعر الصرف
    if (!inferredCurrencyId) {
      const compRes = await client.query(`SELECT currency_id FROM companies WHERE id = $1`, [companyId]);
      inferredCurrencyId = compRes.rows[0]?.currency_id || null;
    }
    if (!inferredCurrencyId) {
      throw new ApiError(400, 'currency_id مطلوب');
    }

    const curCheck = await client.query(`SELECT id FROM currencies WHERE id = $1`, [inferredCurrencyId]);
    if (!curCheck.rowCount) throw new ApiError(400, 'العملة المحددة غير موجودة');

    let exchangeRate = Number(payload.exchange_rate || 0);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      const ex = await currencyUtil.toBase(companyId, 1, inferredCurrencyId, tDate);
      exchangeRate = Number(ex.rate) || 1;
    }

    // 4) توليد رقم سند التحويل النقدي
    const transferNumber = await NumberingService.next(client, companyId, 'cash_transfer', {
      prefix: 'CTR',
      pad: 5,
    });

    // 5) إنشاء سجل التحويل بحالة مبدئية draft
    const transfer = await CashRegister.createTransfer(client, companyId, {
      transfer_number: transferNumber,
      transfer_date: tDate,
      from_cash_register_id,
      to_cash_register_id,
      from_account_id: resolvedFromAccountId,
      to_account_id: resolvedToAccountId,
      currency_id: inferredCurrencyId,
      exchange_rate: exchangeRate,
      amount: amt,
      status: 'draft',
      notes,
      created_by: userId,
    });

    // 6) إذا كان auto_confirm = true: توليد القيد اليومي وترحيله واعتماد التحويل
    if (auto_confirm) {
      const baseAmount = round2(amt * exchangeRate);
      const desc = `تحويل نقدي ${transferNumber} من (${fromLabel}) إلى (${toLabel})${notes ? ` - ${notes}` : ''}`;

      const lines = [
        {
          account_id: resolvedToAccountId,
          debit: baseAmount,
          credit: 0,
          description: `استلام تحويل نقدي ${transferNumber} (${toLabel})`,
        },
        {
          account_id: resolvedFromAccountId,
          debit: 0,
          credit: baseAmount,
          description: `صرف تحويل نقدي ${transferNumber} (${fromLabel})`,
        },
      ];

      assertBalanced(lines, 'في التحويل النقدي');

      const je = await JournalEntry.create(client, companyId, {
        entry_date: tDate,
        description: desc,
        source_type: 'cash_transfer',
        source_id: transfer.id,
        created_by: userId,
        lines,
      });

      await verifyJournalEntry(client, je.id, 'في التحويل النقدي');
      await JournalEntry.post(client, companyId, je.id, userId);

      const confirmedRes = await client.query(
        `UPDATE cash_transfers
         SET status = 'confirmed',
             journal_entry_id = $1,
             confirmed_by = $2,
             confirmed_at = NOW()
         WHERE id = $3 AND company_id = $4
         RETURNING *`,
        [je.id, userId, transfer.id, companyId]
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return confirmedRes.rows[0];
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return transfer;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[cashRegister.createTransfer] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * 4) إلغاء تحويل نقدي معتمد (إنشاء قيد عكسي)
 * ============================================================ */
const cancelTransfer = async (companyId, userId, transferId) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const trRes = await client.query(
      `SELECT * FROM cash_transfers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [transferId, companyId]
    );
    const transfer = trRes.rows[0];
    if (!transfer) throw new ApiError(404, 'سند التحويل النقدي غير موجود');
    if (transfer.status === 'cancelled') {
      throw new ApiError(400, 'التحويل النقدي ملغى مسبقاً');
    }

    if (transfer.status === 'confirmed' && transfer.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, transfer.journal_entry_id);
      if (!original || !Array.isArray(original.lines) || original.lines.length === 0) {
        throw new ApiError(409, 'تعذر العثور على القيد المحاسبي الأصلي للتحويل لعكسه');
      }

      const reversedLines = original.lines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `إلغاء تحويل نقدي ${transfer.transfer_number} — ${l.description || ''}`,
      }));

      assertBalanced(reversedLines, 'في عكس التحويل النقدي');

      const reverse = await JournalEntry.create(client, companyId, {
        entry_date: new Date().toISOString().slice(0, 10),
        description: `إلغاء تحويل نقدي ${transfer.transfer_number}`,
        source_type: 'adjustment',
        source_id: transfer.id,
        created_by: userId,
        lines: reversedLines,
      });

      await verifyJournalEntry(client, reverse.id, 'في عكس التحويل النقدي');
      await JournalEntry.post(client, companyId, reverse.id, userId);
    }

    const upd = await client.query(
      `UPDATE cash_transfers
       SET status = 'cancelled'
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [transferId, companyId]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return upd.rows[0];
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[cashRegister.cancelTransfer] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * 5) كشف حساب الصندوق النقدي التفصيلي من قيود اليومية
 * ============================================================ */
const getRegisterStatement = async (companyId, registerId, { date_from, date_to } = {}) => {
  // 1) جلب بيانات الصندوق مع رصيده الفعلي المحسوب من القيود
  const register = await CashRegister.findById(null, companyId, registerId);
  if (!register) {
    throw new ApiError(404, 'الصندوق النقدي غير موجود');
  }
  if (!register.account_id) {
    throw new ApiError(400, 'هذا الصندوق غير مرتبط بحساب في شجرة الحسابات');
  }

  // 2) حساب الرصيد الافتتاحي (جميع الحركات المرحّلة قبل date_from)
  let openingBalance = 0;

  if (date_from) {
    const openRes = await pool.query(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS net_before
       FROM journal_entry_lines jel
       INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE je.company_id = $1
         AND jel.account_id = $2
         AND je.status = 'posted'
         AND je.entry_date::date < $3::date`,
      [companyId, register.account_id, date_from]
    );
    openingBalance = round2(openRes.rows[0]?.net_before || 0);
  }

  // 3) جلب حركات الفترة المحددة
  const params = [companyId, register.account_id];
  const conditions = [
    'je.company_id = $1',
    'jel.account_id = $2',
    "je.status = 'posted'",
  ];

  if (date_from) {
    params.push(date_from);
    conditions.push(`je.entry_date::date >= $${params.length}::date`);
  }

  if (date_to) {
    params.push(date_to);
    conditions.push(`je.entry_date::date <= $${params.length}::date`);
  }

  const movesRes = await pool.query(
    `SELECT
       jel.id,
       je.id AS journal_entry_id,
       je.entry_date,
       je.entry_number,
       je.source_type AS reference_type,
       COALESCE(p.voucher_number, exp.expense_number, ct.transfer_number, je.entry_number) AS reference_number,
       COALESCE(NULLIF(jel.description, ''), je.description) AS description,
       COALESCE(jel.debit, 0)::numeric AS debit,
       COALESCE(jel.credit, 0)::numeric AS credit,
       u.name AS created_by_name
     FROM journal_entry_lines jel
     INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
     LEFT JOIN payments p ON je.source_type = 'payment' AND p.id = je.source_id
     LEFT JOIN expenses exp ON je.source_type = 'expense' AND exp.id = je.source_id
     LEFT JOIN cash_transfers ct ON je.source_type = 'cash_transfer' AND ct.id = je.source_id
     LEFT JOIN users u ON u.id = je.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY je.entry_date ASC, je.created_at ASC, jel.id ASC`,
    params
  );

  // 4) حساب الإجماليات والرصيد التراكمي لكل حركة
  let runningBalance = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;

  const movements = movesRes.rows.map((row) => {
    const debit = round2(row.debit || 0);
    const credit = round2(row.credit || 0);
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    runningBalance = round2(runningBalance + debit - credit);

    return {
      id: row.id,
      journal_entry_id: row.journal_entry_id,
      entry_date: row.entry_date,
      entry_number: row.entry_number,
      reference_type: row.reference_type,
      reference_number: row.reference_number,
      description: row.description,
      debit,
      credit,
      balance: runningBalance,
      created_by_name: row.created_by_name,
    };
  });

  const closingBalance = round2(openingBalance + totalDebit - totalCredit);

  return {
    register: {
      id: register.id,
      name: register.name,
      code: register.code,
      currency_code: register.currency_code,
      current_balance: round2(register.current_balance || 0),
      account_id: register.account_id,
      account_code: register.account_code,
      branch_name: register.branch_name,
    },
    opening_balance: openingBalance,
    total_debit: totalDebit,
    total_credit: totalCredit,
    closing_balance: closingBalance,
    movements,
  };
};

module.exports = {
  createRegister,
  updateRegister,
  createTransfer,
  cancelTransfer,
  getRegisterStatement,
};