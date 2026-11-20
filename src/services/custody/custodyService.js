// services/custody/custodyService.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const Custody = require('../../models/Custody');

async function setContext(client, companyId, userId) {
  await client.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);
  if (userId) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  }
}

const listCustodyTypes = async (companyId) => {
  const client = await pool.connect();
  try {
    await setContext(client, companyId, null);
    return await Custody.findTypesByCompany(client, companyId);
  } finally {
    client.release();
  }
};

const createCustodyType = async (companyId, userId, payload) => {
  const { name, code = null, kind, requires_settlement = true } = payload;
  if (!name || !String(name).trim()) {
    throw new ApiError(400, 'اسم نوع العهدة مطلوب');
  }
  if (!['cash', 'in_kind', 'advance'].includes(kind)) {
    throw new ApiError(400, 'نوع العهدة (kind) غير صالح');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, companyId, userId);

    const created = await Custody.insertType(client, companyId, {
      name: String(name).trim(),
      code: code ? String(code).trim().toUpperCase() : null,
      kind,
      requires_settlement,
    });

    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const listCustodies = async (companyId, filters = {}) => {
  const client = await pool.connect();
  try {
    await setContext(client, companyId, null);
    return await Custody.findAllByCompany(client, companyId, filters);
  } finally {
    client.release();
  }
};

const getCustodyById = async (companyId, custodyId) => {
  const client = await pool.connect();
  try {
    await setContext(client, companyId, null);

    const custody = await Custody.findById(client, companyId, custodyId);
    if (!custody) throw new ApiError(404, 'العهدة غير موجودة');

    const [items, transactions] = await Promise.all([
      Custody.findItemsByCustodyId(client, custodyId),
      Custody.findTransactionsByCustodyId(client, companyId, custodyId),
    ]);

    return { ...custody, items, transactions };
  } finally {
    client.release();
  }
};

const createCustody = async (companyId, userId, payload) => {
  const {
    custody_number = null,
    custody_type_id,
    holder_employee_id,
    amount = 0,
    currency_id = null,
    description = null,
    issued_date = null,
    due_date = null,
    account_id = null,
    notes = null,
    items = [],
  } = payload;

  if (!custody_type_id) throw new ApiError(400, 'نوع العهدة (custody_type_id) مطلوب');
  if (!holder_employee_id) {
    throw new ApiError(400, 'الموظف المستلم للعهدة (holder_employee_id) مطلوب');
  }

  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt < 0) {
    throw new ApiError(400, 'قيمة العهدة يجب أن تكون 0 أو أكبر');
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await setContext(client, companyId, userId);

    const typeRow = await Custody.findTypeById(client, companyId, custody_type_id);
    if (!typeRow) throw new ApiError(404, 'نوع العهدة غير موجود');

    let finalNumber = custody_number && String(custody_number).trim();
    if (!finalNumber) {
      const [prefix, seq] = await Promise.all([
        Custody.getPrefix(client, companyId),
        Custody.getNextSequence(client, companyId),
      ]);
      finalNumber = `${prefix}${String(seq).padStart(4, '0')}`;
    }

    const custody = await Custody.insertCustody(client, companyId, {
      custody_number: finalNumber,
      custody_type_id,
      holder_employee_id,
      amount: amt,
      currency_id,
      description: description || null,
      issued_date: issued_date || new Date().toISOString().slice(0, 10),
      due_date: due_date || null,
      account_id: account_id || null,
      issued_by: userId || null,
      notes: notes || null,
    });

    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        await Custody.insertCustodyItem(client, custody.id, item);
      }
    }

    await client.query('COMMIT');
    started = false;
    return custody;
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const addCustodyTransaction = async (companyId, userId, custodyId, payload) => {
  const {
    transaction_type,
    transaction_date = null,
    amount = 0,
    expense_category = null,
    expense_account_id = null,
    description = null,
    reference_type = null,
    reference_id = null,
  } = payload;

  if (!['spend', 'return', 'settle', 'adjustment'].includes(transaction_type)) {
    throw new ApiError(400, 'نوع حركة العهدة غير صالح');
  }

  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt < 0) {
    throw new ApiError(400, 'مبلغ الحركة يجب أن يكون 0 أو أكبر');
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await setContext(client, companyId, userId);

    const tx = await Custody.insertTransaction(client, companyId, custodyId, {
      transaction_type,
      transaction_date: transaction_date || new Date().toISOString().slice(0, 10),
      amount: amt,
      expense_category: expense_category || null,
      expense_account_id: expense_account_id || null,
      description: description || null,
      reference_type: reference_type || null,
      reference_id: reference_id || null,
      created_by: userId || null,
    });

    const updatedCustody = await Custody.findById(client, companyId, custodyId);

    await client.query('COMMIT');
    started = false;
    return { transaction: tx, custody: updatedCustody };
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  listCustodyTypes,
  createCustodyType,
  listCustodies,
  getCustodyById,
  createCustody,
  addCustodyTransaction,
};