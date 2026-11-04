
const router = require('express').Router();

const ctrl = require('../controllers/PdfController');

const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');

const validate = require('../middlewares/validateMiddleware');

const { param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// فاتورة (بيع أو شراء)
router.get(
  '/invoices/:id',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.invoice
);

// مرتجع (بيع أو شراء)
router.get(
  '/returns/:id',
  authorize('invoices.view'),
  [param('id').isUUID()],
  validate,
  ctrl.returnDoc
);

// سند قبض أو صرف
router.get(
  '/payments/:id',
  authorize('payments.view'),
  [param('id').isUUID()],
  validate,
  ctrl.payment
);

// أمر شراء
router.get(
  '/purchase-orders/:id',
  authorize('purchase_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.purchaseOrder
);
// أمر شراء
router.get(
  '/sales-orders/:id',
  authorize('sales_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.SalesOrder
);

// بوليصة تسليم
router.get(
  '/delivery-notes/:id',
  authorize('purchase_orders.view'),
  [param('id').isUUID()],
  validate,
  ctrl.deliveryNote
);

// المصروفات
router.get(
  '/expenses/:id',
  authorize('expenses.view'),
  [param('id').isUUID()],
  validate,
  ctrl.expense
);

// كشف حساب عميل أو مورد
router.get(
  '/statements/:partyType/:id',
  authorize('reports.view_financial'),
  [
    param('partyType').isIn(['customer', 'supplier']),
    param('id').isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.statement
);

// ميزان المراجعة
router.get(
  '/reports/trial-balance',
  authorize('reports.view_financial'),
  [
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.trialBalance
);

module.exports = router;
