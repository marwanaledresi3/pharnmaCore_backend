const router = require('express').Router();
const ctrl = require('../controllers/PortalController');
const { authenticate, requireExternal } = require('../middlewares/authMiddleware');

router.use(authenticate, requireExternal);

router.get('/profile', ctrl.profile);
router.get('/invoices', ctrl.invoices);

module.exports = router;