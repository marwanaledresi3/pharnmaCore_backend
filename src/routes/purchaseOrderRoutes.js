const router = require('express').Router();
const ctrl = require('../controllers/PurchaseOrderController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('purchase_orders.view'),
  [query('status').optional().isIn(['draft', 'confirmed', 'cancelled']),
   query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601()],
  validate, ctrl.list);

router.get('/:id', authorize('purchase_orders.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post('/', authorize('purchase_orders.create'),
  [body('supplier_id').isUUID(),
   body('currency_id').isUUID(),
   body('order_date').optional().isISO8601(),
   body('items').isArray({ min: 1 }),
   body('items.*.product_id').isUUID(),
   body('items.*.quantity').isFloat({ gt: 0 }),
   body('items.*.unit_price').isFloat({ min: 0 }),
   body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
   body('items.*.batch_number').optional().trim(),
   body('items.*.expiry_date').optional().isISO8601()],
  validate, ctrl.create);

router.post('/:id/confirm', authorize('purchase_orders.confirm'), [param('id').isUUID()], validate, ctrl.confirm);
router.post('/:id/cancel', authorize('purchase_orders.cancel'), [param('id').isUUID()], validate, ctrl.cancel);

module.exports = router;