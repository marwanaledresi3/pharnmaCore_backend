const router = require('express').Router();
const ctrl = require('../controllers/ExpenseController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/',
  authorize('expenses.view'),
  [
    query('status').optional().isIn(['draft', 'posted', 'partial', 'paid', 'cancelled']),
    query('category').optional().isString(),
    query('supplier_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate, ctrl.list
);

router.get('/:id',
  authorize('expenses.view'),
  [param('id').isUUID()],
  validate, ctrl.getOne
);
router.delete('/:id',
  authorize('expenses.delete'),
  [param('id').isUUID()],
  validate, ctrl.remove
);

router.post('/',
  authorize('expenses.create'),
  [
    body('description').isString().trim().notEmpty().withMessage('البيان مطلوب'),
    body('amount').isFloat({ gt: 0 }),
    body('expense_account_id').isUUID(),
    body('currency_id').isUUID(),
    body('expense_date').optional().isISO8601(),
    body('exchange_rate').optional().isFloat({ gt: 0 }),
    body('payment_type').optional().isIn(['cash', 'credit', 'partial']),
    body('payment_method').optional().isIn(['cash', 'bank', 'cheque']),
    body('paid_amount').optional().isFloat({ min: 0 }),
    body('due_date').optional().isISO8601(),
    body('supplier_id').optional().isUUID(),
    body('expense_category').optional().isString(),
    body('external_reference').optional().isString().trim(),
  ],
  validate, ctrl.create
);

router.post('/:id/pay',
  authorize('expenses.update'),
  [
    param('id').isUUID(),
    body('amount').optional().isFloat({ gt: 0 }),
    body('method').optional().isIn(['cash', 'bank', 'cheque']),
    body('payment_date').optional().isISO8601(),
  ],
  validate, ctrl.pay
);

router.post('/:id/cancel',
  authorize('expenses.delete'),
  [param('id').isUUID()],
  validate, ctrl.cancel
);

module.exports = router;