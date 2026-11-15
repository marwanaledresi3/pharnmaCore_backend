// services/journalEntryService.js
const { pool } = require('../config/pool');
const JournalEntry = require('../models/JournalEntry');
const { VALID_SOURCE_TYPES } = JournalEntry;
const ApiError = require('../errors/ApiError');
const {
  round2,
  assertBalanced,
  verifyJournalEntry,
} = require('./journalHelper');

// ═══════════════════════════════════════════════════════════════
// التحقق من السطور
// ═══════════════════════════════════════════════════════════════

/**
 * تحقق شامل من السطور:
 *  1. 2 سطر على الأقل
 *  2. debit/credit >= 0
 *  3. لا debit و credit معاً
 *  4. لا سطر صفر
 *  5. التوازن (assertBalanced)
 *  6. كل حساب موجود + نشط + postable (بدون أطفال)
 *
 * ملاحظة: نسمح بتكرار account_id (يُدمج تلقائياً في JournalEntry.create).
 */
const validateLines = async (client, companyId, lines) => {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new ApiError(400, 'At least 2 lines are required');
  }

  const accountIds = new Set();
  for (const line of lines) {
    if (!line.account_id) {
      throw new ApiError(400, 'account_id is required on every line');
    }
    accountIds.add(line.account_id);

    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      throw new ApiError(400, 'Debit/credit must be valid numbers');
    }
    if (debit < 0 || credit < 0) {
      throw new ApiError(400, 'Debit/credit must be >= 0');
    }
    if (debit > 0 && credit > 0) {
      throw new ApiError(400, 'A line cannot have both debit and credit');
    }
    if (debit === 0 && credit === 0) {
      throw new ApiError(400, 'A line must have either debit or credit > 0');
    }
  }

  assertBalanced(lines, 'في القيد');

  const accountsRes = await client.query(
    `SELECT
       a.id, a.code, a.is_active, a.account_type,
       EXISTS (
         SELECT 1 FROM chart_of_accounts c WHERE c.parent_id = a.id
       ) AS has_children
     FROM chart_of_accounts a
     WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])`,
    [companyId, Array.from(accountIds)]
  );

  if (accountsRes.rowCount !== accountIds.size) {
    const found = accountsRes.rows.map((r) => r.id);
    const missing = Array.from(accountIds).filter((id) => !found.includes(id));
    throw new ApiError(
      400,
      `One or more accounts not found in this company: ${missing.join(', ')}`
    );
  }

  for (const acc of accountsRes.rows) {
    if (!acc.is_active) {
      throw new ApiError(400, `Account ${acc.code} is inactive`);
    }
    if (acc.has_children) {
      throw new ApiError(400, `Account ${acc.code} is not postable (has children)`);
    }
  }

  return accountsRes.rows;
};

// ═══════════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════════

const create = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    await validateLines(client, companyId, payload.lines);

    const entry = await JournalEntry.create(client, companyId, {
      entry_date: payload.entry_date,
      description: payload.description,
      source_type: payload.source_type || 'manual',
      source_id: payload.source_id || null,
      created_by: userId,
      lines: payload.lines,
    });

    await verifyJournalEntry(client, entry.id, 'في إنشاء القيد');

    const full = await JournalEntry.findById(companyId, entry.id);

    await client.query('COMMIT');
    transactionStarted = false;
    return full;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[journalEntry.create] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// UPDATE (draft فقط)
// ═══════════════════════════════════════════════════════════════

const update = async (companyId, id, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    await validateLines(client, companyId, payload.lines);

    const result = await JournalEntry.update(client, companyId, id, {
      entry_date: payload.entry_date,
      description: payload.description,
      lines: payload.lines,
    });

    if (result.notFound) throw new ApiError(404, 'Journal entry not found');
    if (result.notDraft) throw new ApiError(400, 'Only draft entries can be edited');

    await verifyJournalEntry(client, id, 'في تحديث القيد');

    const full = await JournalEntry.findById(companyId, id);

    await client.query('COMMIT');
    transactionStarted = false;
    return full;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[journalEntry.update] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// POST (ترحيل)
// ═══════════════════════════════════════════════════════════════

const post = async (companyId, id, userId) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const lockRes = await client.query(
      `SELECT id, status, source_type, company_id
       FROM journal_entries
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const entry = lockRes.rows[0];
    if (!entry) throw new ApiError(404, 'Journal entry not found');
    if (entry.status !== 'draft') {
      throw new ApiError(400, `Cannot post entry in status: ${entry.status}`);
    }

    await verifyJournalEntry(client, id, 'قبل الترحيل');

    // ✅ استخدام VALID_SOURCE_TYPES من JournalEntry
    if (entry.source_type && !VALID_SOURCE_TYPES.includes(entry.source_type)) {
      throw new ApiError(
        400,
        `Invalid source_type: '${entry.source_type}'. Allowed: ${VALID_SOURCE_TYPES.join(', ')}`
      );
    }

    const posted = await JournalEntry.post(client, companyId, id, userId);
    if (!posted) {
      throw new ApiError(400, 'Entry not found or already posted');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return posted;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[journalEntry.post] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// UNPOST (إلغاء الترحيل)
// ═══════════════════════════════════════════════════════════════

const unpost = async (companyId, id) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const lockRes = await client.query(
      `SELECT id, status FROM journal_entries
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const entry = lockRes.rows[0];
    if (!entry) throw new ApiError(404, 'Journal entry not found');
    if (entry.status !== 'posted') {
      throw new ApiError(400, `Cannot unpost entry in status: ${entry.status}`);
    }

    const result = await JournalEntry.unpost(client, companyId, id);
    if (!result) {
      throw new ApiError(400, 'Entry not found or not posted');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[journalEntry.unpost] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE (draft فقط)
// ═══════════════════════════════════════════════════════════════

const remove = async (companyId, id) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const lockRes = await client.query(
      `SELECT id, status FROM journal_entries
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const entry = lockRes.rows[0];
    if (!entry) throw new ApiError(404, 'Journal entry not found');
    if (entry.status !== 'draft') {
      throw new ApiError(400, 'Only draft entries can be deleted');
    }

    // ✅ حذف السطور صراحةً (في حال لا يوجد CASCADE)
    await client.query(
      `DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [id]
    );

    const del = await client.query(
      `DELETE FROM journal_entries
       WHERE id = $1 AND company_id = $2 AND status = 'draft'
       RETURNING id`,
      [id, companyId]
    );
    if (!del.rowCount) {
      throw new ApiError(409, 'فشل الحذف — قد يكون معدّلاً من عملية أخرى');
    }

    await client.query('COMMIT');
    transactionStarted = false;
    return { id, deleted: true };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[journalEntry.remove] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { create, update, post, unpost, remove };