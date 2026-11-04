const ApiError = require('../../../errors/ApiError');
const JournalEntry = require('../../../models/JournalEntry');
const { getBuyerAccounts, getSupplierAccounts, getCashAccount } = require('./accounts');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PAYMENT_TYPES = ['cash', 'credit', 'partial'];
const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'card', 'wallet', 'other'];

/**
 * يتحقق من نوع الدفع وطريقة الدفع (بدون مبالغ).
 * يُستدعى في create.
 */
function validatePaymentType(payload) {
  const payment_type = payload.payment_type || 'credit';
  if (!PAYMENT_TYPES.includes(payment_type)) {
    throw new ApiError(400, `payment_type must be one of: ${PAYMENT_TYPES.join(', ')}`);
  }

  const payment_terms_days =
    payload.payment_terms_days != null
      ? Math.max(0, Number(payload.payment_terms_days))
      : 30;

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

/**
 * يحسب due_date و paid_amount بناءً على total.
 * يُستدعى في create بعد calculateTotals.
 */
function computePaymentAmounts(payment, total, orderDate) {
  const { payment_type, payment_method, payment_terms_days, paid_amount_input } = payment;
  const base = new Date(orderDate);

  let due_date = null;
  let paid_amount = 0;

  if (payment_type === 'cash') {
    due_date = orderDate;
    paid_amount = 0; // يُسجَّل عند confirm
  } else if (payment_type === 'credit') {
    const d = new Date(base);
    d.setDate(d.getDate() + payment_terms_days);
    due_date = d.toISOString().slice(0, 10);
  } else if (payment_type === 'partial') {
    if (paid_amount_input >= Number(total)) {
      throw new ApiError(400, 'paid_amount must be less than total for partial payment');
    }
    const d = new Date(base);
    d.setDate(d.getDate() + payment_terms_days);
    due_date = d.toISOString().slice(0, 10);
    paid_amount = paid_amount_input;
  }

  return {
    payment_type,
    payment_method,
    payment_terms_days,
    due_date,
    paid_amount,
    paid_at: null,
  };
}

/**
 * ينفذ الدفع عند confirm:
 * - cash: دفعة كاملة
 * - credit: لا دفعة
 * - partial: دفعة مقدمة
 *
 * ينشئ payments + قيود صندوق للطرفين + يحدّث invoices.paid_amount.
 */
async function handlePayment(client, {
  order,
  companyId,
  userId,
  supplierCompanyId,
  salesInvoiceId,
  purchaseInvoiceId,   // ← أضف في التوقيع
}) {
  const type = order.payment_type || 'credit';
  const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
  const totalBase = round2(Number(order.total) * rate);

  // credit: لا دفعة
  if (type === 'credit') {
    return { type, paid_amount: 0, paid_at: null, payment_id: null };
  }

  // احسب المبلغ المدفوع بالعملة الأساسية
  let paidAmount = 0;
  if (type === 'cash') {
    paidAmount = totalBase;
  } else if (type === 'partial') {
    const basePaid = round2(Number(order.paid_amount) * rate);
    paidAmount = basePaid > 0 ? basePaid : 0;
  }

  if (paidAmount <= 0) {
    return { type, paid_amount: 0, paid_at: null, payment_id: null };
  }

  const paidAt = new Date().toISOString();
  const method = order.payment_method || 'cash';

  // ═══ 1) دفعة المشتري (صادرة) ═══
  const buyerPayment = await client.query(
    `INSERT INTO payments
       (company_id, payment_type, amount, currency_id, payment_date,
        method, reference, created_by)
     VALUES ($1,'pay',$2,$3,CURRENT_DATE,$4,$5,$6)
     RETURNING id`,
    [
      companyId,
      paidAmount,
      order.currency_id,
      method,
      order.order_number,   // ← بدون PO- (order_number يحتويها أصلاً)
      userId,
    ]
  );
  const paymentId = buyerPayment.rows[0].id;

  const buyerAccounts = await getBuyerAccounts(client, companyId);
  const buyerEntryId = await createCashPaymentJournal(client, {
    companyId,
    userId,
    entryDate: order.order_date,
    amount: paidAmount,
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

  // ═══ 2) حدّث فاتورة المشتريات (إن وُجدت) ═══
  if (purchaseInvoiceId) {
    await client.query(
      `UPDATE invoices
       SET paid_amount = paid_amount + $1,
           status = CASE
             WHEN paid_amount + $1 >= total - 0.01 THEN 'paid'
             ELSE 'partial'
           END
       WHERE id = $2`,
      [paidAmount, purchaseInvoiceId]
    );
  }

  // ═══ 3) دفعة المورد (واردة) ═══
  if (supplierCompanyId) {
    const supplierPayment = await client.query(
      `INSERT INTO payments
         (company_id, payment_type, amount, currency_id, payment_date,
          method, reference, created_by)
       VALUES ($1,'receive',$2,$3,CURRENT_DATE,$4,$5,NULL)
       RETURNING id`,
      [
        supplierCompanyId,
        paidAmount,
        order.currency_id,
        method,
        order.order_number,   // ← بدون PO-
      ]
    );
    const supplierPaymentId = supplierPayment.rows[0].id;

    const supplierAccounts = await getSupplierAccounts(client, supplierCompanyId);
    const supplierEntryId = await createCashPaymentJournal(client, {
      companyId: supplierCompanyId,
      userId: null,
      entryDate: order.order_date,
      amount: paidAmount,
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

    // ═══ 4) حدّث فاتورة المبيعات (المورد) ═══
    if (salesInvoiceId) {
      await client.query(
        `UPDATE invoices
         SET paid_amount = paid_amount + $1,
             status = CASE
               WHEN paid_amount + $1 >= total - 0.01 THEN 'paid'
               ELSE 'partial'
             END
         WHERE id = $2`,
        [paidAmount, salesInvoiceId]
      );
    }
  }

  return {
    type,
    paid_amount: paidAmount,
    paid_at: paidAt,
    payment_id: paymentId,
  };
}


/**
 * قيد صندوق/بنك:
 * - صادر (المشتري): مدين ذمم / دائن صندوق
 * - وارد (المورد):  مدين صندوق / دائن ذمم
 */


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
  const lines = isOutgoing
    ? [
        { account_id: partyAccountId, debit: amount, credit: 0, description },
        { account_id: cashAccountId, debit: 0, credit: amount, description: 'صندوق/بنك' },
      ]
    : [
        { account_id: cashAccountId, debit: amount, credit: 0, description: 'صندوق/بنك' },
        { account_id: partyAccountId, debit: 0, credit: amount, description },
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
};