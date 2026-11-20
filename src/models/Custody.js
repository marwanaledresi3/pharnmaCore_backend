// models/Custody.js
const db = require('../config/pool');

const getExecutor = (client) => client || db.pool;

const findTypesByCompany = async (client, companyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT * FROM custody_types
     WHERE company_id = $1 AND is_active = true
     ORDER BY created_at ASC, name ASC`,
    [companyId]
  );
  return rows;
};

const findTypeById = async (client, companyId, typeId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT * FROM custody_types
     WHERE id = $1 AND company_id = $2`,
    [typeId, companyId]
  );
  return rows[0] || null;
};

const insertType = async (client, companyId, data) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `INSERT INTO custody_types (company_id, name, code, kind, requires_settlement)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      companyId,
      data.name,
      data.code || null,
      data.kind,
      Boolean(data.requires_settlement),
    ]
  );
  return rows[0];
};

const getPrefix = async (client, companyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT value FROM settings
     WHERE company_id = $1 AND key = 'numbering_custody_prefix'`,
    [companyId]
  );
  return typeof rows[0]?.value === 'string' ? rows[0].value : 'CUS-';
};

const getNextSequence = async (client, companyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(custody_number, '[^0-9]', '', 'g'), '')::bigint), 0) + 1 AS next_seq
     FROM custodies
     WHERE company_id = $1`,
    [companyId]
  );
  return Number(rows[0]?.next_seq || 1);
};

const findAllByCompany = async (client, companyId, filters = {}) => {
  const exec = getExecutor(client);
  const { status, holder_employee_id, custody_type_id, search } = filters;
  const params = [companyId];
  const conds = ['c.company_id = $1'];

  if (status) {
    params.push(status);
    conds.push(`c.status = $${params.length}`);
  }
  if (holder_employee_id) {
    params.push(holder_employee_id);
    conds.push(`c.holder_employee_id = $${params.length}`);
  }
  if (custody_type_id) {
    params.push(custody_type_id);
    conds.push(`c.custody_type_id = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    conds.push(
      `(c.custody_number ILIKE $${params.length} OR COALESCE(c.description, '') ILIKE $${params.length})`
    );
  }

  const { rows } = await exec.query(
    `SELECT
       c.*,
       ct.name AS custody_type_name,
       ct.kind AS custody_kind,
       COALESCE((
         SELECT SUM(ct_tx.amount)
         FROM custody_transactions ct_tx
         WHERE ct_tx.custody_id = c.id
           AND ct_tx.transaction_type IN ('spend', 'return', 'settle')
       ), 0) AS settled_amount,
       GREATEST(
         c.amount - COALESCE((
           SELECT SUM(ct_tx.amount)
           FROM custody_transactions ct_tx
           WHERE ct_tx.custody_id = c.id
             AND ct_tx.transaction_type IN ('spend', 'return', 'settle')
         ), 0),
         0
       ) AS remaining_amount
     FROM custodies c
     JOIN custody_types ct ON ct.id = c.custody_type_id
     WHERE ${conds.join(' AND ')}
     ORDER BY c.issued_date DESC, c.created_at DESC`,
    params
  );

  return rows;
};

const findById = async (client, companyId, custodyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT
       c.*,
       ct.name AS custody_type_name,
       ct.kind AS custody_kind
     FROM custodies c
     JOIN custody_types ct ON ct.id = c.custody_type_id
     WHERE c.id = $1 AND c.company_id = $2`,
    [custodyId, companyId]
  );
  return rows[0] || null;
};

const findItemsByCustodyId = async (client, custodyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT * FROM custody_items WHERE custody_id = $1 ORDER BY id ASC`,
    [custodyId]
  );
  return rows;
};

const findTransactionsByCustodyId = async (client, companyId, custodyId) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `SELECT * FROM custody_transactions
     WHERE custody_id = $1 AND company_id = $2
     ORDER BY transaction_date DESC, created_at DESC`,
    [custodyId, companyId]
  );
  return rows;
};

const insertCustody = async (client, companyId, data) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `INSERT INTO custodies (
       company_id, custody_number, custody_type_id, holder_employee_id,
       amount, currency_id, description, issued_date, due_date,
       account_id, issued_by, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      companyId,
      data.custody_number,
      data.custody_type_id,
      data.holder_employee_id,
      data.amount,
      data.currency_id || null,
      data.description || null,
      data.issued_date,
      data.due_date || null,
      data.account_id || null,
      data.issued_by || null,
      data.notes || null,
    ]
  );
  return rows[0];
};

const insertCustodyItem = async (client, custodyId, item) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `INSERT INTO custody_items (custody_id, product_id, description, quantity, unit_cost)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      custodyId,
      item.product_id || null,
      item.description,
      Number(item.quantity || 1),
      Number(item.unit_cost || 0),
    ]
  );
  return rows[0];
};

const insertTransaction = async (client, companyId, custodyId, tx) => {
  const exec = getExecutor(client);
  const { rows } = await exec.query(
    `INSERT INTO custody_transactions (
       company_id, custody_id, transaction_type, transaction_date,
       amount, expense_category, expense_account_id, description,
       reference_type, reference_id, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      companyId,
      custodyId,
      tx.transaction_type,
      tx.transaction_date,
      tx.amount,
      tx.expense_category || null,
      tx.expense_account_id || null,
      tx.description || null,
      tx.reference_type || null,
      tx.reference_id || null,
      tx.created_by || null,
    ]
  );
  return rows[0];
};

module.exports = {
  findTypesByCompany,
  findTypeById,
  insertType,
  getPrefix,
  getNextSequence,
  findAllByCompany,
  findById,
  findItemsByCustodyId,
  findTransactionsByCustodyId,
  insertCustody,
  insertCustodyItem,
  insertTransaction,
};