// services/custody/advanceService.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const EmployeeAdvance = require('../../models/EmployeeAdvance');

async function setContext(client, companyId, userId) {
  await client.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);
  if (userId) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  }
}

const listAdvances = async (companyId, filters = {}) => {
  const client = await pool.connect();
  try {
    await setContext(client, companyId, null);
    return await EmployeeAdvance.findAllByCompany(client, companyId, filters);
  } finally {
    client.release();
  }
};

const getAdvanceById = async (companyId, advanceId) => {
  const client = await pool.connect();
  try {
    await setContext(client, companyId, null);
    const advance = await EmployeeAdvance.findById(client, companyId, advanceId);
    if (!advance) throw new ApiError(404, 'السلفة غير موجودة');

    const installments = await EmployeeAdvance.findInstallmentsByAdvanceId(client, advanceId);
    return { ...advance, installments };
  } finally {
    client.release();
  }
};

const createAdvance = async (companyId, userId, payload) => {
  const {
    advance_number = null,
    employee_id,
    advance_type = 'salary_advance',
    amount,
    currency_id = null,
    exchange_rate = 1,
    installments_count = 1,
    installment_amount = null,
    request_date = null,
    first_installment_date = null,
    receivable_account_id = null,
    notes = null,
  } = payload;

  if (!employee_id) throw new ApiError(400, 'الموظف (employee_id) مطلوب');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new ApiError(400, 'مبلغ السلفة يجب أن يكون أكبر من 0');
  }

  const instCount = Number(installments_count || 1);
  if (!Number.isInteger(instCount) || instCount <= 0) {
    throw new ApiError(400, 'عدد الأقساط يجب أن يكون عدداً صحيحاً أكبر من 0');
  }

  const instAmt =
    installment_amount !== null && installment_amount !== undefined
      ? Number(installment_amount)
      : Number((amt / instCount).toFixed(2));

  if (!Number.isFinite(instAmt) || instAmt <= 0) {
    throw new ApiError(400, 'قيمة القسط يجب أن تكون أكبر من 0');
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await setContext(client, companyId, userId);

    let finalNumber = advance_number && String(advance_number).trim();
    if (!finalNumber) {
      const [prefix, seq] = await Promise.all([
        EmployeeAdvance.getPrefix(client, companyId),
        EmployeeAdvance.getNextSequence(client, companyId),
      ]);
      finalNumber = `${prefix}${String(seq).padStart(4, '0')}`;
    }

    const advance = await EmployeeAdvance.insertAdvance(client, companyId, {
      advance_number: finalNumber,
      employee_id,
      advance_type,
      amount: amt,
      currency_id,
      exchange_rate: Number(exchange_rate || 1),
      installments_count: instCount,
      installment_amount: instAmt,
      request_date: request_date || new Date().toISOString().slice(0, 10),
      first_installment_date: first_installment_date || null,
      receivable_account_id: receivable_account_id || null,
      notes: notes || null,
    });

    await client.query('COMMIT');
    started = false;
    return advance;
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const approveAdvance = async (companyId, userId, advanceId, approvalDate = null) => {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await setContext(client, companyId, userId);

    const current = await EmployeeAdvance.findById(client, companyId, advanceId, {
      forUpdate: true,
    });
    if (!current) throw new ApiError(404, 'السلفة غير موجودة');
    if (current.status !== 'pending') {
      throw new ApiError(400, `لا يمكن اعتماد سلفة حالتها الحالية: ${current.status}`);
    }

    const advance = await EmployeeAdvance.updateStatus(client, companyId, advanceId, {
      status: 'approved',
      approval_date: approvalDate || new Date().toISOString().slice(0, 10),
      approved_by: userId || null,
    });

    const installments = await EmployeeAdvance.findInstallmentsByAdvanceId(client, advanceId);

    await client.query('COMMIT');
    started = false;
    return { advance, installments };
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const rejectOrCancelAdvance = async (companyId, userId, advanceId, nextStatus, notes = null) => {
  if (!['rejected', 'cancelled'].includes(nextStatus)) {
    throw new ApiError(400, 'الحالة المطلوبة غير صالحة');
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await setContext(client, companyId, userId);

    const current = await EmployeeAdvance.findById(client, companyId, advanceId, {
      forUpdate: true,
    });
    if (!current) throw new ApiError(404, 'السلفة غير موجودة');
    if (['paid', 'cancelled'].includes(current.status)) {
      throw new ApiError(400, `لا يمكن تعديل سلفة حالتها: ${current.status}`);
    }
    if (current.status === 'approved' && Number(current.paid_amount || 0) > 0) {
      throw new ApiError(400, 'لا يمكن إلغاء سلفة تم سداد أقساط منها');
    }

    const updated = await EmployeeAdvance.updateStatus(client, companyId, advanceId, {
      status: nextStatus,
      notes,
    });

    if (nextStatus === 'cancelled') {
      await EmployeeAdvance.cancelPendingInstallments(client, advanceId);
    }

    await client.query('COMMIT');
    started = false;
    return updated;
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const payInstallment = async (companyId, userId, installmentId, payload = {}) => {
  const { amount = null, paid_date = null, payment_account_id = null } = payload;

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await setContext(client, companyId, userId);

    const inst = await EmployeeAdvance.findInstallmentInCompany(
      client,
      companyId,
      installmentId
    );
    if (!inst) throw new ApiError(404, 'القسط غير موجود');

    const remaining = Number((Number(inst.amount) - Number(inst.paid_amount)).toFixed(2));
    const payAmt = amount !== null && amount !== undefined ? Number(amount) : remaining;

    const jeId = await EmployeeAdvance.payInstallmentFn(
      client,
      installmentId,
      payAmt,
      paid_date || new Date().toISOString().slice(0, 10),
      payment_account_id || null
    );

    const advance = await EmployeeAdvance.findById(client, companyId, inst.advance_id);

    await client.query('COMMIT');
    started = false;
    return { journal_entry_id: jeId, advance };
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  listAdvances,
  getAdvanceById,
  createAdvance,
  approveAdvance,
  rejectOrCancelAdvance,
  payInstallment,
};