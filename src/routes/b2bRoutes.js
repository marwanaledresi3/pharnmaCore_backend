// routes/b2bRoutes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl = require('../controllers/B2BController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/b2b/companies
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/companies',
  authorize('b2b.view'),
  [
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('type')
      .optional()
      .isIn(['warehouse', 'distributor', 'manufacturer', 'pharmacy', 'all']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.listCompanies
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/b2b/companies/register
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/companies/register',
  authorize('b2b.create'),
  [
    body('name').isString().trim().notEmpty().isLength({ max: 200 }),
    body('business_type').isIn([
      'warehouse',
      'distributor',
      'manufacturer',
      'pharmacy',
    ]),
    body('phone').isString().trim().notEmpty().isLength({ max: 50 }),
    body('email').optional().isEmail(),
    body('tax_number').optional().isString().trim().isLength({ max: 50 }),
    body('city').optional().isString().trim().isLength({ max: 100 }),
    body('address').optional().isString().trim(),
  ],
  validate,
  ctrl.registerCompany
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/b2b/companies/:id/products/stock
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/companies/:id/products/stock',
  authorize('b2b.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getCompanyStock
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/b2b/companies/:id
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/companies/:id',
  authorize('b2b.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getCompany
);

module.exports = router;