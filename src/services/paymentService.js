// services/paymentService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const JournalEntry = require('../models/JournalEntry');
const Notification = require('../models/Notification');
const NumberingService = require('./numberingService');
const settingsService = require('./settingsService');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
  buildPaymentLines,
  buildRefundLines,
  buildCreditApplyLines,
} = require('./journalHelper');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * ✅ حساب الصندوق/البنك — مع التحقق من الملكية والنشاط
 */
async function findCashAccount(client, companyId, method) {
  const isBank = method === 'bank' || method === 'cheque';
  const settingsKey = isBank ? 'payment_bank_account_id' : 'payment_cash_account_id';

  // 1) حاول من settings
  const accountId = await settingsService.get(companyId, settingsKey, null, client);
  if (accountId) {
    const check = await client.query(
      `SELECT id FROM chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [accountId, companyId]
    );
    if (check.rowCount) return accountId;
    console.warn(
      `[paymentService] settings.${settingsKey}=${accountId} is invalid — falling back`
    );
  }

  // 2) fallback: الكود الافتراضي
  const code = isBank ? '1112' : '1111';
  const accounts = await requireActiveAccounts(
    client, companyId, [code], `في حساب ${isBank ? 'البنك' : 'الصندوق'}`
  );
  return accounts[code];
}

/**
 * ✅ جلب سعر صرف الفاتورة
 */
async function getInvoiceRate(client, companyId, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(so.exchange_rate, po.exchange_rate, i.exchange_rate, 1)::numeric AS rate
     FROM invoices i
     LEFT JOIN sales_orders so ON so.id = i.reference_id AND i.reference_type = 'sales_order'
     LEFT JOIN purchase_orders po ON po.id = i.reference_id AND i.reference_type = 'purchase_order'
     WHERE i.id = $1 AND i.company_id = $2`,
    [invoiceId, companyId]
  );
  return r.rowCount ? Number(r.rows[0].rate) : 1;
}

/**
 * ✅ العملة الأساسية للشركة
 */
async function getCompanyBaseCurrencyId(client, companyId) {
  const r = await client.query(
    `SELECT currency_id FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!r.rowCount) throw new ApiError(500, 'Company not found');
  return r.rows[0].currency_id;
}

/**
 * ✅ رقم السند
 */
async function generateVoucherNumber(client, companyId, type) {
  const seqName = type === 'receive' ? 'payment_receipt' : 'payment_voucher';
  return NumberingService.next(client, companyId, seqName);
}

/**
 * ✅ إنشاء قيد + Payment معاً بشكل ذرّي
 * - ينشئ القيد (draft)
 * - ينشئ Payment
 * - يربط القيد بالدفعة
 * - يتحقق من التوازن
 * - يُرحّل القيد
 * - كل ذلك داخل نفس transaction
 */
async function createPaymentWithJournal(client, companyId, userId, {
  lines,
  entryDate,
  entryDescription,
  sourceType,
  paymentData,
}) {
  // 1) التحقق من التوازن قبل الإنشاء
  assertBalanced(lines, 'في الدفعة');

  // 2) إنشاء القيد (draft)
  const je = await JournalEntry.create(client, companyId, {
    entry_date: entryDate || new Date().toISOString().slice(0, 10),
    description: entryDescription,
    source_type: sourceType || 'payment',
    source_id: null, // سيُحدَّث
    created_by: userId,
    lines,
  });

  // 3) verify بعد الإنشاء (defensive)
  await verifyJournalEntry(client, je.id, 'في الدفعة');

  // 4) إنشاء Payment
  const payment = await Payment.create(client, companyId, {
    ...paymentData,
    journal_entry_id: je.id,
    created_by: userId,
  });

  // 5) ربط القيد بالدفعة
  const link = await client.query(
    `UPDATE journal_entries
     SET source_id = $1
     WHERE id = $2 AND company_id = $3
     RETURNING id`,
    [payment.id, je.id, companyId]
  );
  if (!link.rowCount) {
    throw new ApiError(500, 'فشل ربط القيد بالدفعة');
  }

  // 6) ترحيل القيد
  await JournalEntry.post(client, companyId, je.id, userId);

  return { payment, journal_entry_id: je.id };
}

// ═══════════════════════════════════════════════════════════════
// 1) سداد فاتورة بيع (receive)
// Dr صندوق/بنك — Cr ذمم عملاء
// ═══════════════════════════════════════════════════════════════

const createForInvoice = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل الفاتورة
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [payload.invoice_id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');
    if (inv.invoice_type !== 'sales') {
      throw new ApiError(400, 'Use createForPurchaseInvoice for purchase invoices');
    }
    if (inv.status === 'cancelled') throw new ApiError(400, 'Invoice is cancelled');
    if (inv.status === 'paid') throw new ApiError(400, 'Invoice is already paid');

    // 2) المبلغ
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, 'Amount must be > 0');
    }

    const remaining = round2(Number(inv.total) - Number(inv.paid_amount));
    if (amount > remaining + 0.01) {
      throw new ApiError(400, `Amount exceeds remaining balance (${remaining})`);
    }

    // 3) العملة + سعر الصرف
    const invRate = await getInvoiceRate(client, companyId, inv.id);
    const amountBase = round2(amount * invRate);

    // 4) الحسابات (إجبارية)
    const cashAccountId = payload.cash_account_id
      || (await findCashAccount(client, companyId, payload.method || 'cash'));

    const accounts = await requireActiveAccounts(
      client, companyId, ['112'], 'في دفعة الفاتورة'
    );

    // 5) بناء السطور
    const lines = buildPaymentLines({
      accounts: { cashAccountId, partyAccountId: accounts['112'] },
      amount: amountBase,
      direction: 'receive',
      reference: inv.invoice_number,
      description: `دفعة فاتورة ${inv.invoice_number}`,
    });

    // 6) رقم السند
    const voucherNumber = await generateVoucherNumber(client, companyId, 'receive');

    // 7) إنشاء Payment + قيد بشكل ذرّي
    const result = await createPaymentWithJournal(client, companyId, userId, {
      lines,
      entryDate: payload.payment_date,
      entryDescription: `دفعة فاتورة ${inv.invoice_number}`,
      sourceType: 'payment',
      paymentData: {
        invoice_id: inv.id,
        payment_type: 'receive',
        amount,
        currency_id: inv.currency_id,
        payment_date: payload.payment_date || new Date().toISOString().slice(0, 10),
        method: payload.method || 'cash',
        reference: payload.reference || null,
        external_reference: payload.external_reference || null,
        description: payload.description || null,
        voucher_number: voucherNumber,
      },
    });

    // 8) تحديث paid_amount
    const updatedInv = await Invoice.updatePaidAmount(client, inv.id);

    await client.query('COMMIT');
    transactionStarted = false;

    // 9) إشعار (best effort — خارج transaction)
    try {
      const notifyClient = await pool.connect();
      try {
        await Notification.create(notifyClient, {
          companyId,
          type: 'payment_received',
          title: `دفعة مستلمة: ${voucherNumber}`,
          message: `استلمت ${amount} على الفاتورة ${inv.invoice_number}.`,
          metadata: { payment_id: result.payment.id, invoice_id: inv.id, amount },
          referenceType: 'payment',
          referenceId: result.payment.id,
          uniqueKey: `payment_received:${result.payment.id}`,
        });
      } finally {
        notifyClient.release();
      }
    } catch (e) {
      console.error('[payment] notification failed:', e.message);
    }

    return { payment: result.payment, invoice: updatedInv };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payment.createForInvoice] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 2) دفع فاتورة شراء (pay)
// Dr ذمم موردين — Cr صندوق/بنك
// ═══════════════════════════════════════════════════════════════

const createForPurchaseInvoice = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const invRes = await client.query(
      `SELECT * FROM invoices
       WHERE id = $1 AND company_id = $2 AND invoice_type = 'purchase'
       FOR UPDATE`,
      [payload.invoice_id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Purchase invoice not found');
    if (inv.status === 'cancelled') throw new ApiError(400, 'Invoice is cancelled');
    if (inv.status === 'paid') throw new ApiError(400, 'Invoice is already paid');

    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, 'Amount must be > 0');
    }

    const remaining = round2(Number(inv.total) - Number(inv.paid_amount));
    if (amount > remaining + 0.01) {
      throw new ApiError(400, `Amount exceeds remaining balance (${remaining})`);
    }

    const invRate = await getInvoiceRate(client, companyId, inv.id);
    const amountBase = round2(amount * invRate);

    const cashAccountId = payload.cash_account_id
      || (await findCashAccount(client, companyId, payload.method || 'cash'));

    const accounts = await requireActiveAccounts(
      client, companyId, ['211'], 'في دفعة الفاتورة'
    );

    const lines = buildPaymentLines({
      accounts: { cashAccountId, partyAccountId: accounts['211'] },
      amount: amountBase,
      direction: 'pay',
      reference: inv.invoice_number,
      description: `دفعة لمورد ${inv.invoice_number}`,
    });

    const voucherNumber = await generateVoucherNumber(client, companyId, 'pay');

    const result = await createPaymentWithJournal(client, companyId, userId, {
      lines,
      entryDate: payload.payment_date,
      entryDescription: `دفعة لمورد — ${inv.invoice_number}`,
      sourceType: 'payment',
      paymentData: {
        invoice_id: inv.id,
        payment_type: 'pay',
        amount,
        currency_id: inv.currency_id,
        payment_date: payload.payment_date || new Date().toISOString().slice(0, 10),
        method: payload.method || 'cash',
        reference: payload.reference || null,
        external_reference: payload.external_reference || null,
        description: payload.description || null,
        voucher_number: voucherNumber,
      },
    });

    const updatedInv = await Invoice.updatePaidAmount(client, inv.id);
    await client.query('COMMIT');
    transactionStarted = false;

    // إشعار
    try {
      const notifyClient = await pool.connect();
      try {
        await Notification.create(notifyClient, {
          companyId,
          type: 'payment_made',
          title: `دفعة صادرة: ${voucherNumber}`,
          message: `دفعت ${amount} للمورد على الفاتورة ${inv.invoice_number}.`,
          metadata: { payment_id: result.payment.id, invoice_id: inv.id, amount },
          referenceType: 'payment',
          referenceId: result.payment.id,
          uniqueKey: `payment_made:${result.payment.id}`,
        });
      } finally {
        notifyClient.release();
      }
    } catch (e) {
      console.error('[payment] notification failed:', e.message);
    }

    return { payment: result.payment, invoice: updatedInv };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payment.createForPurchaseInvoice] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 3) سند يدوي (بدون فاتورة)
// ═══════════════════════════════════════════════════════════════

const createManualPayment = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const {
      payment_type, amount, payment_date,
      method = 'cash', reference, external_reference, description,
      supplier_id, customer_id, cash_account_id,
    } = payload;

    if (!description || !String(description).trim()) {
      throw new ApiError(400, 'البيان مطلوب');
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new ApiError(400, 'Amount must be > 0');
    }

    if (!['receive', 'pay'].includes(payment_type)) {
      throw new ApiError(400, 'Invalid payment_type');
    }

    // الحساب المقابل + الحسابات المطلوبة
    let partyAccountCode;
    if (payment_type === 'receive') {
      if (!customer_id) throw new ApiError(400, 'يرجى اختيار العميل');
      const c = await client.query(
        `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
        [customer_id, companyId]
      );
      if (!c.rowCount) throw new ApiError(400, 'Customer not found or inactive');
      partyAccountCode = '112';
    } else {
      if (!supplier_id) throw new ApiError(400, 'يرجى اختيار المورد');
      const s = await client.query(
        `SELECT id FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
        [supplier_id, companyId]
      );
      if (!s.rowCount) throw new ApiError(400, 'Supplier not found or inactive');
      partyAccountCode = '211';
    }

    const accounts = await requireActiveAccounts(
      client, companyId, [partyAccountCode], 'في السند'
    );

    const cashAccountId = cash_account_id
      || (await findCashAccount(client, companyId, method));

    // بناء السطور
    const lines = buildPaymentLines({
      accounts: { cashAccountId, partyAccountId: accounts[partyAccountCode] },
      amount: amt,
      direction: payment_type === 'receive' ? 'receive' : 'pay',
      reference: description,
      description,
    });

    // رقم السند + العملة
    const voucherNumber = await generateVoucherNumber(client, companyId, payment_type);
    const currencyId = await getCompanyBaseCurrencyId(client, companyId);

    // إنشاء Payment + قيد
    const result = await createPaymentWithJournal(client, companyId, userId, {
      lines,
      entryDate: payment_date,
      entryDescription: `سند ${payment_type === 'receive' ? 'قبض' : 'صرف'} — ${description}`,
      sourceType: 'payment',
      paymentData: {
        invoice_id: null,
        supplier_id: supplier_id || null,
        customer_id: customer_id || null,
        payment_type,
        amount: amt,
        currency_id: currencyId,
        payment_date: payment_date || new Date().toISOString().slice(0, 10),
        method,
        reference: reference || null,
        voucher_number: voucherNumber,
        external_reference: external_reference || null,
        description: description || null,
      },
    });

    await client.query('COMMIT');
    transactionStarted = false;
    return { payment: result.payment, journal_entry_id: result.journal_entry_id };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payment.createManualPayment] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 4) استرداد نقدي لعميل (Refund)
// Dr ذمم — Cr صندوق
// ═══════════════════════════════════════════════════════════════

const refundToCustomer = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { customer_id, amount, return_id, method, reference } = payload;

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new ApiError(400, 'Amount must be > 0');
    }

    // 1) تحقق من العميل
    const cust = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [customer_id, companyId]
    );
    if (!cust.rowCount) throw new ApiError(400, 'Customer not found or inactive');

    // 2) تحقق من المرتجع (إن وُجد)
    let returnRef = null;
    if (return_id) {
      const ret = await client.query(
        `SELECT id, return_number, total, status, customer_id
         FROM returns
         WHERE id = $1 AND company_id = $2 AND return_type = 'sale'`,
        [return_id, companyId]
      );
      if (!ret.rowCount) throw new ApiError(404, 'Return not found');
      returnRef = ret.rows[0];

      if (returnRef.customer_id !== customer_id) {
        throw new ApiError(400, 'Return does not belong to this customer');
      }
      if (returnRef.status !== 'confirmed') {
        throw new ApiError(400, 'Return must be confirmed before refund');
      }

      // سقف الاسترداد
      const refundedRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS refunded
         FROM payments
         WHERE company_id = $1
           AND refund_of_payment_id IS NULL
           AND payment_type = 'refund'
           AND notes LIKE '%' || $2 || '%'`,
        [companyId, returnRef.return_number]
      );
      const alreadyRefunded = Number(refundedRes.rows[0].refunded);
      const remainingReturn = round2(Number(returnRef.total) - alreadyRefunded);

      if (amt > remainingReturn + 0.01) {
        throw new ApiError(400, `Refund amount (${amt}) exceeds remaining return balance (${remainingReturn})`);
      }
    }

    // 3) رصيد العميل
    const credit = await Payment.getCustomerCredit(client, companyId, customer_id);
    if (amt > credit + 0.01) {
      throw new ApiError(400, `Refund amount (${amt}) exceeds customer credit (${credit})`);
    }

    // 4) الحسابات + رقم السند
    const accounts = await requireActiveAccounts(
      client, companyId, ['112'], 'في الاسترداد'
    );
    const cashAccountId = payload.cash_account_id
      || (await findCashAccount(client, companyId, method || 'cash'));

    const voucherNumber = await generateVoucherNumber(client, companyId, 'pay');

    // 5) السطور
    const lines = buildRefundLines({
      accounts: { cashAccountId, partyAccountId: accounts['112'] },
      amount: amt,
      reference: returnRef ? returnRef.return_number : voucherNumber,
    });

    // 6) العملة
    const currencyId = await getCompanyBaseCurrencyId(client, companyId);

    // 7) إنشاء Payment + قيد
    const result = await createPaymentWithJournal(client, companyId, userId, {
      lines,
      entryDate: payload.payment_date,
      entryDescription: `استرداد نقدي لعميل ${returnRef ? `— مرتجع ${returnRef.return_number}` : ''} (${voucherNumber})`,
      sourceType: 'payment',
      paymentData: {
        invoice_id: null,
        customer_id,
        payment_type: 'refund',
        amount: amt,
        currency_id: currencyId,
        payment_date: payload.payment_date || new Date().toISOString().slice(0, 10),
        method: method || 'cash',
        reference: reference || null,
        voucher_number: voucherNumber,
        description: returnRef
          ? `استرداد لمرتجع ${returnRef.return_number}`
          : 'استرداد لعميل',
      },
    });

    // 8) ملاحظة المرتجع
    if (returnRef) {
      const noteUpd = await client.query(
        `UPDATE payments SET notes = $1 WHERE id = $2 AND company_id = $3 RETURNING id`,
        [`refund for return ${returnRef.return_number}`, result.payment.id, companyId]
      );
      if (!noteUpd.rowCount) {
        throw new ApiError(500, 'فشل تحديث ملاحظة الدفعة');
      }
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return { payment: result.payment, journal_entry_id: result.journal_entry_id };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payment.refundToCustomer] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 5) تخصيص رصيد دائن لعميل على فاتورة
// Dr ذمم — Cr ذمم (نفس الحساب، صافي صفر)
// ═══════════════════════════════════════════════════════════════

const applyCreditToInvoice = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { invoice_id, amount } = payload;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new ApiError(400, 'Amount must be > 0');
    }

    // 1) قفل الفاتورة
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [invoice_id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');
    if (inv.status === 'paid' || inv.status === 'cancelled') {
      throw new ApiError(400, 'Invoice cannot receive credit');
    }
    if (!inv.customer_id) {
      throw new ApiError(400, 'Invoice has no customer');
    }

    const remaining = round2(Number(inv.total) - Number(inv.paid_amount));
    if (amt > remaining + 0.01) {
      throw new ApiError(400, `Amount exceeds remaining balance (${remaining})`);
    }

    // 2) رصيد العميل
    const credit = await Payment.getCustomerCredit(client, companyId, inv.customer_id);
    if (amt > credit + 0.01) {
      throw new ApiError(400, `Amount (${amt}) exceeds customer credit (${credit})`);
    }

    // 3) الحسابات
    const accounts = await requireActiveAccounts(
      client, companyId, ['112'], 'في تخصيص الرصيد'
    );

    const voucherNumber = await generateVoucherNumber(client, companyId, 'receive');

    // 4) السطور (Dr 112 / Cr 112 — صافي صفر)
    const lines = buildCreditApplyLines({
      accounts: { partyAccountId: accounts['112'] },
      amount: amt,
      reference: inv.invoice_number,
    });

    // 5) إنشاء Payment + قيد
    const result = await createPaymentWithJournal(client, companyId, userId, {
      lines,
      entryDate: new Date().toISOString().slice(0, 10),
      entryDescription: `تخصيص رصيد - ${inv.invoice_number}`,
      sourceType: 'payment',
      paymentData: {
        invoice_id,
        customer_id: inv.customer_id,
        payment_type: 'credit_apply',
        amount: amt,
        currency_id: inv.currency_id,
        payment_date: new Date().toISOString().slice(0, 10),
        method: null,
        reference: null,
        voucher_number: voucherNumber,
        description: `تخصيص رصيد — ${inv.invoice_number}`,
      },
    });

    // 6) تحديث paid_amount
    const updatedInv = await Invoice.updatePaidAmount(client, invoice_id);

    await client.query('COMMIT');
    transactionStarted = false;
    return { payment: result.payment, invoice: updatedInv };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payment.applyCreditToInvoice] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 6) حذف دفعة (عكس القيد)
// ═══════════════════════════════════════════════════════════════

const remove = async (companyId, userId, id) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل الدفعة
    const payRes = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const payment = payRes.rows[0];
    if (!payment) throw new ApiError(404, 'Payment not found');

    // 2) منع الحذف لو لها refunds
    const refunds = await client.query(
      `SELECT 1 FROM payments WHERE refund_of_payment_id = $1 LIMIT 1`,
      [id]
    );
    if (refunds.rowCount) {
      throw new ApiError(400, 'Cannot delete payment: has refunds attached');
    }

    // 3) عكس القيد
    if (payment.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, payment.journal_entry_id);
      if (!original) {
        throw new ApiError(409, `Cannot delete: original journal entry ${payment.journal_entry_id} not found`);
      }
      if (!Array.isArray(original.lines) || original.lines.length === 0) {
        throw new ApiError(409, `Cannot delete: original journal entry has no lines`);
      }

      const reversedLines = original.lines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `حذف دفعة — ${l.description || ''}`,
      }));

      assertBalanced(reversedLines, 'في عكس الدفعة');

      const reverse = await JournalEntry.create(client, companyId, {
        entry_date: new Date().toISOString().slice(0, 10),
        description: `حذف دفعة - ${payment.voucher_number || payment.id}`,
        source_type: 'adjustment',
        source_id: payment.id,
        created_by: userId,
        lines: reversedLines,
      });

      await verifyJournalEntry(client, reverse.id, 'في عكس الدفعة');
      await JournalEntry.post(client, companyId, reverse.id, userId);
    }

    // 4) حذف الدفعة (مع company_id)
    const del = await client.query(
      `DELETE FROM payments WHERE id = $1 AND company_id = $2 RETURNING id, invoice_id`,
      [id, companyId]
    );
    if (!del.rowCount) {
      throw new ApiError(409, 'فشل حذف الدفعة — قد تكون معدّلة من عملية أخرى');
    }

    if (del.rows[0].invoice_id) {
      await Invoice.updatePaidAmount(client, del.rows[0].invoice_id);
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return { id, deleted: true };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payment.remove] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createForInvoice,
  createForPurchaseInvoice,
  createManualPayment,
  refundToCustomer,
  applyCreditToInvoice,
  remove,
};