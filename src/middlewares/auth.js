const { verifyToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {pool} = require('../config/pool');

/**
 * يتحقق من JWT ويجلب المستخدم مع أدواره وصلاحياته
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or invalid authorization header');
  }

  const token = header.split(' ')[1];
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }

  // جلب المستخدم مع أدواره وصلاحياته
  const userResult = await pool.query(
    `SELECT id, company_id, name, email, user_type, is_active
     FROM users WHERE id = $1`,
    [payload.sub]
  );

  const user = userResult.rows[0];
  if (!user) throw new ApiError(401, 'User not found');
  if (!user.is_active) throw new ApiError(403, 'User is inactive');

  // الأدوار
  const rolesResult = await pool.query(
    `SELECT r.id, r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [user.id]
  );

  // الصلاحيات
  const permsResult = await pool.query(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = $1`,
    [user.id]
  );

  req.user = {
    ...user,
    roles: rolesResult.rows.map((r) => r.name),
    permissions: permsResult.rows.map((p) => p.code),
  };

  next();
});

/**
 * يفرض وجود company_id (إلا للمدير العام user_type='internal' و company_id=null)
 */
const requireCompany = (req, res, next) => {
  if (!req.user.company_id) {
    return next(new ApiError(400, 'This operation requires a company context'));
  }
  next();
};

/**
 * فحص صلاحية معينة
 * الاستخدام: authorize('sales.create')
 */
const authorize = (...requiredPerms) => (req, res, next) => {
  const userRoles = req.user.roles || [];
  if (userRoles.includes('Owner')) {
    return next(); // Owner يتخطى كل الفحوصات
  }

  const userPerms = req.user.permissions || [];
  const hasAll = requiredPerms.every((p) => userPerms.includes(p));
  if (!hasAll) {
    return next(new ApiError(403, 'Insufficient permissions'));
  }
  next();
};

module.exports = { authenticate, requireCompany, authorize };