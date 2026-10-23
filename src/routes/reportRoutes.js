const router = require('express').Router();
const ctrl = require('../controllers/ReportController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { query } = require('express-validator');

router.use(authenticate, requireCompany);

const dateRange = [
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
];

// Dashboard
router.get('/dashboard', ctrl.dashboard);

// Financial
router.get('/balance-sheet', authorize('reports.view_financial'),
  [query('date_to').optional().isISO8601()], validate, ctrl.balanceSheet);

router.get('/income-statement', authorize('reports.view_financial'),
  dateRange, validate, ctrl.incomeStatement);

router.get('/general-ledger', authorize('reports.view_financial'),
  [...dateRange,
   query('account_type').optional().isIn(['asset', 'liability', 'equity', 'revenue', 'expense'])],
  validate, ctrl.generalLedger);

router.get('/tax-summary', authorize('reports.view_financial'),
  dateRange, validate, ctrl.taxSummary);

// AR / AP
router.get('/ar-aging', authorize('reports.view_financial'),
  [query('as_of_date').optional().isISO8601()], validate, ctrl.arAging);

router.get('/ap-aging', authorize('reports.view_financial'),
  [query('as_of_date').optional().isISO8601()], validate, ctrl.apAging);

// Sales
router.get('/sales', authorize('reports.view_sales'),
  [...dateRange, query('group_by').optional().isIn(['day', 'month', 'year'])],
  validate, ctrl.salesReport);

router.get('/top-products', authorize('reports.view_sales'),
  [...dateRange, query('limit').optional().isInt({ min: 1, max: 100 })],
  validate, ctrl.topProducts);

// Purchases
router.get('/purchases', authorize('reports.view_purchases'),
  [...dateRange, query('group_by').optional().isIn(['day', 'month', 'year'])],
  validate, ctrl.purchasesReport);

// Inventory
router.get('/inventory', authorize('reports.view_inventory'),
  [query('warehouse_id').optional().isUUID()], validate, ctrl.inventoryReport);

module.exports = router;