// dashboardRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/DashboardController');
const { authenticate, requireCompany } = require('../middlewares/authMiddleware');

router.use(authenticate, requireCompany);
router.get('/summary', ctrl.summary);
router.get('/recent-activity', ctrl.recentActivity);

module.exports = router;