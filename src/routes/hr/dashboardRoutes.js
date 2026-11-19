const router = require('express').Router();
const ctrl = require('../../controllers/hr/DashboardController');
const { authenticate, requireCompany, authorize } = require('../../middlewares/authMiddleware');

router.use(authenticate, requireCompany);

router.get('/', authorize('employees.view'), ctrl.getStats);

module.exports = router;