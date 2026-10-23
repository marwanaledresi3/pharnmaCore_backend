const router = require('express').Router();
const ctrl = require('../controllers/AccountController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// === قراءة ===
router.get('/tree', authorize('accounts.view'), ctrl.getTree);

router.get(
  '/',
  authorize('accounts.view'),
  [
    query('type').optional().isIn(['asset', 'liability', 'equity', 'revenue', 'expense']),
    query('is_active').optional().isBoolean(),
    query('search').optional().trim(),
  ],
  validate,
  ctrl.list
);

router.get('/postable', authorize('accounts.view'), ctrl.listPostable);

router.get(
  '/:id',
  authorize('accounts.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getOne
);

router.get(
  '/:id/ledger',
  authorize('accounts.view'),
  [
    param('id').isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.getLedger
);

// === كتابة ===
router.post(
  '/',
  authorize('accounts.create'),
  [
    body('code').trim().notEmpty().isLength({ max: 20 }),
    body('name').trim().notEmpty().isLength({ max: 150 }),
    body('account_type').isIn(['asset', 'liability', 'equity', 'revenue', 'expense']),
    body('parent_id').optional({ nullable: true }).isUUID(),
  ],
  validate,
  ctrl.create
);

router.patch(
  '/:id',
  authorize('accounts.update'),
  [
    param('id').isUUID(),
    body('code').optional().trim().notEmpty().isLength({ max: 20 }),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }),
    body('parent_id').optional({ nullable: true }).isUUID(),
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.update
);

router.patch(
  '/:id/status',
  authorize('accounts.update'),
  [param('id').isUUID(), body('is_active').isBoolean()],
  validate,
  ctrl.changeStatus
);

router.delete(
  '/:id',
  authorize('accounts.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.remove
);

module.exports = router;