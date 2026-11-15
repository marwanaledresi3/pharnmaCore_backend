const router = require('express').Router();
const ctrl = require('../controllers/SupplierController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('suppliers.view'),
  [query('search').optional().trim(),
    query('limit').optional().isInt({ min: 1, max: 200 }),
   query('is_active').optional().isBoolean()],
  validate, ctrl.list);

router.get('/:id', authorize('suppliers.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post('/', authorize('suppliers.create'),
  [body('name').trim().notEmpty().isLength({ max: 200 }),
   body('email').optional({ nullable: true }).isEmail()],
  validate, ctrl.create);

router.patch('/:id', authorize('suppliers.update'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 200 }),
    body('email').optional({ nullable: true }).isEmail(),
    body('phone').optional({ nullable: true }).trim(),
    body('address').optional({ nullable: true }).trim(),
    body('tax_number').optional({ nullable: true }).trim(),
    body('is_active').optional().isBoolean(),
    body('account_id').optional({ nullable: true }).isUUID(),
    body('user_id').optional({ nullable: true }).isUUID(),
  ],
  validate, ctrl.update);
router.delete('/:id', authorize('suppliers.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;