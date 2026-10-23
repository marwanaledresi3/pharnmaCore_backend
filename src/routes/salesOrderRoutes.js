const router = require('express').Router();
const ctrl = require('../controllers/SalesOrderController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('sales_orders.view'),
  [query('status').optional().isIn(['draft', 'confirmed', 'invoiced', 'cancelled']),
   query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601()],
  validate, ctrl.list);

router.get('/:id', authorize('sales_orders.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post('/', authorize('sales_orders.create'),
  [body('customer_id').isUUID(),
   body('currency_id').isUUID(),
   body('order_date').optional().isISO8601(),
   body('exchange_rate').optional().isFloat({ gt: 0 }),
   body('items').isArray({ min: 1 }),
   body('items.*.product_id').isUUID(),
   body('items.*.quantity').isFloat({ gt: 0 }),
   body('items.*.unit_price').isFloat({ min: 0 }),
   body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 })],
  validate, ctrl.create);

router.post('/:id/confirm', authorize('sales_orders.confirm'), [param('id').isUUID()], validate, ctrl.confirm);
router.post('/:id/cancel', authorize('sales_orders.cancel'), [param('id').isUUID()], validate, ctrl.cancel);

module.exports = router;