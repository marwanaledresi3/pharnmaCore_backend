const router = require('express').Router();
const ctrl = require('../controllers/CustomerController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('customers.view'),
  [query('search').optional().trim(), query('is_active').optional().isBoolean()],
  validate, ctrl.list);

router.get('/:id', authorize('customers.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post('/', authorize('customers.create'),
  [body('name').trim().notEmpty().isLength({ max: 200 }),
   body('email').optional({ nullable: true }).isEmail(),
   body('credit_limit').optional().isFloat({ min: 0 })],
  validate, ctrl.create);

router.patch('/:id', authorize('customers.update'), [param('id').isUUID()], validate, ctrl.update);
router.delete('/:id', authorize('customers.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;