const router = require('express').Router();
const ctrl = require('../controllers/InvoiceController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('invoices.view'),
  [query('status').optional().isIn(['unpaid', 'partial', 'paid', 'cancelled']),
   query('invoice_type').optional().isIn(['sale', 'purchase']),
   query('date_from').optional().isISO8601(),
   query('date_to').optional().isISO8601()],
  validate, ctrl.list);

router.get('/:id', authorize('invoices.view'), [param('id').isUUID()], validate, ctrl.getOne);
router.get('/:id/payments', authorize('payments.view'), [param('id').isUUID()], validate, ctrl.getPayments);

router.post('/from-order/:orderId',
  authorize('invoices.create'),
  [param('orderId').isUUID(), body('due_date').optional().isISO8601()],
  validate, ctrl.createFromOrder);

router.post('/:id/cancel', authorize('invoices.cancel'), [param('id').isUUID()], validate, ctrl.cancel);

router.post('/from-purchase-order/:orderId',
  authorize('invoices.create'),
  [param('orderId').isUUID(), body('due_date').optional().isISO8601()],
  validate, ctrl.createFromPurchaseOrder);
  
module.exports = router;