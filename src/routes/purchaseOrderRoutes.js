
const router = require('express').Router();

const ctrl = require('../controllers/PurchaseOrderController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');

const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

const STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'confirmed',
  'cancelled',
];

const PAYMENT_TYPES = ['cash', 'credit', 'partial'];

const PAYMENT_METHODS = [
  'cash',
  'bank',
  'cheque',
  'card',
  'wallet',
  'other',
];

// قواعد التحقق المشتركة لإنشاء أمر الشراء
const createRules = [
  body('supplier_id').isUUID(),
  body('currency_id').isUUID(),

  body('order_date').optional().isISO8601(),
  body('exchange_rate').optional().isFloat({ gt: 0 }),

  body('payment_type')
    .optional()
    .isIn(PAYMENT_TYPES),

  body('payment_method')
    .optional()
    .isIn(PAYMENT_METHODS),

  body('payment_terms_days')
    .optional()
    .isInt({ min: 0, max: 365 }),

  body('paid_amount')
    .optional()
    .isFloat({ min: 0 }),

  // بيانات فاتورة المورد الورقية
  body('supplier_invoice_number')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 }),

  body('supplier_invoice_date')
    .optional()
    .isISO8601(),

  // بنود أمر الشراء
  body('items')
    .isArray({ min: 1 }),

  body('items.*.product_id')
    .isUUID(),

  body('items.*.supplier_product_id')
    .optional()
    .isUUID(),

  body('items.*.paid_quantity')
    .optional()
    .isFloat({ gt: 0 }),

  body('items.*.bonus_quantity')
    .optional()
    .isFloat({ min: 0 }),

  body('items.*.quantity')
    .optional()
    .isFloat({ gt: 0 }),

  body('items.*.unit_price')
    .optional()
    .isFloat({ min: 0 }),

  body('items.*.discount_rate')
    .optional()
    .isFloat({ min: 0, max: 100 }),

  body('items.*.discount_amount')
    .optional()
    .isFloat({ min: 0 }),

  body('items.*.tax_rate')
    .optional()
    .isFloat({ min: 0, max: 100 }),

  body('items.*.batch_number')
    .optional()
    .isString()
    .trim(),

  body('items.*.expiry_date')
    .optional()
    .isISO8601(),
];

// قائمة أوامر الشراء
router.get(
  '/',
  authorize('purchase_orders.view'),
  [
    query('status').optional().isIn(STATUSES),
    query('supplier_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.list
);

// الطلبات الواردة من الشركات الأخرى
router.get(
  '/incoming',
  authorize('purchase_orders.view'),
  ctrl.getIncoming
);

// معاينة التسليم باستخدام QR أو الرمز
router.get(
  '/delivery/preview',
  authorize('purchase_orders.view'),
  [
    query('token').isString().trim().notEmpty(),
  ],
  validate,
  ctrl.previewByToken
);

// تأكيد التسليم باستخدام الرمز
router.post(
  '/delivery/confirm-by-token',
  authorize('purchase_orders.confirm'),
  [
    body('token').isString().trim().notEmpty(),
  ],
  validate,
  ctrl.confirmByToken
);

// إنشاء أمر شراء — مسار واحد فقط
router.post(
  '/',
  authorize('purchase_orders.create'),
  createRules,
  validate,
  ctrl.create
);

// تأكيد أمر شراء محدد
router.post(
  '/:id/confirm',
  authorize('purchase_orders.confirm'),
  [
    param('id').isUUID(),
    body('delivery_token').optional().isString(),
    body('used_mode')
      .optional()
      .isIn(['authenticated', 'public']),
  ],
  validate,
  ctrl.confirm
);

// إلغاء أمر شراء
router.post(
  '/:id/cancel',
  authorize('purchase_orders.cancel'),
  [
    param('id').isUUID(),
  ],
  validate,
  ctrl.cancel
);

// الموافقة على أمر شراء
router.post(
  '/:id/approve',
  authorize('purchase_orders.approve'),
  [
    param('id').isUUID(),
    body('reason')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 1000 }),
  ],
  validate,
  ctrl.approve
);

// رفض أمر شراء
router.post(
  '/:id/reject',
  authorize('purchase_orders.reject'),
  [
    param('id').isUUID(),
    body('reason')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Rejection reason is required')
      .isLength({ max: 1000 }),
  ],
  validate,
  ctrl.reject
);

// تفاصيل أمر شراء محدد
router.get(
  '/:id',
  authorize('purchase_orders.view'),
  [
    param('id').isUUID(),
  ],
  validate,
  ctrl.getOne
);

module.exports = router;
