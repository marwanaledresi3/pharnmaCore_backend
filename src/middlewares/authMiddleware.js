// middlewares/authMiddleware.js
const { verifyToken } = require('../utils/jwt');
const ApiError = require('../errors/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATE
// ═══════════════════════════════════════════════════════════════

/**
 * يتحقق من JWT ويُحمّل:
 *   - req.user = بيانات المستخدم + roles + permissions
 *   - req.user.employee_id = (إن كان مرتبطاً بموظف نشط)
 *
 * ⚠️ employee_id يُستخدم في:
 *   - تقييد الموظف ببياناته فقط (LeaveRequest, Attendance, Payroll)
 *   - عرض قسيمة الراتب الخاصة بالموظف
 */
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

  // ⬇️ إضافة employee_id (إن وُجد)
  // نُجري الاستعلام فقط إذا كان للمستخدم company_id
  if (user.company_id) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM employees
          WHERE user_id = $1
            AND company_id = $2
            AND status IN ('active', 'on_leave')
          LIMIT 1`,
        [user.id, user.company_id]
      );
      if (rows[0]) {
        user.employee_id = rows[0].id;
      }
    } catch (e) {
      // لا نُفشل الطلب — فقط نُسجّل
      console.error('[authMiddleware] attachEmployeeId failed:', e.message);
    }
  }

  req.user = user;
  next();
});

// ═══════════════════════════════════════════════════════════════
// REQUIRE COMPANY
// ═══════════════════════════════════════════════════════════════

const requireCompany = (req, res, next) => {
  if (!req.user.company_id) {
    return next(new ApiError(400, 'This operation requires a company context'));
  }
  next();
};

// ═══════════════════════════════════════════════════════════════
// AUTHORIZE
// ═══════════════════════════════════════════════════════════════

const authorize = (...requiredPerms) => (req, res, next) => {
  // Owner يتخطى كل الفحوصات
  if ((req.user.roles || []).includes('Owner')) return next();

  const perms = req.user.permissions || [];
  const ok = requiredPerms.every((p) => perms.includes(p));
  if (!ok) return next(new ApiError(403, 'Insufficient permissions'));
  next();
};

// ═══════════════════════════════════════════════════════════════
// USER TYPE
// ═══════════════════════════════════════════════════════════════

const requireInternal = (req, res, next) => {
  if (req.user.user_type !== 'internal') {
    return next(new ApiError(403, 'This endpoint is for internal users only'));
  }
  next();
};

const requireExternal = (req, res, next) => {
  if (req.user.user_type !== 'external') {
    return next(new ApiError(403, 'This endpoint is for external users only'));
  }
  next();
};

// ═══════════════════════════════════════════════════════════════
// 🆕 REQUIRE EMPLOYEE
// ═══════════════════════════════════════════════════════════════

/**
 * يتأكد أن المستخدم مرتبط بموظف.
 * يُستخدم في endpoints التي تتطلب employee_id (مثل /payroll/my-payslips).
 */
const requireEmployee = (req, res, next) => {
  if (!req.user.employee_id) {
    return next(new ApiError(
      403,
      'هذا الحساب غير مرتبط بموظف — لا يمكن الوصول لهذه البيانات'
    ));
  }
  next();
};

// ═══════════════════════════════════════════════════════════════
// 🆕 IS EMPLOYEE (مقيّد)
// ═══════════════════════════════════════════════════════════════

/**
 * helper للاستخدام داخل الـ controllers:
 * هل المستخدم مقيّد بموظفه فقط؟
 *
 * يُرجع true إذا:
 *   - مرتبط بموظف (employee_id موجود)
 *   - وليس لديه صلاحية "view_all" المطلوبة
 *
 * @param {Request} req
 * @param {string} viewAllPermission - مثل 'leave_requests.view_all'
 * @returns {boolean}
 */
const isRestrictedToOwn = (req, viewAllPermission) => {
  if (!req.user?.employee_id) return false;  // ليس موظفاً — لا تقييد
  const perms = req.user.permissions || [];
  return !perms.includes(viewAllPermission);
};

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  authenticate,
  requireCompany,
  authorize,
  requireInternal,
  requireExternal,
  requireEmployee,       // 🆕
  isRestrictedToOwn,     // 🆕
};