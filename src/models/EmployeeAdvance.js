// models/EmployeeAdvance.js
const db = require('../config/pool');

const getExecutor = (client) => client || db.pool;

const getPrefix = async (client, companyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT value FROM settings
     WHERE company_id = $1 AND key = 'numbering_advance_prefix'`,
    [companyId]
  );
  return typeof rows[0]?.value === 'string' ? rows[0].value : 'ADV-';
};

const getNextSequence = async (client, companyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(advance_number, '[^0-9]', '', 'g'), '')::bigint), 0) + 1 AS next_seq
     FROM employee_advances
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0]?.next_seq || 1);
};

const findAllByCompany = async (client, companyId, filters = {}) => {
  const exec = getExecutor(client);
  const { status, employee_id, advance_type } = filters;
  const params = [companyId];
  const conds = ['ea.company_id = $1'];

  if (status) {
    params.push(status);
    conds.push(`ea.status = $${params.length}`);
  }
  if (employee_id) {
    params.push(employee_id);
    conds.push(`ea.employee_id = $${params.length}`);
  }
  if (advance_type) {
    params.push(advance_type);
    conds.push(`ea.advance_type = $${params.length}`);
  }

  const { rows } = await exec.query(
    `SELECT ea.*
     FROM employee_advances ea
     WHERE ${conds.join(' AND ')}
     ORDER BY ea.request_date DESC, ea.created_at DESC`,
    params
  );

  return rows;
};

const findById = async (client, companyId, advanceId, { forUpdate = false } = {}) => {
  const exec = getExecutor(client);
  const lockClause = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await exec.query(
    `SELECT * FROM employee_advances
     WHERE id = $1 AND company_id = $2${lockClause}`,
    [advanceId, companyId]
  );
  return rows[0] || null;
};

const findInstallmentsByAdvanceId = async (client, advanceId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT * FROM advance_installments
     WHERE advance_id = $1
     ORDER BY installment_no ASC`,
    [advanceId]
  );
  return rows;
};

const findInstallmentInCompany = async (client, companyId, installmentId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT ai.*, ea.company_id, ea.id AS advance_id
     FROM advance_installments ai
     JOIN employee_advances ea ON ea.id = ai.advance_id
     WHERE ai.id = $1 AND ea.company_id = $2`,
    [installmentId, companyId]
  );
  return rows[0] || null;
};

const insertAdvance = async (client, companyId, data) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `INSERT INTO employee_advances (
       company_id, advance_number, employee_id, advance_type,
       amount, currency_id, exchange_rate, installments_count,
       installment_amount, request_date, first_installment_date,
       receivable_account_id, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      companyId,
      data.advance_number,
      data.employee_id,
      data.advance_type,
      data.amount,
      data.currency_id || null,
      data.exchange_rate,
      data.installments_count,
      data.installment_amount,
      data.request_date,
      data.first_installment_date || null,
      data.receivable_account_id || null,
      data.notes || null,
    ]
  );
  return rows[0];
};

const updateStatus = async (client, companyId, advanceId, fields) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `UPDATE employee_advances
     SET status = COALESCE($1, status),
         approval_date = COALESCE($2, approval_date),
         approved_by = COALESCE($3, approved_by),
         notes = COALESCE($4, notes)
     WHERE id = $5 AND company_id = $6
     RETURNING *`,
    [
      fields.status || null,
      fields.approval_date || null,
      fields.approved_by || null,
      fields.notes !== undefined ? fields.notes : null,
      advanceId,
      companyId,
    ]
  );
  return rows[0] || null;
};

const cancelPendingInstallments = async (client, advanceId) => {
  const exec = getExecutor(client);
  await exec.query(
    `UPDATE advance_installments
     SET status = 'cancelled'
     WHERE advance_id = $1 AND status = 'pending'`,
    [advanceId]
  );
};

const payInstallmentFn = async (client, installmentId, amount, paidDate, paymentAccountId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT fn_pay_advance_installment($1::uuid, $2::numeric, $3::date, $4::uuid) AS journal_entry_id`,
    [installmentId, amount, paidDate, paymentAccountId || null]
  );
  return rows[0]?.journal_entry_id || null;
};

module.exports = {
  getPrefix,
  getNextSequence,
  findAllByCompany,
  findById,
  findInstallmentsByAdvanceId,
  findInstallmentInCompany,
  insertAdvance,
  updateStatus,
  cancelPendingInstallments,
  payInstallmentFn,
};