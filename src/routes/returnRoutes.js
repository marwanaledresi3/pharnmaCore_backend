const router = require('express').Router();
const ctrl = require('../controllers/ReturnController');
const { authenticate, requireCompany, requireInternal, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany, requireInternal);

const itemsValidator = [
  body('items').isArray({ min: 1 }),
  body('items.*.product_id').isUUID(),
  body('items.*.quantity').isFloat({ gt: 0 }),
  body('items.*.unit_price').optional().isFloat({ min: 0 }),
  body('items.*.batch_id').optional({ nullable: true }).isUUID(),
];

router.get('/', authorize('invoices.view'),
  [query('return_type').optional().isIn(['sale', 'purchase']),
   query('status').optional().isIn(['draft', 'confirmed', 'cancelled']),
   query('invoice_id').optional().isUUID(),
   query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601()],
  validate, ctrl.list);

router.get('/:id', authorize('invoices.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post('/sale', authorize('invoices.create'),
  [body('invoice_id').isUUID(),
   body('return_date').optional().isISO8601(),
   body('reason').optional().trim(),
   ...itemsValidator],
  validate, ctrl.createSale);

router.post('/purchase', authorize('invoices.create'),
  [body('invoice_id').isUUID(),
   body('return_date').optional().isISO8601(),
   body('reason').optional().trim(),
   ...itemsValidator],
  validate, ctrl.createPurchase);

router.post('/:id/confirm', authorize('invoices.update'),
  [param('id').isUUID()], validate, ctrl.confirm);

router.post('/:id/cancel', authorize('invoices.cancel'),
  [param('id').isUUID()], validate, ctrl.cancel);

module.exports = router;