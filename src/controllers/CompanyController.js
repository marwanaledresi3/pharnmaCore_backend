const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Company = require('../models/Company');
const Currency = require('../models/Currency');
const {pool} = require('../config/pool');

const getCurrent = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.user.company_id);
  if (!company) throw new ApiError(404, 'Company not found');
  res.json({ success: true, data: company });
});

const updateCurrent = asyncHandler(async (req, res) => {
  const updated = await Company.update(req.user.company_id, req.body);
  if (!updated) throw new ApiError(400, 'No valid fields to update');
  res.json({ success: true, data: updated });
});

const getSettings = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT key, value FROM settings WHERE company_id = $1 ORDER BY key`,
    [req.user.company_id]
  );
  const settings = {};
  for (const row of r.rows) settings[row.key] = row.value;
  res.json({ success: true, data: settings });
});

const updateSettings = asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) throw new ApiError(400, 'No settings provided');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO settings (company_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, key)
         DO UPDATE SET value = EXCLUDED.value`,
        [req.user.company_id, key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * تغيير العملة الأساسية للشركة
 * مسموح فقط للـ Owner، وفقط إذا لا توجد قيود/فواتير/أوامر
 */
const changeCurrency = asyncHandler(async (req, res) => {
  // فحص أن المستخدم Owner
  if (!(req.user.roles || []).includes('Owner')) {
    throw new ApiError(403, 'Only the company owner can change the base currency');
  }

  const { currency_id } = req.body;

  const currency = await Currency.findById(currency_id);
  if (!currency) throw new ApiError(400, 'Currency not found');

  const check = await Company.canChangeCurrency(req.user.company_id);
  if (!check.can_change) {
    throw new ApiError(400,
      `Cannot change currency: ${check.reasons.posted_entries} posted entries, ` +
      `${check.reasons.invoices} invoices, ${check.reasons.orders} orders exist`
    );
  }

  const updated = await Company.changeCurrency(req.user.company_id, currency_id);
  res.json({ success: true, data: updated });
});

/**
 * POST /companies/external-users
 * ينشئ مستخدم خارجي (عميل أو مورد) ويربطه
 * Body:
 *   { user_type: 'customer'|'supplier', name, email, password,
 *     phone?, address?, tax_number?, credit_limit? }
 */
const createExternalUser = asyncHandler(async (req, res) => {
  const {
    user_type, name, email, password,
    phone, address, tax_number, credit_limit,
  } = req.body;

  if (!['customer', 'supplier'].includes(user_type)) {
    throw new ApiError(400, 'user_type must be customer or supplier');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) تحقق من تكرار الإيميل
    const dup = await client.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (dup.rowCount) throw new ApiError(409, 'Email already registered');

    // 2) إنشاء user
    const passwordUtil = require('../utils/password');
    const hash = await passwordUtil.hash(password);

    const userRes = await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, user_type, is_active)
       VALUES ($1, $2, $3, $4, 'external', TRUE)
       RETURNING id, name, email, user_type`,
      [req.user.company_id, name, email, hash]
    );
    const user = userRes.rows[0];

    // 3) إنشاء customer أو supplier
    let entity;
    if (user_type === 'customer') {
      const r = await client.query(
        `INSERT INTO customers
           (company_id, user_id, name, phone, email, address, tax_number, credit_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, email, is_active`,
        [req.user.company_id, user.id, name, phone || null, email,
         address || null, tax_number || null, credit_limit || 0]
      );
      entity = { customer: r.rows[0] };
    } else {
      const r = await client.query(
        `INSERT INTO suppliers
           (company_id, user_id, name, phone, email, address, tax_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, is_active`,
        [req.user.company_id, user.id, name, phone || null, email,
         address || null, tax_number || null]
      );
      entity = { supplier: r.rows[0] };
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { user, ...entity } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = {
  getCurrent,
  updateCurrent,
  getSettings,
  updateSettings,
  changeCurrency,
  createExternalUser,
};