const { verifyToken } = require('../utils/jwt');
const ApiError = require('../errors/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or invalid authorization header');
  }

  const token = header.split(' ')[1];
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const user = await User.findByIdWithRoles(payload.sub);
  if (!user) throw new ApiError(401, 'User not found');
  if (!user.is_active) throw new ApiError(403, 'User is inactive');

  req.user = user;
  next();
});

const requireCompany = (req, res, next) => {
  if (!req.user.company_id) {
    return next(new ApiError(400, 'This operation requires a company context'));
  }
  next();
};

const authorize = (...requiredPerms) => (req, res, next) => {
  if ((req.user.roles || []).includes('Owner')) return next();

  const perms = req.user.permissions || [];
  const ok = requiredPerms.every((p) => perms.includes(p));
  if (!ok) return next(new ApiError(403, 'Insufficient permissions'));
  next();
};
/**
 * يسمح فقط للمستخدمين الداخليين (موظفين)
 */
const requireInternal = (req, res, next) => {
  if (req.user.user_type !== 'internal') {
    return next(new ApiError(403, 'This endpoint is for internal users only'));
  }
  next();
};

/**
 * يسمح فقط للمستخدمين الخارجيين
 */
const requireExternal = (req, res, next) => {
  if (req.user.user_type !== 'external') {
    return next(new ApiError(403, 'This endpoint is for external users only'));
  }
  next();
};

module.exports = { authenticate, requireCompany, authorize, requireInternal, requireExternal };