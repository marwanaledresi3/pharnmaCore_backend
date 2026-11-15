// services/purchaseOrder/helpers/payment.js
const ApiError = require('../../../errors/ApiError');
const JournalEntry = require('../../../models/JournalEntry');
const NumberingService = require('../../numberingService');
const { getBuyerAccounts, getSupplierAccounts, getCashAccount } = require('./accounts');
const { ensureCustomer } = require('./customers');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PAYMENT_TYPES = ['cash', 'credit', 'partial'];
const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'card', 'wallet', 'other'];

/* ============================================================
 * 1) التحقق من نوع الدفع
 * ============================================================ */
function validatePaymentType(payload) {
  const payment_type = payload.payment_type || 'credit';
  if (!PAYMENT_TYPES.includes(payment_type)) {
    throw new ApiError(400, `payment_type must be one of: ${PAYMENT_TYPES.join(', ')}`);
  }

  const payment_terms_days = payload.payment_terms_days != null ? Math.max(0, Number(payload.payment_terms_days)) : 30;
  if (!Number.isFinite(payment_terms_days)) throw new ApiError(400, 'payment_terms_days must be a number');

  const payment_method = payload.payment_method || null;
  if (payment_method && !PAYMENT_METHODS.includes(payment_method)) {
    throw new ApiError(400, `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  }

  if ((payment_type === 'cash' || payment_type === 'partial') && !payment_method) {
    throw new ApiError(400, 'payment_method is required for cash/partial payments');
  }

  let paid_amount_input = null;
  if (payment_type === 'partial') {
    paid_amount_input = Number(payload.paid_amount);
    if (!Number.isFinite(paid_amount_input) || paid_amount_input <= 0) {
      throw new ApiError(400, 'paid_amount must be > 0 for partial payment');
    }
  }

  return { payment_type, payment_method, payment_terms_days, paid_amount_input };
}

/* ============================================================
 * 2) حساب المبالغ (بعد معرفة total)
 * ============================================================ */
function computePaymentAmounts(payment, total, orderDate) {
  const { payment_type, payment_method, payment_terms_days, paid_amount_input } = payment;
  const base = new Date(orderDate);
  const totalNum = round2(Number(total) || 0);

  if (!Number.isFinite(totalNum) || totalNum < 0) throw new ApiError(400, 'Invalid total');

  let due_date = null;
  let paid_amount = 0;
  let paid_at = null;

  if (payment_type === 'cash') {
    due_date = orderDate;
    paid_amount = totalNum;
    paid_at = new Date().toISOString();
  } else if (payment_type === 'credit') {
    const d = new Date(base);
    d.setDate(d.getDate() + payment_terms_days);
    due_date = d.toISOString().slice(0, 10);
    paid_amount = 0;
  } else if (payment_type === 'partial') {
    if (paid_amount_input >= totalNum) {
      throw new ApiError(400, `paid_amount (${paid_amount_input}) must be less than total (${totalNum}) for partial payment. Use payment_type='cash' to pay the full amount.`);
    }
    const d = new Date(base);
    d.setDate(d.getDate() + payment_terms_days);
    due_date = d.toISOString().slice(0, 10);
    paid_amount = round2(paid_amount_input);
    paid_at = new Date().toISOString();
  }

  return { payment_type, payment_method, payment_terms_days, due_date, paid_amount, paid_at };
}

/* ============================================================
 * 3) تنفيذ الدفع عند confirm
 *
 * القرارات:
 * - payments.amount = بالعملة الأصلية (order.currency_id)
 * - journal_entry_lines.debit/credit = بالعملة الأساسية (company)
 * - invoices.total = بالعملة الأصلية (متوافق مع payments.amount)
 *
 * إرجاع:
 * - paid_amount (أساسية) — للتوافق مع confirm.js
 * - paid_amount_original (أصلية) — للتوافق مع purchase_orders.paid_amount
 * ============================================================ */
async function handlePayment(client, {
  order,
  companyId,
  userId,
  supplierCompanyId,
  salesInvoiceId,
  purchaseInvoiceId,
}) {
  const type = order.payment_type || 'credit';
  const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
  const totalOriginal = round2(Number(order.total) || 0);
  const totalBase = round2(totalOriginal * rate);

  // آجل — لا دفعة
  if (type === 'credit') {
    return {
      type,
      paid_amount: 0,
      paid_amount_original: 0,
      paid_at: null,
      payment_id: null,
    };
  }

  // حساب المبلغ بالعملتين
  let paidAmountOriginal = 0;
  let paidAmountBase = 0;

  if (type === 'cash') {
    paidAmountOriginal = totalOriginal;
    paidAmountBase = totalBase;
  } else if (type === 'partial') {
    paidAmountOriginal = round2(Number(order.paid_amount) || 0);
    paidAmountBase = round2(paidAmountOriginal * rate);
  }

  if (paidAmountOriginal <= 0 || paidAmountBase <= 0) {
    return {
      type,
      paid_amount: 0,
      paid_amount_original: 0,
      paid_at: null,
      payment_id: null,
    };
  }

  if (paidAmountBase > totalBase + 0.01) {
    throw new ApiError(500, `paidAmountBase (${paidAmountBase}) exceeds totalBase (${totalBase})`);
  }

  const paidAt = new Date().toISOString();
  const method = order.payment_method || 'cash';
  const entryDate = new Date().toISOString().slice(0, 10);

  // ═══ 1) دفعة المشتري (صادرة) ═══
  const buyerVoucher = await NumberingService.next(client, companyId, 'payment_pay', {
    prefix: 'PAY', pad: 4, resetYearly: true,
  });

  const buyerPayment = await client.query(
    `INSERT INTO payments
       (company_id, payment_type, amount, currency_id, payment_date, method, reference,
        created_by, voucher_number, supplier_id, invoice_id)
     VALUES ($1, 'pay', $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      companyId,
      paidAmountOriginal,      // ✅ بالعملة الأصلية
      order.currency_id,       // ✅ متوافق
      method,
      order.order_number,
      userId,
      buyerVoucher,
      order.supplier_id,
      purchaseInvoiceId || null,
    ]
  );
  const paymentId = buyerPayment.rows[0].id;

  // ═══ قيد المشتري (بالعملة الأساسية) ═══
  const buyerAccounts = await getBuyerAccounts(client, companyId);
  const buyerEntryId = await createCashPaymentJournal(client, {
    companyId,
    userId,
    entryDate,
    amount: paidAmountBase,
    partyAccountId: buyerAccounts.payable,
    cashAccountId: await getCashAccount(client, companyId, method),
    method,
    description: `دفعة أمر شراء ${order.order_number}`,
    isOutgoing: true,
    sourceType: 'purchase_payment',
    sourceId: order.id,
  });

  await client.query(
    `UPDATE payments SET journal_entry_id = $1 WHERE id = $2`,
    [buyerEntryId, paymentId]
  );

  if (purchaseInvoiceId) {
    await updateInvoicePaidAmount(client, {
      invoiceId: purchaseInvoiceId,
      paidAmountOriginal,
    });
  }

  // ═══ 2) دفعة المورد (واردة) — للشبكة ═══
  if (supplierCompanyId) {
    const customerId = await ensureCustomer(client, {
      supplierCompanyId,
      buyerCompanyId: order.company_id,
    });

    const supplierVoucher = await NumberingService.next(client, supplierCompanyId, 'payment_receive', {
      prefix: 'REC', pad: 4, resetYearly: true,
    });

    const supplierPayment = await client.query(
      `INSERT INTO payments
         (company_id, payment_type, amount, currency_id, payment_date, method, reference,
          created_by, voucher_number, customer_id, invoice_id)
       VALUES ($1, 'receive', $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        supplierCompanyId,
        paidAmountOriginal,      // ✅ بالعملة الأصلية
        order.currency_id,
        method,
        order.order_number,
        userId,
        supplierVoucher,
        customerId,
        salesInvoiceId || null,
      ]
    );
    const supplierPaymentId = supplierPayment.rows[0].id;

    const supplierAccounts = await getSupplierAccounts(client, supplierCompanyId);
    const supplierEntryId = await createCashPaymentJournal(client, {
      companyId: supplierCompanyId,
      userId,
      entryDate,
      amount: paidAmountBase,
      partyAccountId: supplierAccounts.receivable,
      cashAccountId: await getCashAccount(client, supplierCompanyId, method),
      method,
      description: `دفعة واردة لأمر شراء ${order.order_number}`,
      isOutgoing: false,
      sourceType: 'sales_payment',
      sourceId: order.id,
    });

    await client.query(
      `UPDATE payments SET journal_entry_id = $1 WHERE id = $2`,
      [supplierEntryId, supplierPaymentId]
    );

    if (salesInvoiceId) {
      await updateInvoicePaidAmount(client, {
        invoiceId: salesInvoiceId,
        paidAmountOriginal,
      });
    }
  }

  return {
    type,
    paid_amount: paidAmountBase,              // بالعملة الأساسية
    paid_amount_original: paidAmountOriginal, // بالعملة الأصلية
    paid_at: paidAt,
    payment_id: paymentId,
  };
}

/* ============================================================
 * 4) تحديث invoices.paid_amount + status
 *
 * - paidAmountOriginal بالعملة الأصلية (متوافق مع invoices.total)
 * - FOR UPDATE لمنع race condition
 * - LEAST لمنع تجاوز total
 * ============================================================ */
async function updateInvoicePaidAmount(client, { invoiceId, paidAmountOriginal }) {
  const lock = await client.query(
    `SELECT id, total FROM invoices WHERE id = $1 FOR UPDATE`,
    [invoiceId]
  );
  if (!lock.rowCount) {
    throw new ApiError(404, `Invoice ${invoiceId} not found`);
  }

  const amountNum = round2(paidAmountOriginal);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new ApiError(500, `Invalid paidAmountOriginal: ${paidAmountOriginal}`);
  }

  await client.query(
    `UPDATE invoices SET
       paid_amount = LEAST(paid_amount + $1, total),
       status = CASE
         WHEN paid_amount + $1 >= total - 0.01 THEN 'paid'
         ELSE 'partial'
       END
     WHERE id = $2`,
    [amountNum, invoiceId]
  );
}

/* ============================================================
 * 5) قيد صندوق/بنك
 *
 * ⚠️ amount بالعملة الأساسية (company)
 * ⚠️ يقفل القيد إن وُجد (لا يوجد قيد)
 * ============================================================ */
async function createCashPaymentJournal(client, {
  companyId,
  userId,
  entryDate,
  amount,
  partyAccountId,
  cashAccountId,
  description,
  isOutgoing,
  sourceType,
  sourceId,
}) {
  const amountNum = round2(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new ApiError(500, `Invalid payment amount: ${amount}`);
  }

  if (!partyAccountId) throw new ApiError(500, 'partyAccountId is required');
  if (!cashAccountId) throw new ApiError(500, 'cashAccountId is required');

  const lines = isOutgoing
    ? [
        { account_id: partyAccountId, debit: amountNum, credit: 0, description },
        { account_id: cashAccountId, debit: 0, credit: amountNum, description: 'صندوق/بنك' },
      ]
    : [
        { account_id: cashAccountId, debit: amountNum, credit: 0, description: 'صندوق/بنك' },
        { account_id: partyAccountId, debit: 0, credit: amountNum, description },
      ];

  const entry = await JournalEntry.create(client, companyId, {
    entry_date: entryDate,
    description,
    source_type: sourceType,
    source_id: sourceId,
    created_by: userId,
    lines,
  });

  await JournalEntry.post(client, companyId, entry.id, userId);
  return entry.id;
}

module.exports = {
  validatePaymentType,
  computePaymentAmounts,
  handlePayment,
  createCashPaymentJournal,
  updateInvoicePaidAmount,
};