const router = require('express').Router();
const ctrl = require('../controllers/AuthController');
const { authenticate } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body } = require('express-validator');
router.post('/external-login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  validate, ctrl.externalLogin);
router.post(
  '/register-company',
  [
    body('company.name').trim().notEmpty(),
    body('company.currency_code').isLength({ min: 3, max: 3 }),
    body('owner.name').trim().notEmpty(),
    body('owner.email').isEmail().normalizeEmail(),
    body('owner.password').isLength({ min: 8 }),
  ],
  validate,
  ctrl.registerCompany
);

router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  validate,
  ctrl.login
);

router.get('/me', authenticate, ctrl.me);

router.post(
  '/change-password',
  authenticate,
  [body('current_password').notEmpty(), body('new_password').isLength({ min: 8 })],
  validate,
  ctrl.changePassword
);

module.exports = router;