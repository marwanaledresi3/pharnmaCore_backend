const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const JournalEntry = require('../models/JournalEntry');
const Notification = require('../models/Notification');
/**
 * إرجاع نقدي لعميل (Refund)
 * القيد: مدين: ذمم مدينة — دائن: صندوق/بنك
 */
const refundToCustomer = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { customer_id, amount, return_id, method, reference } = payload;

    const amt = Number(amount);
    if (amt <= 0) throw new ApiError(400, 'Amount must be > 0');

    // 1) تحقق من العميل
    const cust = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2`,
      [customer_id, companyId]
    );
    if (!cust.rowCount) throw new ApiError(400, 'Customer not found');

    // 2) تحقق من رصيد العميل الدائن
    const credit = await Payment.getCustomerCredit(client, companyId, customer_id);
    if (amt > credit + 0.01) {
      throw new ApiError(400, `Refund amount (${amt}) exceeds customer credit (${credit})`);
    }

    // 3) جلب الحسابات
    const cashAccountId = payload.cash_account_id
      || await findAccountId(client, companyId, '1111');
    const receivableId = await findAccountId(client, companyId, '1120');

    // 4) القيد: Dr ذمم — Cr صندوق
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: payload.payment_date || new Date().toISOString().slice(0, 10),
      description: `استرداد نقدي لعميل${return_id ? ` - مرتجع` : ''}`,
      source_type: 'payment',
      source_id: null,
      created_by: userId,
      lines: [
        { account_id: receivableId, debit: amt, credit: 0, description: 'استرداد لعميل' },
        { account_id: cashAccountId, credit: amt, debit: 0, description: 'صرف نقدي' },
      ],
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 5) إنشاء payment
    const currencyRes = await client.query(
      `SELECT currency_id FROM companies WHERE id = $1`,
      [companyId]
    );

    const payment = await Payment.create(client, companyId, {
      invoice_id: null,
      payment_type: 'refund',
      amount: amt,
      currency_id: currencyRes.rows[0].currency_id,
      payment_date: payload.payment_date || new Date().toISOString().slice(0, 10),
      method: method || 'cash',
      reference: reference || null,
      journal_entry_id: entry.id,
      created_by: userId,
    });

    // 6) ربط القيد بالدفعة + notes
    await client.query(
      `UPDATE payments SET notes = $1 WHERE id = $2`,
      [return_id ? `refund for return ${return_id}` : null, payment.id]
    );
    await client.query(
      `UPDATE journal_entries SET source_id = $1 WHERE id = $2`,
      [payment.id, entry.id]
    );

    await client.query('COMMIT');
    return { payment, journal_entry_id: entry.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * تخصيص رصيد دائن لعميل على فاتورة (Credit Apply)
 * القيد: مدين: ذمم — دائن: ذمم (نفس الحساب، لكن يخفّض رصيده)
 * ⚠️ عملياً، لا نحتاج قيد لأن الحساب نفسه يتأثر بالطرفين.
 *      لكن للتتبع نُنشئ قيداً شكلياً.
 */
const applyCreditToInvoice = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { invoice_id, amount } = payload;
    const amt = Number(amount);
    if (amt <= 0) throw new ApiError(400, 'Amount must be > 0');

    // 1) الفاتورة
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [invoice_id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');
    if (inv.status === 'paid' || inv.status === 'cancelled') {
      throw new ApiError(400, 'Invoice cannot receive credit');
    }

    const remaining = Number(inv.total) - Number(inv.paid_amount);
    if (amt > remaining + 0.01) {
      throw new ApiError(400, `Amount exceeds remaining balance (${remaining})`);
    }

    // 2) تحقق من رصيد العميل
    const credit = await Payment.getCustomerCredit(client, companyId, inv.customer_id);
    if (amt > credit + 0.01) {
      throw new ApiError(400, `Amount (${amt}) exceeds customer credit (${credit})`);
    }

    // 3) القيد: Dr ذمم — Cr ذمم (صافي صفر لكن للسجل)
    const receivableId = await findAccountId(client, companyId, '1120');
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: new Date().toISOString().slice(0, 10),
      description: `تخصيص رصيد دائن - ${inv.invoice_number}`,
      source_type: 'payment',
      source_id: null,
      created_by: userId,
      lines: [
        { account_id: receivableId, debit: amt, credit: 0, description: 'استخدام رصيد' },
        { account_id: receivableId, credit: amt, debit: 0, description: 'تخصيص لفاتورة' },
      ],
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 4) إنشاء payment
    const payment = await Payment.create(client, companyId, {
      invoice_id,
      payment_type: 'credit_apply',
      amount: amt,
      currency_id: inv.currency_id,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'credit',
      reference: null,
      journal_entry_id: entry.id,
      created_by: userId,
    });

    // 5) تحديث paid_amount
    const updatedInv = await Invoice.updatePaidAmount(client, invoice_id);

    await client.query('COMMIT');
    return { payment, invoice: updatedInv };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * إنشاء دفعة مرتبطة بفاتورة
 * القيد: مدين: صندوق/بنك — دائن: ذمم مدينة
 */
const createForInvoice = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) جلب الفاتورة مع lock
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [payload.invoice_id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');
    if (inv.status === 'cancelled') throw new ApiError(400, 'Invoice is cancelled');
    if (inv.status === 'paid') throw new ApiError(400, 'Invoice is already paid');

    const amount = Number(payload.amount);
    if (amount <= 0) throw new ApiError(400, 'Amount must be > 0');

    const remaining = Number(inv.total) - Number(inv.paid_amount);
    if (amount > remaining + 0.01) {
      throw new ApiError(400, `Amount exceeds remaining balance (${remaining})`);
    }
    const invRate = await getInvoiceRate(client, companyId, inv.id);
    const amountBase = round2(Number(amount) * invRate);


    // 2) جلب الحسابات
    const cashAccountId = payload.cash_account_id || await findAccountId(client, companyId, '1111');
    const receivableId = await findAccountId(client, companyId, '1120');

    // 3) إنشاء قيد محاسبي
    const lines = [
      { account_id: cashAccountId, debit: amountBase, credit: 0, description: 'قبض دفعة' },
      { account_id: receivableId, credit: amountBase, debit: 0, description: `دفعة فاتورة ${inv.invoice_number}` },
    ];
    const entry = await JournalEntry.create(client, companyId, {
      entry_date: payload.payment_date || new Date().toISOString().slice(0, 10),
      description: `دفعة فاتورة ${inv.invoice_number}`,
      source_type: 'payment',
      source_id: null,
      created_by: userId,
      lines,
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 4) إنشاء الدفعة
    const payment = await Payment.create(client, companyId, {
      invoice_id: payload.invoice_id,
      payment_type: 'receive',
      amount,
      currency_id: inv.currency_id,
      payment_date: payload.payment_date || new Date().toISOString().slice(0, 10),
      method: payload.method || 'cash',
      reference: payload.reference || null,
      journal_entry_id: entry.id,
      created_by: userId,
    });

    const voucherNumber = await generateVoucherNumber(client, companyId, 'receive');
    await client.query(
      `UPDATE payments SET voucher_number = $1 WHERE id = $2`,
      [voucherNumber, payment.id]
    );
    payment.voucher_number = voucherNumber;

    // 5) تحديث ربط القيد (source_id)
    await client.query(
      `UPDATE journal_entries SET source_id = $1 WHERE id = $2`,
      [payment.id, entry.id]
    );

    // 6) تحديث paid_amount و status
    const updatedInv = await Invoice.updatePaidAmount(client, inv.id);

    await client.query('COMMIT');
    // بعد إنشاء الدفعة والـ commit:
    const client2 = await pool.connect();
    try {
        await Notification.create(client2, {
            companyId,
            type: 'payment_received',
            title: `دفعة مستلمة: ${payment.id.slice(0, 8)}`,
            message: `استلمت ${amount} على الفاتورة ${inv.invoice_number}.`,
            metadata: { payment_id: payment.id, invoice_id: inv.id, amount },
            referenceType: 'payment',
            referenceId: payment.id,
            uniqueKey: `payment_received:${payment.id}`,  // لا تكرار
    });
    } finally {
        client2.release();
    }
    return { payment, invoice: updatedInv };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * حذف دفعة (عكس القيد + تحديث الفاتورة)
 */
const remove = async (companyId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payment = await Payment.findById(companyId, id);
    if (!payment) throw new ApiError(404, 'Payment not found');

    // إنشاء قيد عكسي
    if (payment.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, payment.journal_entry_id);
      if (original) {
        const reversedLines = original.lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `حذف دفعة`,
        }));
        const reverse = await JournalEntry.create(client, companyId, {
          entry_date: new Date().toISOString().slice(0, 10),
          description: `حذف دفعة - ${payment.id}`,
          source_type: 'adjustment',
          source_id: payment.id,
          created_by: null,
          lines: reversedLines,
        });
        await JournalEntry.post(client, companyId, reverse.id, null);
      }
    }

    const removed = await Payment.delete(client, companyId, id);
    if (removed?.invoice_id) {
      await Invoice.updatePaidAmount(client, removed.invoice_id);
    }

    await client.query('COMMIT');
    return { id, deleted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ============ Helpers ============

async function findAccountId(client, companyId, code) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND code = $2`,
    [companyId, code]
  );
  if (!r.rowCount) throw new ApiError(500, `Required account ${code} not found`);
  return r.rows[0].id;
}
async function getInvoiceRate(client, companyId, invoiceId) {
  // نستخدم order.exchange_rate (من sales_orders أو purchase_orders)
  const r = await client.query(
    `SELECT COALESCE(so.exchange_rate, po.exchange_rate, 1)::numeric AS rate
     FROM invoices i
     LEFT JOIN sales_orders so ON so.id = i.reference_id AND i.reference_type = 'sales_order'
     LEFT JOIN purchase_orders po ON po.id = i.reference_id AND i.reference_type = 'purchase_order'
     WHERE i.id = $1 AND i.company_id = $2`,
    [invoiceId, companyId]
  );
  return r.rowCount ? Number(r.rows[0].rate) : 1;
}
async function generateVoucherNumber(client, companyId, type) {
  const prefix = type === 'receive' ? 'REC' : 'PAY';
  const year = new Date().getFullYear();
  const r = await client.query(
    `SELECT COUNT(*)::int + 1 AS next FROM payments
     WHERE company_id = $1 AND payment_type = $2
       AND EXTRACT(YEAR FROM created_at) = $3`,
    [companyId, type, year]
  );
  return `${prefix}-${year}-${String(r.rows[0].next).padStart(4, '0')}`;
}
/**
 * دفع لمورد (payment_type='pay')
 * القيد: مدين: ذمم دائنة — دائن: صندوق/بنك
 */
const createForPurchaseInvoice = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type = 'purchase' FOR UPDATE`,
      [payload.invoice_id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Purchase invoice not found');
    if (inv.status === 'cancelled') throw new ApiError(400, 'Invoice is cancelled');
    if (inv.status === 'paid') throw new ApiError(400, 'Invoice is already paid');

    const amount = Number(payload.amount);
    if (amount <= 0) throw new ApiError(400, 'Amount must be > 0');

    const remaining = Number(inv.total) - Number(inv.paid_amount);
    if (amount > remaining + 0.01) {
      throw new ApiError(400, `Amount exceeds remaining balance (${remaining})`);
    }

    const cashAccountId = payload.cash_account_id || await findAccountId(client, companyId, '1111');
    const payableId = await findAccountId(client, companyId, '2110');

    // مدين: ذمم دائنة — دائن: صندوق/بنك
    const lines = [
      { account_id: payableId, debit: amount, credit: 0, description: `دفع فاتورة ${inv.invoice_number}` },
      { account_id: cashAccountId, credit: amount, debit: 0, description: 'دفعة لمورد' },
    ];

    const entry = await JournalEntry.create(client, companyId, {
      entry_date: payload.payment_date || new Date().toISOString().slice(0, 10),
      description: `دفعة لمورد - ${inv.invoice_number}`,
      source_type: 'payment',
      source_id: null,
      created_by: userId,
      lines,
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    const payment = await Payment.create(client, companyId, {
      invoice_id: payload.invoice_id,
      payment_type: 'pay',
      amount,
      currency_id: inv.currency_id,
      payment_date: payload.payment_date || new Date().toISOString().slice(0, 10),
      method: payload.method || 'cash',
      reference: payload.reference || null,
      journal_entry_id: entry.id,
      created_by: userId,
    });

    await client.query(`UPDATE journal_entries SET source_id = $1 WHERE id = $2`, [payment.id, entry.id]);

    const updatedInv = await Invoice.updatePaidAmount(client, inv.id);

    await client.query('COMMIT');
    return { payment, invoice: updatedInv };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


// أضف إلى module.exports:
module.exports = {
  createForInvoice,
  createForPurchaseInvoice,
  refundToCustomer,
  applyCreditToInvoice,
  remove,
};