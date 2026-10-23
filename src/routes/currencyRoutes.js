const router = require('express').Router();
const ctrl = require('../controllers/CurrencyController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate);

// عرض العملات متاح لأي مستخدم مسجل
router.get('/', ctrl.list);

router.use(requireCompany);

router.post('/convert', authorize('currencies.view'),
  [body('amount').isFloat({ gt: 0 }),
   body('currency_id').isUUID(),
   body('as_of_date').optional().isISO8601()],
  validate, ctrl.convert);

router.post('/', authorize('currencies.create'),
  [body('code').trim().isLength({ min: 3, max: 3 }).toUpperCase(),
   body('name').trim().notEmpty(),
   body('symbol').optional().trim()],
  validate, ctrl.create);

router.patch('/:id', authorize('currencies.update'),
  [param('id').isUUID()], validate, ctrl.update);

module.exports = router;