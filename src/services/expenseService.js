const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Expense = require('../models/Expense');
const JournalEntry = require('../models/JournalEntry');
const NumberingService = require('./numberingService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** يضيف أياماً إلى تاريخ YYYY-MM-DD ويعيد YYYY-MM-DD */
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** تاريخ اليوم حسب قاعدة البيانات (يتجنب مشكلة UTC) */
const todayDb = async (client) => {
  const r = await client.query('SELECT CURRENT_DATE AS d');
  return r.rows[0].d;
};

/* ============================================================
 * إنشاء مصروف
 * القيد:
 *   نقداً:  مدين حساب المصروف / دائن صندوق
 *   آجل:    مدين حساب المصروف / دائن ذمم موردين
 *   جزئي:   مدين حساب المصروف / دائن صندوق + ذمم موردين
 * ============================================================ */
const create = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) البيان
    if (!payload.description || !String(payload.description).trim()) {
      throw new ApiError(400, 'البيان مطلوب');
    }

    // 2) المبلغ
    const amt = round2(Number(payload.amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new ApiError(400, 'المبلغ يجب أن يكون أكبر من صفر');
    }

    // 3) الحساب
    if (!payload.expense_account_id) {
      throw new ApiError(400, 'يجب اختيار حساب المصروف');
    }
    const acc = await client.query(
      `SELECT id, code FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND account_type = 'expense'`,
      [payload.expense_account_id, companyId]
    );
    if (!acc.rowCount) throw new ApiError(400, 'Expense account not found');
    const expenseAccountId = acc.rows[0].id;

    // 4) نوع الدفع + تحقق
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

    // 5) التاريخ + الاستحقاق
    const expenseDate = payload.expense_date || (await todayDb(client));
    const dueDate = payload.due_date
      || (isCredit ? addDays(expenseDate, 30) : null);

    // 6) رقم المصروف
    const expenseNumber = await NumberingService.next(client, companyId, 'expense', {
      prefix: 'EXP', pad: 5,
    });

    // 7) الحسابات المقابلة
    const cashAccountId = await findCashAccount(
      client, companyId, payload.payment_method || 'cash'
    );
    const payableAccountId = await findAccountId(client, companyId, '211');

    // 8) سطور القيد (بالعملة الأساسية)
    const rate = Number(payload.exchange_rate) || 1;
    const amountBase = round2(amt * rate);
    const paidBase = round2(paidAmount * rate);
    const creditBase = round2(amountBase - paidBase);

    const lines = [
      { account_id: expenseAccountId, debit: amountBase, credit: 0, description: payload.description },
    ];
    if (paidBase > 0) {
      lines.push({ account_id: cashAccountId, debit: 0, credit: paidBase, description: 'دفع نقدي' });
    }
    if (creditBase > 0) {
      lines.push({ account_id: payableAccountId, debit: 0, credit: creditBase, description: `ذمة مورد - ${payload.description}` });
    }

    // 9) أنشئ المصروف أولاً (بدون journal_entry_id)
    const status =
      paymentType === 'cash' ? 'paid'
      : paymentType === 'partial' ? 'partial'
      : 'posted';

    const expense = await Expense.create(client, companyId, {
      expense_number: expenseNumber,
      expense_date: expenseDate,
      expense_category: payload.expense_category || 'other',
      expense_account_id: expenseAccountId,
      supplier_id: payload.supplier_id || null,
      description: payload.description,
      amount: amt,
      currency_id: payload.currency_id,
      exchange_rate: rate,
      payment_type: paymentType,
      payment_method: payload.payment_method || null,
      paid_amount: paidAmount,
      due_date: dueDate,
      status,
      journal_entry_id: null,
      external_reference: payload.external_reference || null,
      created_by: userId,
    });

    // 10) أنشئ القيد مع source_id مضبوطاً من البداية
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: expenseDate,
      description: `مصروف - ${payload.description}`,
      source_type: 'expense',
      source_id: expense.id,
      created_by: userId,
      lines,
    });

    // 11) اربط المصروف بالقيد
    await client.query(
      `UPDATE expenses SET journal_entry_id = $1 WHERE id = $2`,
      [entry.id, expense.id]
    );

    // 12) رحّل القيد
    await JournalEntry.post(client, companyId, entry.id, userId);

    await client.query('COMMIT');
    return { ...expense, journal_entry_id: entry.id, due_date: dueDate, paid_amount: paidAmount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * دفع مصروف (سند صرف)
 * ============================================================ */
const pay = async (companyId, userId, expenseId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) قفل السطر
    const expRes = await client.query(
      `SELECT * FROM expenses
       WHERE id = $1 AND company_id = $2 AND status IN ('posted', 'partial')
       FOR UPDATE`,
      [expenseId, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'المصروف غير موجود أو غير قابل للدفع');

    const remaining = round2(Number(exp.amount) - Number(exp.paid_amount || 0));
    if (remaining <= 0.01) {
      throw new ApiError(400, 'المصروف مدفوع بالكامل');
    }

    // 2) المبلغ
    const amt = round2(Number(payload.amount || remaining));
    if (!Number.isFinite(amt) || amt <= 0 || amt > remaining + 0.01) {
      throw new ApiError(400, `المبلغ يجب أن يكون بين 0 و ${remaining}`);
    }

    // 3) التاريخ والطريقة
    const paymentDate = payload.payment_date || (await todayDb(client));
    const method = payload.method || exp.payment_method || 'bank';

    // 4) الحسابات
    const cashAccountId = await findCashAccount(client, companyId, method);
    const payableAccountId = await findAccountId(client, companyId, '211');

    const rate = Number(exp.exchange_rate) || 1;
    const amountBase = round2(amt * rate);

    // 5) سجل الدفع أولاً (حتى يشير إليه القيد)
    const voucherNumber = await NumberingService.next(
      client, companyId, 'pay_voucher', { prefix: 'PAY', pad: 5 }
    );

    const paymentInsert = await client.query(
      `INSERT INTO payments
         (company_id, payment_type, amount, currency_id, payment_date, method,
          reference, created_by, voucher_number, supplier_id, description)
       VALUES ($1, 'pay', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        companyId,
        amt,
        exp.currency_id,
        paymentDate,
        method,
        `EXP:${expenseId}`,
        userId,
        voucherNumber,
        exp.supplier_id,
        `دفع مصروف ${exp.expense_number}`,
      ]
    );
    const paymentId = paymentInsert.rows[0].id;

    // 6) القيد مرتبط بالدفع
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: paymentDate,
      description: `دفع مصروف ${exp.expense_number}`,
      source_type: 'payment',
      source_id: paymentId,
      created_by: userId,
      lines: [
        { account_id: payableAccountId, debit: amountBase, credit: 0, description: 'دفع ذمة مورد' },
        { account_id: cashAccountId,    debit: 0, credit: amountBase, description: 'صرف نقدي' },
      ],
    });

    // 7) ربط الدفع بالقيد
    await client.query(
      `UPDATE payments SET journal_entry_id = $1 WHERE id = $2`,
      [entry.id, paymentId]
    );

    // 8) تحديث المصروف
    const newPaid = round2(Number(exp.paid_amount || 0) + amt);
    const newStatus = newPaid >= Number(exp.amount) - 0.01 ? 'paid' : 'partial';

    await client.query(
      `UPDATE expenses SET paid_amount = $1, status = $2, updated_at = NOW()
       WHERE id = $3`,
      [newPaid, newStatus, expenseId]
    );

    // 9) ترحيل القيد
    await JournalEntry.post(client, companyId, entry.id, userId);

    await client.query('COMMIT');
    return {
      id: expenseId,
      status: newStatus,
      paid_amount: newPaid,
      payment_id: paymentId,
      journal_entry_id: entry.id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * إلغاء مصروف — قيد عكسي
 * ============================================================ */
const cancel = async (companyId, userId, expenseId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expRes = await client.query(
      `SELECT * FROM expenses
       WHERE id = $1 AND company_id = $2 AND status <> 'cancelled'
       FOR UPDATE`,
      [expenseId, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'المصروف غير موجود');

    // لا يمكن إلغاء مصروف مدفوع بالكامل — يجب استرداد بدلاً من ذلك
    if (exp.status === 'paid') {
      throw new ApiError(400, 'لا يمكن إلغاء مصروف مدفوع بالكامل — استخدم الاسترداد');
    }

    // عكس القيد الأصلي
    if (exp.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, exp.journal_entry_id);
      if (original && original.lines) {
        const reversedLines = original.lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `إلغاء: ${l.description || ''}`,
        }));
        const reverse = await JournalEntry.create(client, companyId, {
          entry_date: await todayDb(client),
          description: `إلغاء مصروف ${exp.expense_number}`,
          source_type: 'adjustment',
          source_id: expenseId,
          created_by: userId,
          lines: reversedLines,
        });
        await JournalEntry.post(client, companyId, reverse.id, userId);
      }
    }

    await Expense.updateStatus(companyId, expenseId, 'cancelled', client);
    await client.query('COMMIT');
    return { id: expenseId, status: 'cancelled' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ============================================================
 * Helpers
 * ============================================================ */
async function findAccountId(client, companyId, code) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts
     WHERE company_id = $1 AND code = $2 AND is_active = TRUE`,
    [companyId, code]
  );
  if (!r.rowCount) throw new ApiError(500, `الحساب ${code} غير موجود`);
  return r.rows[0].id;
}

async function findCashAccount(client, companyId, method) {
  const code = method === 'bank' || method === 'cheque' ? '1112' : '1111';
  const r = await client.query(
    `SELECT id FROM chart_of_accounts
     WHERE company_id = $1 AND code = $2 AND is_active = TRUE`,
    [companyId, code]
  );
  if (r.rowCount) return r.rows[0].id;
  throw new ApiError(500, `حساب النقدية ${code} غير موجود — أعد تهيئة الشركة`);
}


const remove = async (companyId, userId, expenseId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expRes = await client.query(
      `SELECT id, status FROM expenses WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [expenseId, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'Expense not found');
    if (exp.status !== 'draft') {
      throw new ApiError(400, 'لا يمكن حذف مصروف مرحّل — استخدم الإلغاء بدلاً من ذلك');
    }
    await client.query(`DELETE FROM expenses WHERE id = $1`, [expenseId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
module.exports = {
  create,
  pay,
  cancel,
  list: (companyId, query) => Expense.list(companyId, query),
  getOne: (companyId, id) => Expense.findById(companyId, id),
  remove,
};