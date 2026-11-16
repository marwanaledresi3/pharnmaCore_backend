// services/expenseService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Expense = require('../models/Expense');
const JournalEntry = require('../models/JournalEntry');
const NumberingService = require('./numberingService');
const settingsService = require('./settingsService');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
  buildExpenseLines,
  buildExpensePayLines,
} = require('./journalHelper');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const todayDb = async (client) => {
  const r = await client.query('SELECT CURRENT_DATE AS d');
  return r.rows[0].d;
};

/**
 * ✅ حساب الصندوق/البنك — مع التحقق من settings + الملكية + النشاط
 */
async function findCashAccount(client, companyId, method) {
  const isBank = method === 'bank' || method === 'cheque';
  const settingsKey = isBank ? 'payment_bank_account_id' : 'payment_cash_account_id';

  const accountId = await settingsService.get(companyId, settingsKey, null, client);
  if (accountId) {
    const check = await client.query(
      `SELECT id FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [accountId, companyId]
    );
    if (check.rowCount) return accountId;
    console.warn(`[expenseService] settings.${settingsKey}=${accountId} is invalid — fallback`);
  }

  const code = isBank ? '1112' : '1111';
  const accounts = await requireActiveAccounts(
    client, companyId, [code], `في حساب ${isBank ? 'البنك' : 'الصندوق'}`
  );
  return accounts[code];
}

const paymentReferenceForExpense = (expenseId) => `EXP:${expenseId}`;

// ═══════════════════════════════════════════════════════════════
// 1) إنشاء مصروف — محصّن
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 1) إنشاء مصروف — محصّن ومرتبط بالصناديق النقدية
// ═══════════════════════════════════════════════════════════════

const create = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) البيان
    if (!payload.description || !String(payload.description).trim()) {
      throw new ApiError(400, 'البيان مطلوب');
    }

    // 2) المبلغ
    const amt = round2(Number(payload.amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new ApiError(400, 'المبلغ يجب أن يكون أكبر من صفر');
    }

    // 3) العملة
    if (!payload.currency_id) throw new ApiError(400, 'currency_id مطلوب');
    const cur = await client.query(`SELECT id FROM currencies WHERE id = $1`, [payload.currency_id]);
    if (!cur.rowCount) throw new ApiError(400, 'Currency not found');

    // 4) سعر الصرف
    const rate = Number(payload.exchange_rate);
    const finalRate = Number.isFinite(rate) && rate > 0 ? rate : 1;

    // 5) الحساب
    if (!payload.expense_account_id) throw new ApiError(400, 'يجب اختيار حساب المصروف');
    const acc = await client.query(
      `SELECT id, code FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND account_type = 'expense' AND is_active = TRUE`,
      [payload.expense_account_id, companyId]
    );
    if (!acc.rowCount) throw new ApiError(400, 'Expense account not found or inactive');
    const expenseAccountId = acc.rows[0].id;

    // 6) نوع الدفع
    const paymentType = payload.payment_type || 'cash';
    if (!['cash', 'credit', 'partial'].includes(paymentType)) {
      throw new ApiError(400, 'نوع الدفع غير صحيح');
    }

    const isCredit = paymentType === 'credit' || paymentType === 'partial';
    if (isCredit && !payload.supplier_id) {
      throw new ApiError(400, 'المورد مطلوب للمصروف الآجل/الجزئي');
    }

    let paidAmount = 0;
    if (paymentType === 'cash') {
      paidAmount = amt;
    } else if (paymentType === 'partial') {
      paidAmount = round2(Number(payload.paid_amount || 0));
      if (paidAmount <= 0 || paidAmount >= amt) {
        throw new ApiError(400, 'المبلغ المدفوع يجب أن يكون بين 0 والإجمالي');
      }
    } else {
      if (Number(payload.paid_amount) > 0) {
        throw new ApiError(400, 'المصروف الآجل لا يحتوي مبلغاً مدفوعاً');
      }
    }

    // 7) التاريخ
    const expenseDate = payload.expense_date || (await todayDb(client));
    const dueDate = payload.due_date || (isCredit ? addDays(expenseDate, 30) : null);

    // 8) رقم المصروف — من settings
    const expenseNumber = await NumberingService.next(client, companyId, 'expense');

    // 9) حساب الذمم (إن وُجد)
    let payableAccountId = null;
    if (isCredit) {
      const accs = await requireActiveAccounts(
        client, companyId, ['211'], 'في المصروف'
      );
      payableAccountId = accs['211'];
    }

    // 10) الحسابات والقيد (بالعملة الأساسية)
    const amountBase = round2(amt * finalRate);
    const paidBase = round2(paidAmount * finalRate);
    const creditBase = round2(amountBase - paidBase);

    const method = payload.payment_method || 'cash';
    let paymentSource = { accountId: null, registerId: null };

    if (paidBase > 0) {
      paymentSource = await resolvePaymentSource(
        client,
        companyId,
        method,
        method === 'cash' ? (payload.cash_register_id || null) : null
      );
    }

    // بناء السطور
    const lines = buildExpenseLines({
      accounts: {
        expenseAccountId,
        cashAccountId: paymentSource.accountId,
        payableAccountId,
      },
      amountBase,
      paidBase,
      creditBase,
      description: payload.description,
    });

    // التحقق من التوازن
    assertBalanced(lines, 'في المصروف');

    // 11) الحالة
    const status =
      paymentType === 'cash' ? 'paid'
      : paymentType === 'partial' ? 'partial'
      : 'posted';

    // 12) إنشاء المصروف
    const expense = await Expense.create(client, companyId, {
      expense_number: expenseNumber,
      expense_date: expenseDate,
      expense_category: payload.expense_category || 'other',
      expense_account_id: expenseAccountId,
      supplier_id: payload.supplier_id || null,
      description: payload.description,
      amount: amt,
      currency_id: payload.currency_id,
      exchange_rate: finalRate,
      payment_type: paymentType,
      payment_method: paymentType !== 'credit' ? method : null,
      cash_register_id: paymentSource.registerId,
      paid_amount: paidAmount,
      due_date: dueDate,
      status,
      journal_entry_id: null,
      external_reference: payload.external_reference || null,
      created_by: userId,
    });

    // ضمان حفظ cash_register_id في حال لم يكن مدرجاً داخل Expense.create
    if (paymentSource.registerId) {
      await client.query(
        `UPDATE expenses SET cash_register_id = $1 WHERE id = $2 AND company_id = $3`,
        [paymentSource.registerId, expense.id, companyId]
      );
    }

    // 13) القيد
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: expenseDate,
      description: `مصروف - ${payload.description}`,
      source_type: 'expense',
      source_id: expense.id,
      created_by: userId,
      lines,
    });

    // verify بعد الإنشاء
    await verifyJournalEntry(client, entry.id, 'في المصروف');

    // 14) ربط القيد بالمصروف
    const link = await client.query(
      `UPDATE expenses SET journal_entry_id = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id`,
      [entry.id, expense.id, companyId]
    );
    if (!link.rowCount) {
      throw new ApiError(500, 'فشل ربط القيد بالمصروف');
    }

    // 15) ترحيل القيد
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 16) خصم المبلغ المدفوع نقداً من رصيد الصندوق
    if (paymentSource.registerId && paidBase > 0) {
      await client.query(
        `UPDATE cash_registers
         SET current_balance = COALESCE(current_balance, 0) - $1,
             updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [paidBase, paymentSource.registerId, companyId]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      ...expense,
      cash_register_id: paymentSource.registerId,
      journal_entry_id: entry.id,
      due_date: dueDate,
      paid_amount: paidAmount,
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[expense.create] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 2) دفع مصروف — محصّن
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 2) دفع مصروف — محصّن ومرتبط بالصناديق النقدية
// ═══════════════════════════════════════════════════════════════

const pay = async (companyId, userId, expenseId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل المصروف
    const expRes = await client.query(
      `SELECT * FROM expenses
       WHERE id = $1 AND company_id = $2 AND status IN ('posted', 'partial')
       FOR UPDATE`,
      [expenseId, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'المصروف غير موجود أو غير قابل للدفع');

    const remaining = round2(Number(exp.amount) - Number(exp.paid_amount || 0));
    if (remaining <= 0.01) throw new ApiError(400, 'المصروف مدفوع بالكامل');

    // 2) المبلغ
    const amt = round2(Number(payload.amount || remaining));
    if (!Number.isFinite(amt) || amt <= 0 || amt > remaining + 0.01) {
      throw new ApiError(400, `المبلغ يجب أن يكون بين 0 و ${remaining}`);
    }

    // 3) التاريخ والطريقة
    const paymentDate = payload.payment_date || (await todayDb(client));
    const method = payload.method || exp.payment_method || 'bank';

    // 4) الحسابات (إجبارية) + تحديد الصندوق
    const accounts = await requireActiveAccounts(
      client, companyId, ['211'], 'في دفع المصروف'
    );
    const payableAccountId = accounts['211'];

    const paymentSource = await resolvePaymentSource(
      client,
      companyId,
      method,
      method === 'cash' ? (payload.cash_register_id || null) : null
    );
    const cashAccountId = paymentSource.accountId;

    const rate = Number(exp.exchange_rate) || 1;
    const amountBase = round2(amt * rate);

    // 5) رقم السند — من settings
    const voucherNumber = await NumberingService.next(
      client, companyId, 'payment_voucher'
    );

    // 6) بناء السطور + التحقق
    const lines = buildExpensePayLines({
      accounts: { payableAccountId, cashAccountId },
      amountBase,
      reference: exp.expense_number,
    });

    assertBalanced(lines, 'في دفع المصروف');

    // 7) إنشاء القيد أولاً (قبل Payment)
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: paymentDate,
      description: `دفع مصروف ${exp.expense_number}`,
      source_type: 'payment',
      source_id: null,
      created_by: userId,
      lines,
    });

    // verify بعد الإنشاء
    await verifyJournalEntry(client, entry.id, 'في دفع المصروف');

    // 8) إنشاء Payment (بعد القيد) مع cash_register_id
    const paymentInsert = await client.query(
      `INSERT INTO payments
         (company_id, payment_type, amount, currency_id, payment_date, method,
          reference, created_by, voucher_number, supplier_id, description,
          journal_entry_id, cash_register_id)
       VALUES ($1, 'pay', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        companyId, amt, exp.currency_id, paymentDate, method,
        paymentReferenceForExpense(expenseId),
        userId, voucherNumber, exp.supplier_id,
        `دفع مصروف ${exp.expense_number}`,
        entry.id,
        paymentSource.registerId,
      ]
    );
    const paymentId = paymentInsert.rows[0].id;

    // 9) ربط القيد بالدفعة
    const link = await client.query(
      `UPDATE journal_entries SET source_id = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id`,
      [paymentId, entry.id, companyId]
    );
    if (!link.rowCount) {
      throw new ApiError(500, 'فشل ربط القيد بالدفعة');
    }

    // 10) تحديث المصروف
    const newPaid = round2(Number(exp.paid_amount || 0) + amt);
    const newStatus = newPaid >= Number(exp.amount) - 0.01 ? 'paid' : 'partial';

    const upd = await client.query(
      `UPDATE expenses
       SET paid_amount = $1, status = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4 AND status IN ('posted', 'partial')
       RETURNING id`,
      [newPaid, newStatus, expenseId, companyId]
    );
    if (!upd.rowCount) {
      throw new ApiError(409, 'فشل تحديث المصروف — قد يكون معدّلاً من عملية أخرى');
    }

    // 11) ترحيل القيد
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 12) خصم المبلغ من رصيد الصندوق عند الدفع نقداً
    if (paymentSource.registerId && amountBase > 0) {
      await client.query(
        `UPDATE cash_registers
         SET current_balance = COALESCE(current_balance, 0) - $1,
             updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [amountBase, paymentSource.registerId, companyId]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      id: expenseId,
      status: newStatus,
      paid_amount: newPaid,
      payment_id: paymentId,
      journal_entry_id: entry.id,
      cash_register_id: paymentSource.registerId,
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[expense.pay] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 3) إلغاء مصروف — محصّن
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 3) إلغاء مصروف — محصّن مع إعادة الأرصدة للصناديق النقدية
// ═══════════════════════════════════════════════════════════════

const cancel = async (companyId, userId, expenseId) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const expRes = await client.query(
      `SELECT * FROM expenses
       WHERE id = $1 AND company_id = $2 AND status <> 'cancelled'
       FOR UPDATE`,
      [expenseId, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'المصروف غير موجود');

    if (exp.status === 'paid') {
      throw new ApiError(400, 'لا يمكن إلغاء مصروف مدفوع بالكامل — استخدم الاسترداد');
    }

    const rate = Number(exp.exchange_rate) || 1;

    // 3a) عكس القيد الأصلي
    if (exp.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, exp.journal_entry_id);
      if (!original) {
        throw new ApiError(409, 'Cannot cancel: original journal entry not found');
      }
      if (!Array.isArray(original.lines) || original.lines.length === 0) {
        throw new ApiError(409, 'Cannot cancel: original journal entry has no lines');
      }

      const reversedLines = original.lines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `إلغاء: ${l.description || ''}`,
      }));

      assertBalanced(reversedLines, 'في عكس قيد المصروف');

      const reverse = await JournalEntry.create(client, companyId, {
        entry_date: await todayDb(client),
        description: `إلغاء مصروف ${exp.expense_number}`,
        source_type: 'adjustment',
        source_id: expenseId,
        created_by: userId,
        lines: reversedLines,
      });

      await verifyJournalEntry(client, reverse.id, 'في عكس قيد المصروف');
      await JournalEntry.post(client, companyId, reverse.id, userId);
    }

    // 3b) عكس قيود الدفعات المرتبطة وإعادة أرصدتها للصناديق
    const paymentsRes = await client.query(
      `SELECT journal_entry_id, cash_register_id, amount FROM payments
       WHERE company_id = $1 AND reference = $2
         AND journal_entry_id IS NOT NULL`,
      [companyId, paymentReferenceForExpense(expenseId)]
    );

    let refundedFromPaymentsBase = 0;

    for (const p of paymentsRes.rows) {
      const original = await JournalEntry.findById(companyId, p.journal_entry_id);
      if (!original?.lines) continue;

      const reversedLines = original.lines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `إلغاء دفعة: ${l.description || ''}`,
      }));

      assertBalanced(reversedLines, 'في عكس دفعة المصروف');

      const reverse = await JournalEntry.create(client, companyId, {
        entry_date: await todayDb(client),
        description: `إلغاء دفعة مصروف ${exp.expense_number}`,
        source_type: 'adjustment',
        source_id: expenseId,
        created_by: userId,
        lines: reversedLines,
      });

      await verifyJournalEntry(client, reverse.id, 'في عكس دفعة المصروف');
      await JournalEntry.post(client, companyId, reverse.id, userId);

      const pBase = round2(Number(p.amount || 0) * rate);
      refundedFromPaymentsBase = round2(refundedFromPaymentsBase + pBase);

      if (p.cash_register_id && pBase > 0) {
        await client.query(
          `UPDATE cash_registers
           SET current_balance = COALESCE(current_balance, 0) + $1,
               updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [pBase, p.cash_register_id, companyId]
        );
      }
    }

    // 3c) إعادة الدفعة المقدمة (في حال المصروف الجزئي) إلى الصندوق الأصلي
    const totalPaidBase = round2(Number(exp.paid_amount || 0) * rate);
    const initialPaidBase = round2(Math.max(0, totalPaidBase - refundedFromPaymentsBase));

    if (exp.cash_register_id && initialPaidBase > 0) {
      await client.query(
        `UPDATE cash_registers
         SET current_balance = COALESCE(current_balance, 0) + $1,
             updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [initialPaidBase, exp.cash_register_id, companyId]
      );
    }

    // 3d) تحديث الحالة
    const upd = await client.query(
      `UPDATE expenses
       SET status = 'cancelled'
       WHERE id = $1 AND company_id = $2 AND status <> 'cancelled'
       RETURNING id`,
      [expenseId, companyId]
    );
    if (!upd.rowCount) {
      throw new ApiError(409, 'فشل الإلغاء — قد يكون معدّلاً من عملية أخرى');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return { id: expenseId, status: 'cancelled' };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[expense.cancel] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 4) حذف مصروف (للملغى فقط) — محصّن
// ═══════════════════════════════════════════════════════════════

const remove = async (companyId, userId, expenseId) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const expRes = await client.query(
      `SELECT id, expense_number, status FROM expenses
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [expenseId, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'Expense not found');

    if (exp.status !== 'cancelled') {
      throw new ApiError(400, 'لا يمكن حذف مصروف غير ملغى — استخدم الإلغاء أولاً');
    }

    // ✅ DELETE مع company_id + RETURNING
    const del = await client.query(
      `DELETE FROM expenses
       WHERE id = $1 AND company_id = $2 AND status = 'cancelled'
       RETURNING id`,
      [expenseId, companyId]
    );
    if (!del.rowCount) {
      throw new ApiError(409, 'فشل الحذف — قد يكون معدّلاً من عملية أخرى');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return { id: expenseId, deleted: true };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[expense.remove] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

/**
 * ✅ حساب الصندوق/البنك — يدعم الصناديق النقدية المخصصة + fallback للإعدادات والحساب 1111/1112
 */
async function resolvePaymentSource(client, companyId, method, cashRegisterId = null) {
  const isBank = method === 'bank' || method === 'cheque';

  // 1) إذا كانت الطريقة نقداً وتم تحديد صندوق نقدي
  if (!isBank && cashRegisterId) {
    const regRes = await client.query(
      `SELECT id, account_id, is_active
       FROM cash_registers
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [cashRegisterId, companyId]
    );
    if (!regRes.rowCount) {
      throw new ApiError(404, 'الصندوق النقدي المحدد غير موجود');
    }
    const reg = regRes.rows[0];
    if (!reg.is_active) {
      throw new ApiError(400, 'الصندوق النقدي المحدد موقوف');
    }
    if (!reg.account_id) {
      throw new ApiError(400, 'الصندوق النقدي غير مرتبط بحساب محاسبي');
    }
    return { accountId: reg.account_id, registerId: reg.id };
  }

  // 2) الإعدادات العامة (payment_bank_account_id / payment_cash_account_id)
  const settingsKey = isBank ? 'payment_bank_account_id' : 'payment_cash_account_id';
  const accountId = await settingsService.get(companyId, settingsKey, null, client);
  if (accountId) {
    const check = await client.query(
      `SELECT id FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [accountId, companyId]
    );
    if (check.rowCount) {
      return { accountId, registerId: null };
    }
    console.warn(`[expenseService] settings.${settingsKey}=${accountId} is invalid — fallback`);
  }

  // 3) الحساب الافتراضي 1111 أو 1112
  const code = isBank ? '1112' : '1111';
  const accounts = await requireActiveAccounts(
    client, companyId, [code], `في حساب ${isBank ? 'البنك' : 'الصندوق'}`
  );
  return { accountId: accounts[code], registerId: null };
}
module.exports = { create, pay, cancel, remove };