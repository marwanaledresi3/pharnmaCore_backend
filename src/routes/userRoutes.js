const router = require('express').Router();
const ctrl = require('../controllers/UserController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

router.get(
  '/',
  authorize('users.view'),
  [query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  ctrl.list
);

router.get('/:id', authorize('users.view'), [param('id').isUUID()], validate, ctrl.getOne);

router.post(
  '/',
  authorize('users.create'),
  [
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('role_ids').optional().isArray(),
  ],
  validate,
  ctrl.create
);

router.patch('/:id', authorize('users.update'), [param('id').isUUID()], validate, ctrl.update);

router.patch(
  '/:id/password',
  authorize('users.update'),
  [param('id').isUUID(), body('password').isLength({ min: 8 })],
  validate,
  ctrl.changePassword
);

router.patch(
  '/:id/status',
  authorize('users.activate'),
  [param('id').isUUID(), body('is_active').isBoolean()],
  validate,
  ctrl.changeStatus
);

router.put(
  '/:id/roles',
  authorize('roles.assign'),
  [param('id').isUUID(), body('role_ids').isArray()],
  validate,
  ctrl.assignRoles
);

router.delete('/:id', authorize('users.delete'), [param('id').isUUID()], validate, ctrl.remove);

module.exports = router;