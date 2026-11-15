const router = require('express').Router();
const ctrl = require('../controllers/NoteController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const REASONS = ['return', 'discount', 'correction', 'price_diff', 'shipping', 'other'];

// GET /notes
router.get(
  '/',
  authorize('notes.view'),
  [
    query('note_type').optional().isIn(['credit', 'debit']),
    query('party_type').optional().isIn(['customer', 'supplier']),
    query('status').optional().isIn(['draft', 'confirmed', 'cancelled']),
    query('customer_id').optional().isUUID(),
    query('supplier_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('search').optional().isString().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);
// GET /notes/:id/pdf
router.get(
  '/:id/pdf',
  authorize('notes.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getPdf
);
// GET /notes/:id
router.get(
  '/:id',
  authorize('notes.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

// POST /notes
router.post(
  '/',
  authorize('notes.create'),
  [
    body('note_type').isIn(['credit', 'debit']),
    body('party_type').isIn(['customer', 'supplier']),
    body('customer_id').optional({ nullable: true }).isUUID(),
    body('supplier_id').optional({ nullable: true }).isUUID(),
    body('invoice_id').optional({ nullable: true }).isUUID(),
    body('note_date').optional().isISO8601(),
    body('currency_id').optional().isUUID(),
    body('exchange_rate').optional().isFloat({ gt: 0 }),
    body('reason').isIn(REASONS),
    body('description').optional().isString().trim().isLength({ max: 1000 }),
    body('items').isArray({ min: 1 }),
    body('items.*.description').isString().trim().notEmpty(),
    body('items.*.quantity').isFloat({ gt: 0 }),
    body('items.*.unit_price').isFloat({ min: 0 }),
    body('items.*.discount_rate').optional().isFloat({ min: 0, max: 100 }),
    body('items.*.tax_rate').optional().isFloat({ min: 0, max: 100 }),
    body('items.*.product_id').optional({ nullable: true }).isUUID(),
  ],
  validate,
  ctrl.create
);

// POST /notes/:id/confirm
router.post(
  '/:id/confirm',
  authorize('notes.confirm'),
  [param('id').isUUID()],
  validate,
  ctrl.confirm
);

// POST /notes/:id/cancel
router.post(
  '/:id/cancel',
  authorize('notes.cancel'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.cancel
);

module.exports = router;