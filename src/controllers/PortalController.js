const asyncHandler = require('../utils/asyncHandler');
const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');

/**
 * GET /portal/profile
 */
const profile = asyncHandler(async (req, res) => {
  // جلب customer أو supplier
  const cust = await pool.query(
    `SELECT id, name, email, phone, address, credit_limit
     FROM customers WHERE user_id = $1`,
    [req.user.id]
  );

  if (cust.rowCount) {
    return res.json({ success: true, data: { type: 'customer', ...cust.rows[0] } });
  }

  const sup = await pool.query(
    `SELECT id, name, email, phone, address FROM suppliers WHERE user_id = $1`,
    [req.user.id]
  );
  if (sup.rowCount) return res.json({ success: true, data: { type: 'supplier', ...sup.rows[0] } });

  throw new ApiError(404, 'Profile not found');
});

/**
 * GET /portal/invoices — فواتير العميل/المورد
 */
const invoices = asyncHandler(async (req, res) => {
  const cust = await pool.query(
    `SELECT id FROM customers WHERE user_id = $1`, [req.user.id]
  );

  let cond, params;
  if (cust.rowCount) {
    cond = 'customer_id = $1';
    params = [cust.rows[0].id];
  } else {
    const sup = await pool.query(
      `SELECT id FROM suppliers WHERE user_id = $1`, [req.user.id]
    );
    if (!sup.rowCount) throw new ApiError(404, 'Profile not found');
    cond = 'supplier_id = $1';
    params = [sup.rows[0].id];
  }

  const r = await pool.query(
    `SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.due_date,
            i.total, i.paid_amount, i.status
     FROM invoices i
     WHERE ${cond}
     ORDER BY i.invoice_date DESC`,
    params
  );

  res.json({ success: true, data: r.rows });
});

module.exports = { profile, invoices };