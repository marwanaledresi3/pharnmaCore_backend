const router = require('express').Router();
const ctrl = require('../controllers/RoleController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param } = require('express-validator');

router.use(authenticate, requireCompany);

router.get('/permissions', authorize('roles.view'), ctrl.listPermissions);

router.get('/', authorize('roles.view'), ctrl.list);
router.get('/:id', authorize('roles.view'), [param('id').isUUID()], validate, ctrl.getOne);
router.post(
  '/',
  authorize('roles.create'),
  [body('name').trim().notEmpty(), body('permission_ids').optional().isArray()],
  validate,
  ctrl.create
);
router.patch('/:id', authorize('roles.update'), [param('id').isUUID()], validate, ctrl.update);
router.put(
  '/:id/permissions',
  authorize('roles.update'),
  [param('id').isUUID(), body('permission_ids').isArray()],
  validate,
  ctrl.assignPermissions
);
router.delete('/:id', authorize('roles.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;