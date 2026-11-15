
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl = require('../controllers/unitsController');

const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');

const validate = require('../middlewares/validateMiddleware');

router.use(authenticate, requireCompany);

// GET /units
router.get(
  '/',
  authorize('units.view'),
  [
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),

    query('is_active')
      .optional()
      .isIn(['true', 'false']),
  ],
  validate,
  ctrl.list
);

// GET /units/:id
router.get(
  '/:id',
  authorize('units.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getById
);

// POST /units
router.post(
  '/',
  authorize('units.create'),
  [
    body('code')
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 20 }),

    body('name')
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 50 }),

    body('name_en')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 }),
  ],
  validate,
  ctrl.create
);

// PATCH /units/:id
router.patch(
  '/:id',
  authorize('units.update'),
  [
    param('id').isUUID(),

    body('code')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 20 }),

    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 }),

    body('name_en')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 50 }),

    body('is_active')
      .optional()
      .isBoolean(),
  ],
  validate,
  ctrl.update
);

// DELETE /units/:id
router.delete(
  '/:id',
  authorize('units.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.remove
);

module.exports = router;
