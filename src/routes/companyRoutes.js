const router = require('express').Router();
const ctrl = require('../controllers/CompanyController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/current', authorize('companies.view'), ctrl.getCurrent);

router.patch('/current', authorize('companies.update'),
  [body('name').optional().trim().notEmpty(),
   body('email').optional({ nullable: true }).isEmail(),
   body('phone').optional({ nullable: true }).trim(),
   body('website').optional({ nullable: true }).trim(),
   body('country').optional({ nullable: true }).trim(),
   body('city').optional({ nullable: true }).trim()],
  validate, ctrl.updateCurrent);

router.get('/settings', authorize('settings.view'), ctrl.getSettings);
router.put('/settings', authorize('settings.update'), ctrl.updateSettings);

router.post('/change-currency', authorize('companies.update'),
  [body('currency_id').isUUID()], validate, ctrl.changeCurrency);

router.post('/external-users', authorize('users.create'),
  [body('user_type').isIn(['customer', 'supplier']),
   body('name').trim().notEmpty(),
   body('email').isEmail().normalizeEmail(),
   body('password').isLength({ min: 8 }),
   body('phone').optional({ nullable: true }).trim(),
   body('credit_limit').optional().isFloat({ min: 0 })],
  validate, ctrl.createExternalUser);

module.exports = router;