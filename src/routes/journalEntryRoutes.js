const router = require('express').Router();
const ctrl = require('../controllers/JournalEntryController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// === قراءة ===
router.get(
  '/',
  authorize('journal_entries.view'),
  [
    query('status').optional().isIn(['draft', 'posted']),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

router.get(
  '/trial-balance',
  authorize('journal_entries.view'),
  [
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.trialBalance
);

router.get('/:id', authorize('journal_entries.view'), [param('id').isUUID()], validate, ctrl.getOne);

// === كتابة ===
const linesValidator = [
  body('entry_date').isISO8601(),
  body('description').optional().trim(),
  body('source_type')
    .optional()
    .isIn(['sale', 'purchase', 'payment', 'manual', 'adjustment']),
  body('source_id').optional({ nullable: true }).isUUID(),
  body('lines').isArray({ min: 2 }).withMessage('At least 2 lines are required'),
  body('lines.*.account_id').isUUID(),
  body('lines.*.debit').optional().isFloat({ min: 0 }),
  body('lines.*.credit').optional().isFloat({ min: 0 }),
  body('lines.*.description').optional().trim(),
];

router.post('/', authorize('journal_entries.create'), linesValidator, validate, ctrl.create);

router.patch(
  '/:id',
  authorize('journal_entries.update'),
  [param('id').isUUID(), ...linesValidator],
  validate,
  ctrl.update
);

router.post('/:id/post', authorize('journal_entries.post'), [param('id').isUUID()], validate, ctrl.post);
router.post('/:id/unpost', authorize('journal_entries.unpost'), [param('id').isUUID()], validate, ctrl.unpost);

router.delete('/:id', authorize('journal_entries.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;