const router = require('express').Router();
const ctrl = require('../controllers/ProductController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get(
  '/',
  authorize('products.view'),
  [
    query('search').optional().trim(),
    query('is_active').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

router.get('/:id', authorize('products.view'), [param('id').isUUID()], validate, ctrl.getOne);
router.get('/:id/stock', authorize('products.view'), [param('id').isUUID()], validate, ctrl.getStock);

router.post(
  '/',
  authorize('products.create'),
  [
    body('sku').trim().notEmpty().isLength({ max: 50 }),
    body('name').trim().notEmpty().isLength({ max: 200 }),
    body('unit').trim().notEmpty().isLength({ max: 30 }),
    body('barcode').optional({ nullable: true }).trim(),
    body('tax_rate_id').optional({ nullable: true }).isUUID(),
    body('revenue_account_id').optional({ nullable: true }).isUUID(),
    body('inventory_account_id').optional({ nullable: true }).isUUID(),
    body('cogs_account_id').optional({ nullable: true }).isUUID(),
    body('min_stock_level').optional().isFloat({ min: 0 }),
  ],
  validate,
  ctrl.create
);

router.patch(
  '/:id',
  authorize('products.update'),
  [param('id').isUUID(), body('name').optional().trim().notEmpty()],
  validate,
  ctrl.update
);

router.delete('/:id', authorize('products.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;