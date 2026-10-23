const router = require('express').Router();
const ctrl = require('../controllers/PaymentController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('payments.view'),
  [query('invoice_id').optional().isUUID(),
   query('payment_type').optional().isIn(['receive', 'pay']),
   query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601()],
  validate, ctrl.list);

router.post('/', authorize('payments.create'),
  [body('invoice_id').isUUID(),
   body('amount').isFloat({ gt: 0 }),
   body('payment_type').optional().isIn(['receive', 'pay']),
   body('payment_date').optional().isISO8601(),
   body('method').optional().isIn(['cash', 'bank', 'cheque']),
   body('cash_account_id').optional().isUUID()],
  validate, ctrl.create);

router.delete('/:id', authorize('payments.delete'), [param('id').isUUID()], validate, ctrl.remove);
router.post('/refund', authorize('payments.create'),
  [body('customer_id').isUUID(),
   body('amount').isFloat({ gt: 0 }),
   body('return_id').optional().isUUID(),
   body('payment_date').optional().isISO8601(),
   body('method').optional().isIn(['cash', 'bank', 'cheque']),
   body('cash_account_id').optional().isUUID()],
  validate, ctrl.refundToCustomer);

router.post('/apply-credit', authorize('payments.create'),
  [body('invoice_id').isUUID(),
   body('amount').isFloat({ gt: 0 })],
  validate, ctrl.applyCredit);
module.exports = router;