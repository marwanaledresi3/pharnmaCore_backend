const {pool} = require('../config/pool');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const ApiError = require('../errors/ApiError');

/**
 * تحقق من صحة السطور
 */
const validateLines = async (client, companyId, lines) => {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new ApiError(400, 'At least 2 lines are required');
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const accountIds = new Set();

  for (const line of lines) {
    if (!line.account_id) throw new ApiError(400, 'account_id is required on every line');
    if (accountIds.has(line.account_id)) {
      throw new ApiError(400, 'Duplicate account in lines — combine into one line');
    }
    accountIds.add(line.account_id);

    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (debit < 0 || credit < 0) throw new ApiError(400, 'Debit/credit must be >= 0');
    if (debit > 0 && credit > 0) {
      throw new ApiError(400, 'A line cannot have both debit and credit');
    }
    if (debit === 0 && credit === 0) {
      throw new ApiError(400, 'A line must have either debit or credit > 0');
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new ApiError(400, `Entry is not balanced (debit: ${totalDebit}, credit: ${totalCredit})`);
  }

  // تحقق أن كل الحسابات postable وتخص الشركة
  const accountsRes = await client.query(
    `SELECT a.id, a.code, a.is_active,
            EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.parent_id = a.id) AS has_children
     FROM chart_of_accounts a
     WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])`,
    [companyId, Array.from(accountIds)]
  );

  if (accountsRes.rowCount !== accountIds.size) {
    throw new ApiError(400, 'One or more accounts not found in this company');
  }

  for (const acc of accountsRes.rows) {
    if (!acc.is_active) throw new ApiError(400, `Account ${acc.code} is inactive`);
    if (acc.has_children) throw new ApiError(400, `Account ${acc.code} is not postable (has children)`);
  }
};

/**
 * إنشاء قيد (draft)
 */
const create = async (companyId, userId, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await validateLines(client, companyId, payload.lines);

    const entry = await JournalEntry.create(client, companyId, {
      entry_date: payload.entry_date,
      description: payload.description,
      source_type: payload.source_type || 'manual',
      source_id: payload.source_id || null,
      created_by: userId,
      lines: payload.lines,
    });

    // جلب القيد الكامل مع السطور
    const full = await JournalEntry.findById(companyId, entry.id);
    await client.query('COMMIT');
    return full;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * تعديل قيد (draft فقط)
 */
const update = async (companyId, id, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await validateLines(client, companyId, payload.lines);

    const result = await JournalEntry.update(client, companyId, id, {
      entry_date: payload.entry_date,
      description: payload.description,
      lines: payload.lines,
    });

    if (result.notFound) throw new ApiError(404, 'Journal entry not found');
    if (result.notDraft) throw new ApiError(400, 'Only draft entries can be edited');

    const full = await JournalEntry.findById(companyId, id);
    await client.query('COMMIT');
    return full;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * ترحيل
 */
const post = async (companyId, id, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // تحقق مسبق: القيد متوازن؟ (لأنه قديم وقد يكون تم إنشاؤه بطرق أخرى)
    const check = await client.query(
      `SELECT
         COALESCE(SUM(debit), 0) AS d,
         COALESCE(SUM(credit), 0) AS c,
         COUNT(*)::int AS n
       FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [id]
    );
    const { d, c, n } = check.rows[0];
    if (n < 2) throw new ApiError(400, 'Entry must have at least 2 lines');
    if (Math.abs(Number(d) - Number(c)) > 0.005) {
      throw new ApiError(400, 'Entry is not balanced');
    }

    const posted = await JournalEntry.post(client, companyId, id, userId);
    if (!posted) throw new ApiError(400, 'Entry not found or already posted');

    await client.query('COMMIT');
    return posted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * إلغاء الترحيل
 */
const unpost = async (companyId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await JournalEntry.unpost(client, companyId, id);
    if (!result) throw new ApiError(400, 'Entry not found or not posted');
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { create, update, post, unpost };