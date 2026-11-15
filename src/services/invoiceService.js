// services/invoiceService.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
} = require('./journalHelper');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function findExistingInvoice(client, companyId, referenceType, referenceId) {
  const r = await client.query(
    `SELECT id FROM invoices
     WHERE company_id = $1
       AND reference_type = $2
       AND reference_id = $3
       AND status <> 'cancelled'
     LIMIT 1`,
    [companyId, referenceType, referenceId]
  );
  return r.rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════
// 1) من Sales Order
// ═══════════════════════════════════════════════════════════════

const createFromOrder = async (companyId, userId, orderId, { due_date } = {}) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل الأمر
    const orderRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'confirmed') {
      throw new ApiError(400, 'Only confirmed orders can be invoiced');
    }
    if (!order.journal_entry_id) {
      throw new ApiError(400, 'Sales order has no journal entry — cannot invoice');
    }

    // 2) فحص فاتورة سابقة
    const existing = await findExistingInvoice(client, companyId, 'sales_order', orderId);
    if (existing) {
      throw new ApiError(409, 'Invoice already exists for this order');
    }

    // 3) due_date
    const finalDueDate = due_date || order.due_date || addDays(order.order_date, 30);

    // 4) إنشاء الفاتورة
    const invoice = await Invoice.create(client, companyId, {
      invoice_type: 'sales',
      reference_type: 'sales_order',
      reference_id: orderId,
      customer_id: order.customer_id,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: finalDueDate,
      currency_id: order.currency_id,
      total: order.total,
      journal_entry_id: order.journal_entry_id,
      exchange_rate: order.exchange_rate,
    });

    // 5) تحديث الأمر (مع company_id + status + RETURNING)
    const upd = await client.query(
      `UPDATE sales_orders
       SET status = 'invoiced'
       WHERE id = $1 AND company_id = $2 AND status = 'confirmed'
       RETURNING id`,
      [orderId, companyId]
    );
    if (!upd.rowCount) {
      throw new ApiError(409, 'فشل تحديث أمر البيع — قد يكون معدّلاً من عملية أخرى');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return invoice;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[invoice.createFromOrder] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 2) من Purchase Order
// ═══════════════════════════════════════════════════════════════

const createFromPurchaseOrder = async (companyId, userId, orderId, { due_date } = {}) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const orderRes = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Purchase order not found');
    if (order.status !== 'confirmed') {
      throw new ApiError(400, 'Only confirmed orders can be invoiced');
    }
    if (!order.journal_entry_id) {
      throw new ApiError(400, 'Purchase order has no journal entry — cannot invoice');
    }

    const existing = await findExistingInvoice(client, companyId, 'purchase_order', orderId);
    if (existing) {
      throw new ApiError(409, 'Invoice already exists for this order');
    }

    const finalDueDate = due_date || order.due_date || addDays(order.order_date, 30);

    const invoice = await Invoice.create(client, companyId, {
      invoice_type: 'purchase',
      reference_type: 'purchase_order',
      reference_id: orderId,
      supplier_id: order.supplier_id,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: finalDueDate,
      currency_id: order.currency_id,
      total: order.total,
      journal_entry_id: order.journal_entry_id,
      exchange_rate: order.exchange_rate || 1,
    });

    const upd = await client.query(
      `UPDATE purchase_orders
       SET status = 'invoiced'
       WHERE id = $1 AND company_id = $2 AND status = 'confirmed'
       RETURNING id`,
      [orderId, companyId]
    );
    if (!upd.rowCount) {
      throw new ApiError(409, 'فشل تحديث أمر الشراء — قد يكون معدّلاً من عملية أخرى');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return invoice;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[invoice.createFromPurchaseOrder] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 3) 🆕 من Delivery Note — محصّن
// ═══════════════════════════════════════════════════════════════

const createFromDeliveryNote = async (companyId, userId, deliveryNoteId, { due_date } = {}) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // ─── 1) قفل المذكرة ───
    const dnRes = await client.query(
      `SELECT * FROM delivery_notes
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [deliveryNoteId, companyId]
    );
    const dn = dnRes.rows[0];
    if (!dn) throw new ApiError(404, 'Delivery note not found');
    if (dn.status === 'invoiced') {
      throw new ApiError(400, 'Delivery note already converted to invoice');
    }
    if (dn.status === 'cancelled') {
      throw new ApiError(400, 'Cannot convert cancelled delivery note');
    }
    if (dn.status === 'draft') {
      throw new ApiError(400, 'Delivery note must be dispatched or delivered first');
    }

    // ─── 2) فحص فاتورة سابقة ───
    const existing = await findExistingInvoice(client, companyId, 'delivery_note', deliveryNoteId);
    if (existing) {
      throw new ApiError(409, 'Invoice already exists for this delivery note');
    }

    // ─── 3) جلب البنود ───
    const itemsRes = await client.query(
      `SELECT * FROM delivery_note_items
       WHERE delivery_note_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [deliveryNoteId]
    );
    if (itemsRes.rowCount === 0) {
      throw new ApiError(400, 'Delivery note has no items');
    }

    // ─── 4) العملة ───
    const compRes = await client.query(
      `SELECT currency_id FROM companies WHERE id = $1`,
      [companyId]
    );
    const currencyId = compRes.rows[0]?.currency_id;
    if (!currencyId) throw new ApiError(500, 'Company currency not found');

    // ─── 5) الإجماليات ───
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of itemsRes.rows) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, `Invalid quantity for product ${item.product_id}`);
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new ApiError(400, `Invalid unit_price for product ${item.product_id}`);
      }
      subtotal += qty * price;
    }

    subtotal = round2(subtotal);
    taxTotal = round2(taxTotal);
    const total = round2(subtotal + taxTotal);

    if (total <= 0) {
      throw new ApiError(400, 'Delivery note total must be > 0');
    }

    // ─── 6) الحسابات (إجبارية) ───
    const accounts = await requireActiveAccounts(
      client, companyId, ['112', '411'], 'في فاتورة المذكرة'
    );

    // ─── 7) due_date ───
    const finalDueDate = due_date
      || (dn.delivery_date
        ? addDays(dn.delivery_date, 30)
        : new Date().toISOString().slice(0, 10));

    // ─── 8) القيد المحاسبي ───
    const journalLines = [
      {
        account_id: accounts['112'],
        debit: total,
        credit: 0,
        description: `فاتورة مذكرة تسليم ${dn.delivery_number}`,
      },
      {
        account_id: accounts['411'],
        debit: 0,
        credit: subtotal,
        description: `إيرادات فاتورة ${dn.delivery_number}`,
      },
    ];

    // ✅ assertBalanced قبل الإنشاء
    assertBalanced(journalLines, 'في فاتورة المذكرة');

    const je = await JournalEntry.create(client, companyId, {
      entry_date: new Date().toISOString().slice(0, 10),
      description: `فاتورة بيع من مذكرة تسليم ${dn.delivery_number}`,
      source_type: 'sales_invoice',
      source_id: null,
      created_by: userId,
      lines: journalLines,
    });

    // ✅ verify بعد الإنشاء
    await verifyJournalEntry(client, je.id, 'في فاتورة المذكرة');

    // ─── 9) إنشاء الفاتورة ───
    const invoice = await Invoice.create(client, companyId, {
      invoice_type: 'sales',
      reference_type: 'delivery_note',
      reference_id: deliveryNoteId,
      customer_id: dn.customer_id,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: finalDueDate,
      currency_id: currencyId,
      total,
      journal_entry_id: je.id,
      exchange_rate: 1,
    });

    // ─── 10) ربط القيد بالفاتورة (مع company_id + RETURNING) ───
    const link = await client.query(
      `UPDATE journal_entries
       SET source_id = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id`,
      [invoice.id, je.id, companyId]
    );
    if (!link.rowCount) {
      throw new ApiError(500, 'فشل ربط القيد بالفاتورة');
    }

    // ─── 11) إنشاء بنود الفاتورة ───
    for (let i = 0; i < itemsRes.rows.length; i++) {
      const item = itemsRes.rows[i];
      const qty = Number(item.quantity);
      const price = Number(item.unit_price || 0);
      const lineTotal = round2(qty * price);

      const ins = await client.query(
        `INSERT INTO invoice_items
          (invoice_id, product_id, description, quantity, unit_price,
           net_unit_price, discount_rate, discount_amount, tax_rate, tax_amount,
           line_total, batch_id, sort_order, conversion_factor)
         VALUES ($1, $2, $3, $4, $5, $5, 0, 0, 0, 0, $6, $7, $8, 1)
         RETURNING id`,
        [
          invoice.id,
          item.product_id,
          item.description,
          qty,
          price,
          lineTotal,
          item.batch_id,
          i,
        ]
      );
      if (!ins.rowCount) {
        throw new ApiError(500, `فشل إنشاء بند الفاتورة #${i + 1}`);
      }
    }

    // ─── 12) ترحيل القيد ───
    await JournalEntry.post(client, companyId, je.id, userId);

    // ─── 13) تحديث حالة المذكرة (مع company_id + status + RETURNING) ───
    const upd = await client.query(
      `UPDATE delivery_notes
       SET status = 'invoiced', invoice_id = $1
       WHERE id = $2 AND company_id = $3 AND status IN ('dispatched', 'delivered')
       RETURNING id`,
      [invoice.id, deliveryNoteId, companyId]
    );
    if (!upd.rowCount) {
      throw new ApiError(409, 'فشل تحديث المذكرة — قد تكون معدّلة من عملية أخرى');
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      ...invoice,
      reference_type: 'delivery_note',
      reference_id: deliveryNoteId,
      customer_id: dn.customer_id,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: finalDueDate,
      subtotal,
      tax_total: taxTotal,
      journal_entry_id: je.id,
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[invoice.createFromDeliveryNote] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// 4) إلغاء فاتورة — محصّن
// ═══════════════════════════════════════════════════════════════

const cancel = async (companyId, userId, id) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1) قفل الفاتورة
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');
    if (inv.status === 'cancelled') {
      throw new ApiError(400, 'Already cancelled');
    }

    // 2) منع paid/partial
    if (inv.status === 'paid') {
      throw new ApiError(400, 'Cannot cancel a paid invoice — reverse payments first');
    }
    if (inv.status === 'partial' || Number(inv.paid_amount) > 0) {
      throw new ApiError(400, 'Cannot cancel a partially-paid invoice — reverse payments first');
    }

    // 3) التحقق من payments
    const paymentsCheck = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM payments WHERE invoice_id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (paymentsCheck.rows[0].cnt > 0) {
      throw new ApiError(400, `Invoice has ${paymentsCheck.rows[0].cnt} payment(s) — reverse them first`);
    }

    // 4) قيد عكسي
    if (inv.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, inv.journal_entry_id);
      if (!original) {
        throw new ApiError(409, `Cannot cancel: original journal entry not found`);
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

      // ✅ assertBalanced
      assertBalanced(reversedLines, 'في عكس قيد الفاتورة');

      const reverse = await JournalEntry.create(client, companyId, {
        entry_date: new Date().toISOString().slice(0, 10),
        description: `إلغاء فاتورة ${inv.invoice_number}`,
        source_type: 'adjustment',
        source_id: inv.id,
        created_by: userId,
        lines: reversedLines,
      });

      // ✅ verify
      await verifyJournalEntry(client, reverse.id, 'في عكس قيد الفاتورة');

      await JournalEntry.post(client, companyId, reverse.id, userId);
    }

    // 5) إلغاء الفاتورة
    const cancelled = await Invoice.cancel(client, companyId, id);
    if (!cancelled) {
      throw new ApiError(400, 'Invoice cannot be cancelled');
    }

    // 6) إعادة حالة المرجع المرتبط (مع company_id + RETURNING)
    if (inv.reference_type === 'sales_order' && inv.reference_id) {
      await client.query(
        `UPDATE sales_orders
         SET status = 'confirmed'
         WHERE id = $1 AND company_id = $2 AND status = 'invoiced'`,
        [inv.reference_id, companyId]
      );
    } else if (inv.reference_type === 'purchase_order' && inv.reference_id) {
      await client.query(
        `UPDATE purchase_orders
         SET status = 'confirmed'
         WHERE id = $1 AND company_id = $2 AND status = 'invoiced'`,
        [inv.reference_id, companyId]
      );
    } else if (inv.reference_type === 'delivery_note' && inv.reference_id) {
      const upd = await client.query(
        `UPDATE delivery_notes
         SET status = 'delivered', invoice_id = NULL
         WHERE id = $1 AND company_id = $2 AND status = 'invoiced'
         RETURNING id`,
        [inv.reference_id, companyId]
      );
      if (!upd.rowCount) {
        console.warn(
          `[invoice.cancel] Failed to reset delivery_note ${inv.reference_id} — may have been modified`
        );
      }
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return { id, status: 'cancelled' };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[invoice.cancel] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createFromOrder,
  createFromPurchaseOrder,
  createFromDeliveryNote,
  cancel,
};