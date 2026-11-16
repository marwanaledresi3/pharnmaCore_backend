// routes/cashRegistersRoutes.js
const router = require('express').Router();
const cashCtrl = require('../controllers/CashRegisterController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// التحويلات النقدية (Cash Transfers) — يجب أن تكون قبل مسارات /:id
// ═══════════════════════════════════════════════════════════════════════════

const listTransfersValidation = [
  query('cash_register_id').optional().isUUID(),
  query('register_id').optional().isUUID(),
  query('status').optional().isIn(['completed', 'cancelled']),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const createTransferValidation = [
  body('transfer_date').optional().isISO8601(),
  body('from_cash_register_id').optional({ nullable: true }).isUUID(),
  body('to_cash_register_id').optional({ nullable: true }).isUUID(),
  body('from_register_id').optional({ nullable: true }).isUUID(),
  body('to_register_id').optional({ nullable: true }).isUUID(),
  body('from_account_id').optional({ nullable: true }).isUUID(),
  body('to_account_id').optional({ nullable: true }).isUUID(),
  body('currency_id').optional({ nullable: true }).isUUID(),
  body('exchange_rate').optional().isFloat({ gt: 0 }),
  body('amount').isFloat({ gt: 0 }),
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('auto_confirm').optional().isBoolean(),
];

router.get(
  ['/transfers', '/cash-transfers'],
  authorize('cash_transfers.view'),
  listTransfersValidation,
  validate,
  cashCtrl.getCashTransfers
);

router.post(
  ['/transfers', '/cash-transfers'],
  authorize('cash_transfers.create'),
  createTransferValidation,
  validate,
  cashCtrl.createCashTransfer
);

router.post(
  ['/transfers/:id/cancel', '/cash-transfers/:id/cancel'],
  authorize('cash_transfers.cancel'),
  [param('id').isUUID()],
  validate,
  cashCtrl.cancelCashTransfer
);

// ═══════════════════════════════════════════════════════════════════════════
// الصناديق النقدية (Cash Registers)
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/',
  authorize('cash_registers.view'),
  [
    query('branch_id').optional().isUUID(),
    query('is_active').optional().isBoolean(),
    query('search').optional().isString().trim(),
  ],
  validate,
  cashCtrl.getCashRegisters
);

router.get(
  '/:id/statement',
  authorize('cash_registers.view'),
  [
    param('id').isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  cashCtrl.getRegisterStatement
);

router.get(
  '/:id',
  authorize('cash_registers.view'),
  [param('id').isUUID()],
  validate,
  cashCtrl.getCashRegisterById
);

router.post(
  '/',
  authorize('cash_registers.create'),
  [
    body('name').isString().trim().notEmpty().withMessage('اسم الصندوق مطلوب').isLength({ max: 150 }),
    body('code').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('branch_id').optional({ nullable: true }).isUUID(),
    body('currency_id').optional({ nullable: true }).isUUID(),
    body('opening_balance').optional().isFloat(),
    body('responsible_user_id').optional({ nullable: true }).isUUID(),
    body('is_default').optional().isBoolean(),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validate,
  cashCtrl.createCashRegister
);

const updateRegisterValidation = [
  param('id').isUUID(),
  body('name').optional().isString().trim().notEmpty().isLength({ max: 150 }),
  body('code').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('branch_id').optional({ nullable: true }).isUUID(),
  body('responsible_user_id').optional({ nullable: true }).isUUID(),
  body('is_default').optional().isBoolean(),
  body('is_active').optional().isBoolean(),
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

router.put(
  '/:id',
  authorize('cash_registers.update'),
  updateRegisterValidation,
  validate,
  cashCtrl.updateCashRegister
);

router.patch(
  '/:id',
  authorize('cash_registers.update'),
  updateRegisterValidation,
  validate,
  cashCtrl.updateCashRegister
);

module.exports = router;