const router = require('express').Router();
const ctrl = require('../controllers/WarehouseController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/', authorize('warehouses.view'), ctrl.list);
router.get('/:id', authorize('warehouses.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post(
  '/',
  authorize('warehouses.create'),
  [body('name').trim().notEmpty().isLength({ max: 150 })],
  validate,
  ctrl.create
);

router.patch('/:id', authorize('warehouses.update'), [param('id').isUUID()], validate, ctrl.update);
router.delete('/:id', authorize('warehouses.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;