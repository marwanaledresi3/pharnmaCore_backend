// middlewares/employeeScope.js
/**
 * تقييد الاستعلامات بموظف المستخدم الحالي (إن لم يكن لديه صلاحية "view_all").
 *
 * الاستخدام:
 *   router.get('/', authorize('leave_requests.view'), restrictToOwnEmployee('leave_requests'), ctrl.list);
 *
 * يُضيف:
 *   req.scope.employee_id = <uuid>  ← يُستخدم في controller
 *   req.scope.restricted = true|false
 */
const employeeScope = (permissionViewAll) => (req, res, next) => {
  req.scope = req.scope || {};

  // المستخدم لديه صلاحية view_all؟ (يُضاف بواسطة authorize middleware)
  const hasViewAll = req.permissions?.includes(permissionViewAll) || false;

  if (hasViewAll) {
    req.scope.restricted = false;
    return next();
  }

  // مقيّد — يحتاج employee_id
  if (!req.user?.employee_id) {
    return res.status(403).json({
      success: false,
      message: 'هذا الحساب غير مرتبط بموظف — لا يمكن الوصول لهذه البيانات',
    });
  }

  req.scope.restricted = true;
  req.scope.employee_id = req.user.employee_id;
  next();
};

module.exports = { employeeScope };