const router = require('express').Router();
const ctrl = require('../controllers/ExchangeRateController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('exchange_rates.view'),
  [query('currency_id').optional().isUUID(),
   query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601()],
  validate, ctrl.list);

router.get('/current', authorize('exchange_rates.view'),
  [query('currency_id').isUUID(),
   query('as_of_date').optional().isISO8601()],
  validate, ctrl.getCurrent);

router.post('/', authorize('exchange_rates.create'),
  [body('currency_id').isUUID(),
   body('rate').isFloat({ gt: 0 }),
   body('rate_date').optional().isISO8601()],
  validate, ctrl.create);

router.patch('/:id', authorize('exchange_rates.update'),
  [param('id').isUUID(), body('rate').isFloat({ gt: 0 })],
  validate, ctrl.update);

router.delete('/:id', authorize('exchange_rates.delete'),
  [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;