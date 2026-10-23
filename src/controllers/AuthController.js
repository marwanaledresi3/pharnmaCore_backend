const {pool} = require('../config/pool');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { signToken } = require('../utils/jwt');
const passwordUtil = require('../utils/password');
const User = require('../models/User');
const companyBootstrapService = require('../services/companyBootstrapService');
const Role = require('../models/Role');
const Company = require('../models/Company');

const registerCompany = asyncHandler(async (req, res) => {
  const { company, owner } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) العملة
    const cur = await client.query(`SELECT id FROM currencies WHERE code = $1`, [company.currency_code.toUpperCase()]);
    if (!cur.rowCount) throw new ApiError(400, `Currency ${company.currency_code} not found`);
    const currencyId = cur.rows[0].id;

    // 2) الشركة
    const newCompany = await Company.create(client, {
      name: company.name,
      currency_id: currencyId,
      tax_number: company.tax_number,
      address: company.address,
      logo_url: company.logo_url,
    });

    // 3) التحقق من الإيميل
    if (await User.findByEmail(owner.email)) {
      throw new ApiError(409, 'Email already registered');
    }

    // 4) المستخدم (Owner) — بدون أدوار أولاً
    const hash = await passwordUtil.hash(owner.password);
    const newUser = await User.createWithRoles(client, {
      company_id: newCompany.id,
      name: owner.name,
      email: owner.email,
      password_hash: hash,
      user_type: 'internal',
    });

    // 5) BOOTSTRAP — كل شيء تلقائي 🚀
    const { roles } = await companyBootstrapService.bootstrap(client, newCompany.id, {
      defaultCurrencyId: currencyId,
      createdBy: newUser.id,
    });

    // 6) إسناد دور Owner للمستخدم
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
      [newUser.id, roles['Owner'].id]
    );

    await client.query('COMMIT');

    const token = signToken({ sub: newUser.id, company_id: newCompany.id });
    res.status(201).json({
      success: true,
      data: {
        company: newCompany,
        user: newUser,
        roles: Object.keys(roles),
        token,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
/**
 * POST /auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findByEmail(email);
  if (!user) throw new ApiError(401, 'Invalid credentials');
  if (!user.is_active) throw new ApiError(403, 'Account is inactive');

  const ok = await passwordUtil.compare(password, user.password_hash);
  if (!ok) throw new ApiError(401, 'Invalid credentials');

  await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
  delete user.password_hash;

  const token = signToken({ sub: user.id, company_id: user.company_id });
  res.json({ success: true, data: { user, token } });
});

/**
 * GET /auth/me
 */
const me = asyncHandler(async (req, res) => {
  const user = await User.findByIdWithRoles(req.user.id);
  if (!user) throw new ApiError(404, 'User not found');

  const roles = await pool.query(
    `SELECT r.id, r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [user.id]
  );

  const perms = await pool.query(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = $1`,
    [user.id]
  );

  res.json({
    success: true,
    data: {
      ...user,
      roles: roles.rows.map(r => r.name),      // ← مصفوفة أسماء: ["Owner", ...]
      permissions: perms.rows.map(p => p.code), // ← مصفوفة أكواد: ["invoices.view", ...]
    },
  });
});

/**
 * POST /auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  const full = await User.findByEmail(req.user.email);
  const ok = await passwordUtil.compare(current_password, full.password_hash);
  if (!ok) throw new ApiError(401, 'Current password is incorrect');

  const hash = await passwordUtil.hash(new_password);
  await User.changePassword(req.user.id, req.user.company_id, hash);
  res.json({ success: true, message: 'Password changed successfully' });
});

/**
 * POST /auth/external-login
 * تسجيل دخول للمستخدمين الخارجيين (عملاء/موردين)
 */
const externalLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findByEmail(email);

  if (!user) throw new ApiError(401, 'Invalid credentials');
  if (!user.is_active) throw new ApiError(403, 'Account is inactive');
  if (user.user_type !== 'external') {
    throw new ApiError(403, 'This endpoint is for external users only');
  }

  const ok = await passwordUtil.compare(password, user.password_hash);
  if (!ok) throw new ApiError(401, 'Invalid credentials');

  // جلب بيانات العميل أو المورد المرتبط
  const {pool} = require('../config/pool');
  let entity;
  const cust = await pool.query(
    `SELECT id, name, email, phone, address, credit_limit
     FROM customers WHERE user_id = $1`,
    [user.id]
  );
  if (cust.rowCount) {
    entity = { type: 'customer', ...cust.rows[0] };
  } else {
    const sup = await pool.query(
      `SELECT id, name, email, phone, address
       FROM suppliers WHERE user_id = $1`,
      [user.id]
    );
    if (sup.rowCount) entity = { type: 'supplier', ...sup.rows[0] };
  }

  await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

  delete user.password_hash;
  const token = signToken({ sub: user.id, company_id: user.company_id, external: true });

  res.json({ success: true, data: { user, entity, token } });
});

// أضفه إلى module.exports
module.exports = { registerCompany, login, externalLogin, me, changePassword };