// dashboardRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/DashboardController');
const { authenticate, requireCompany , authorize} = require('../middlewares/authMiddleware');

router.use(authenticate, requireCompany);
router.get('/summary', authorize('dashboard.view'), ctrl.summary);
router.get('/recent-activity', authorize('dashboard.view'), ctrl.recentActivity);

module.exports = router;