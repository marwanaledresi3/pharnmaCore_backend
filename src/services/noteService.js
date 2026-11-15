
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('./numberingService');
const settingsService = require('./settingsService');
const JournalEntry = require('../models/JournalEntry');
const Note = require('../models/Note');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
  buildNoteLines,
} = require('./journalHelper');

/**
 * إنشاء رقم الإشعار
 */
async function generateNoteNumber(client, companyId, noteType) {
  const seqName = noteType === 'credit' ? 'credit_note' : 'debit_note';
  return NumberingService.next(client, companyId, seqName);
}

/**
 * جلب إشعار واحد مع بنوده
 */
async function getById(client, companyId, id) {
  return Note.getById(client, companyId, id);
}

/**
 * إنشاء إشعار (draft)
 */
async function create(companyId, userId, payload) {
  const {
    note_type,
    party_type,
    customer_id,
    supplier_id,
    invoice_id,
    note_date,
    currency_id,
    exchange_rate,
    reason,
    description,
    items,
  } = payload;

  // Validation
  if (!['credit', 'debit'].includes(note_type)) {
    throw new ApiError(400, 'note_type must be credit or debit');
  }

  if (!['customer', 'supplier'].includes(party_type)) {
    throw new ApiError(400, 'party_type must be customer or supplier');
  }

  if (party_type === 'customer' && !customer_id) {
    throw new ApiError(400, 'customer_id is required for customer notes');
  }

  if (party_type === 'supplier' && !supplier_id) {
    throw new ApiError(400, 'supplier_id is required for supplier notes');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // التحقق من وجود الطرف
    if (customer_id) {
      const exists = await Note.customerExists(
        client,
        companyId,
        customer_id
      );

      if (!exists) {
        throw new ApiError(400, 'Customer not found or inactive');
      }
    }

    if (supplier_id) {
      const exists = await Note.supplierExists(
        client,
        companyId,
        supplier_id
      );

      if (!exists) {
        throw new ApiError(400, 'Supplier not found or inactive');
      }
    }

    // التحقق من الفاتورة
    if (invoice_id) {
      const exists = await Note.invoiceExists(
        client,
        companyId,
        invoice_id
      );

      if (!exists) {
        throw new ApiError(400, 'Invoice not found');
      }
    }

    // حساب إجماليات البنود
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);

      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, 'Invalid quantity');
      }

      if (!Number.isFinite(price) || price < 0) {
        throw new ApiError(400, 'Invalid unit_price');
      }

      const discountRate = Number(item.discount_rate) || 0;
      const taxRate = Number(item.tax_rate) || 0;

      const discountAmount = round2(
        (qty * price * discountRate) / 100
      );

      const net = round2(qty * price - discountAmount);
      const taxAmount = round2((net * taxRate) / 100);
      const lineTotal = round2(net + taxAmount);

      item._discountAmount = discountAmount;
      item._taxAmount = taxAmount;
      item._lineTotal = lineTotal;

      subtotal += net;
      taxTotal += taxAmount;
    }

    subtotal = round2(subtotal);
    taxTotal = round2(taxTotal);

    const total = round2(subtotal + taxTotal);

    // إنشاء رقم الإشعار
    const noteNumber = await generateNoteNumber(
      client,
      companyId,
      note_type
    );

    // تحديد العملة
    let currId = currency_id;

    if (!currId) {
      currId = await Note.getCompanyCurrency(client, companyId);
    }

    if (!currId) {
      throw new ApiError(400, 'Company currency is not configured');
    }

    // إنشاء رأس الإشعار
    const note = await Note.insertNote(client, {
      companyId,
      noteNumber,
      noteType: note_type,
      partyType: party_type,
      customerId: customer_id,
      supplierId: supplier_id,
      invoiceId: invoice_id,
      noteDate: note_date || new Date().toISOString().slice(0, 10),
      currencyId: currId,
      exchangeRate: exchange_rate || 1,
      subtotal,
      taxTotal,
      total,
      reason,
      description,
      userId,
    });

    // إضافة البنود
    for (let i = 0; i < items.length; i++) {
      await Note.insertNoteItem(client, note.id, items[i], i);
    }

    const full = await getById(client, companyId, note.id);

    await client.query('COMMIT');

    return full;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * تأكيد الإشعار — ينشئ القيد المحاسبي
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * تأكيد الإشعار — محصّن بالكامل
 * ═══════════════════════════════════════════════════════════════
 * 
 * التحققات:
 *  1. قفل الإشعار (FOR UPDATE) — داخل Note.lockById (محمي)
 *  2. التحقق من الحالة (draft)
 *  3. التحقق من الإجماليات (subtotal, taxTotal, total — كلها >= 0)
 *  4. التحقق من الحسابات (موجودة + نشطة)
 *  5. بناء السطور والتحقق من التوازن
 *  6. إنشاء القيد + verify + post
 *  7. تحديث الحالة (مع company_id + status + RETURNING)
 * 
 * أي فشل → ROLLBACK (الإشعار يبقى draft)
 */
async function confirm(companyId, userId, id) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // ═══ 1) قفل الإشعار ═══
    const note = await Note.lockById(client, companyId, id);
    if (!note) {
      throw new ApiError(404, 'Note not found');
    }
    if (note.status === 'confirmed') {
      throw new ApiError(400, 'Note is already confirmed');
    }
    if (note.status === 'cancelled') {
      throw new ApiError(400, 'Note is cancelled');
    }
    if (note.status !== 'draft') {
      throw new ApiError(400, `Cannot confirm note in status: ${note.status}`);
    }

    // ═══ 2) التحقق من الإجماليات ═══
    const subtotal = round2(note.subtotal);
    const taxTotal = round2(note.tax_total);
    const total = round2(note.total);

    if (!Number.isFinite(subtotal) || subtotal < 0) {
      throw new ApiError(400, `المجموع غير صالح (${subtotal})`);
    }
    if (!Number.isFinite(taxTotal) || taxTotal < 0) {
      throw new ApiError(400, `الضريبة غير صالحة (${taxTotal})`);
    }
    if (!Number.isFinite(total) || total < 0) {
      throw new ApiError(400, `الإجمالي غير صالح (${total})`);
    }
    if (total <= 0.01) {
      throw new ApiError(400, 'Note total must be > 0');
    }
    if (Math.abs(total - (subtotal + taxTotal)) > 0.01) {
      throw new ApiError(
        500,
        `الإجمالي (${total.toFixed(2)}) لا يساوي المجموع (${subtotal.toFixed(2)}) + الضريبة (${taxTotal.toFixed(2)}).`
      );
    }

    // ═══ 3) التحقق من party_type ═══
    if (!['customer', 'supplier'].includes(note.party_type)) {
      throw new ApiError(400, `party_type غير صالح (${note.party_type})`);
    }
    if (!['credit', 'debit'].includes(note.note_type)) {
      throw new ApiError(400, `note_type غير صالح (${note.note_type})`);
    }

    // ═══ 4) التحقق من الحسابات المطلوبة ═══
    const isCustomer = note.party_type === 'customer';
    const isCredit = note.note_type === 'credit';

    // 4.1) الحسابات الإجبارية
    const requiredAccounts = ['112', '211']; // ذمم عملاء + ذمم موردين (نحتاج واحدة على الأقل)
    let counterAccountCode;

    if (isCustomer && isCredit) {
      counterAccountCode = await settingsService.get(
        companyId, 'notes_sales_return_account_code', '411', client
      );
    } else if (!isCustomer && isCredit) {
      counterAccountCode = await settingsService.get(
        companyId, 'notes_purchase_return_account_code', '511', client
      );
    } else if (isCustomer && !isCredit) {
      counterAccountCode = await settingsService.get(
        companyId, 'notes_other_revenue_account_code', '411', client
      );
    } else {
      counterAccountCode = await settingsService.get(
        companyId, 'notes_other_expense_account_code', '518', client
      );
    }

    // 4.2) الحسابات المطلوبة فعلياً (حسب النوع)
    const actualRequired = [counterAccountCode];
    if (isCustomer) actualRequired.push('112');
    else actualRequired.push('211');

    // 4.3) جلبها والتحقق
    const accounts = await requireActiveAccounts(
      client, companyId, actualRequired, 'في الإشعار'
    );

    // ═══ 5) بناء السطور والتحقق ═══
    const lines = buildNoteLines({
      accounts,
      noteType: note.note_type,
      partyType: note.party_type,
      total,
      reference: note.note_number,
    });

    assertBalanced(lines, 'في الإشعار');

    // ═══ 6) إنشاء القيد (اختياري حسب الإعدادات) ═══
    const autoJournal = await settingsService.get(
      companyId, 'notes_auto_journal', true, client
    );

    let journalEntryId = null;

    if (autoJournal) {
      const sourceType = note.note_type === 'credit' ? 'credit_note' : 'debit_note';

      const je = await JournalEntry.create(client, companyId, {
        entry_date: note.note_date,
        description: `إشعار ${isCredit ? 'دائن' : 'مدين'} ${note.note_number}`,
        source_type: sourceType,
        source_id: id,
        created_by: userId,
        lines,
      });

      // 6.1) verify بعد الإنشاء (defensive)
      await verifyJournalEntry(client, je.id, 'في الإشعار');

      // 6.2) ترحيل
      await JournalEntry.post(client, companyId, je.id, userId);

      journalEntryId = je.id;
    }

    // ═══ 7) تحديث الحالة (مع company_id + status + RETURNING) ═══
    await Note.confirmNote(client, companyId, id, userId, journalEntryId);

    // ═══ 8) الإرجاع ═══
    const full = await getById(client, companyId, id);
    await client.query('COMMIT');
    transactionStarted = false;
    return full;
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[noteService.confirm] ROLLBACK failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ═══════════════════════════════════════════════════════════════
 * إلغاء إشعار — محصّن
 * ═══════════════════════════════════════════════════════════════
 */
async function cancel(companyId, userId, id, reason) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const note = await Note.lockById(client, companyId, id);
    if (!note) {
      throw new ApiError(404, 'Note not found');
    }
    if (note.status === 'cancelled') {
      throw new ApiError(400, 'Note is already cancelled');
    }

    // لو draft → إلغاء بسيط
    if (note.status === 'draft') {
      await Note.cancelNote(client, companyId, id, userId, reason, 'draft');
      await client.query('COMMIT');
      transactionStarted = false;
      return { id, cancelled: true, reversed: false };
    }

    // لو confirmed → عكس القيد
    if (note.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, note.journal_entry_id);
      if (original?.lines) {
        const reversedLines = original.lines.map((line) => ({
          account_id: line.account_id,
          debit: Number(line.credit),
          credit: Number(line.debit),
          description: `عكس إشعار — ${line.description || ''}`,
        }));

        // ✅ التحقق من التوازن قبل الإنشاء
        assertBalanced(reversedLines, 'في عكس الإشعار');

        const reverse = await JournalEntry.create(client, companyId, {
          entry_date: new Date().toISOString().slice(0, 10),
          description: `عكس إشعار ${note.note_number}`,
          source_type: 'adjustment',
          source_id: id,
          created_by: userId,
          lines: reversedLines,
        });

        await verifyJournalEntry(client, reverse.id, 'في عكس الإشعار');
        await JournalEntry.post(client, companyId, reverse.id, userId);
      }
    }

    await Note.cancelNote(client, companyId, id, userId, reason, 'confirmed');

    const full = await getById(client, companyId, id);
    await client.query('COMMIT');
    transactionStarted = false;
    return { id, cancelled: true, reversed: true, note: full };
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[noteService.cancel] ROLLBACK failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
/**
 * قائمة الإشعارات
 */
async function list(companyId, filters = {}) {
  return Note.list(companyId, filters);
}

module.exports = {
  list,
  getById,
  create,
  confirm,
  cancel,
};
