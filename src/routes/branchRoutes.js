const router = require('express').Router();
const ctrl = require('../controllers/BranchController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('branches.view'),
  [query('is_active').optional().isBoolean(),
   query('page').optional().isInt({ min: 1 }),
   query('limit').optional().isInt({ min: 1, max: 100 }),
   query('search').optional().trim().isLength({ max: 100 }),
   query('sort').optional().isIn(['name','code','is_main','is_active','created_at']),
   query('order').optional().isIn(['asc','desc'])],
  validate, ctrl.list);

router.get('/:id', authorize('branches.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post('/', authorize('branches.create'), [
  body('name').isString().trim().notEmpty(),
  body('code').optional().isString().trim(),
  body('address').optional().isString().trim(),
  body('phone').optional().isString().trim(),
  body('email').optional().isEmail(),
  body('manager_name').optional().isString().trim(),
  body('warehouse_id').optional().isUUID(),
  body('is_active').optional().isBoolean(),
  body('is_main').optional().isBoolean(),
], validate, ctrl.create);

router.put('/:id', authorize('branches.update'), [
  param('id').isUUID(),
  body('name').optional().isString().trim().notEmpty(),
  body('code').optional().isString().trim(),
  body('address').optional().isString().trim(),
  body('phone').optional().isString().trim(),
  body('email').optional().isEmail(),
  body('manager_name').optional().isString().trim(),
  body('warehouse_id').optional().isUUID(),
  body('is_active').optional().isBoolean(),
  body('is_main').optional().isBoolean(),
], validate, ctrl.update);

router.delete('/:id', authorize('branches.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;