// routes/fixedAssetRoutes.js
const router = require('express').Router();
const ctrl = require('../controllers/FixedAssetController');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body, param, query } = require('express-validator');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ قاعدة ذهبية: كل المسارات الثابتة (static) قبل /:id
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 1) تصنيفات الأصول (Categories)
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/categories',
  authorize('asset_categories.view'),
  [
    query('is_active').optional().isBoolean(),
    query('search').optional().isString().trim(),
  ],
  validate,
  ctrl.listCategories
);

router.get(
  '/categories/:id',
  authorize('asset_categories.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getCategoryById
);

router.post(
  '/categories',
  authorize('asset_categories.create'),
  [
    body('name').isString().trim().notEmpty().isLength({ max: 150 }),
    body('code').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('depreciation_method').optional().isIn(['straight_line', 'declining_balance']),
    body('useful_life_years').isFloat({ gt: 0 }),
    body('salvage_value_percent').optional().isFloat({ min: 0, max: 99 }),
    body('declining_rate').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('asset_account_id').optional({ nullable: true }).isUUID(),
    body('accumulated_depreciation_account_id').optional({ nullable: true }).isUUID(),
    body('depreciation_expense_account_id').optional({ nullable: true }).isUUID(),
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.createCategory
);

router.patch(
  '/categories/:id',
  authorize('asset_categories.update'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 150 }),
    body('code').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('depreciation_method').optional().isIn(['straight_line', 'declining_balance']),
    body('useful_life_years').optional().isFloat({ gt: 0 }),
    body('salvage_value_percent').optional().isFloat({ min: 0, max: 99 }),
    body('declining_rate').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('asset_account_id').optional({ nullable: true }).isUUID(),
    body('accumulated_depreciation_account_id').optional({ nullable: true }).isUUID(),
    body('depreciation_expense_account_id').optional({ nullable: true }).isUUID(),
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.updateCategory
);

router.delete(
  '/categories/:id',
  authorize('asset_categories.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.deleteCategory
);

// ═══════════════════════════════════════════════════════════════════════════
// 2) الإهلاك (Depreciations) — static
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/depreciations',
  authorize('asset_depreciation.view'),
  [
    query('asset_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.listDepreciations
);

router.post(
  '/depreciations/run',
  authorize('asset_depreciation.run'),
  [
    body('period_date').optional().isISO8601(),
    body('auto_post').optional().isBoolean(),
  ],
  validate,
  ctrl.runDepreciation
);

// ═══════════════════════════════════════════════════════════════════════════
// 3) الصيانة (Maintenances) — static
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/maintenances',
  authorize('asset_maintenance.view'),
  [
    query('asset_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.listMaintenances
);

router.post(
  '/maintenances',
  authorize('asset_maintenance.create'),
  [
    body('asset_id').isUUID(),
    body('maintenance_date').optional().isISO8601(),
    body('maintenance_type').optional().isIn(['routine', 'repair', 'upgrade', 'inspection', 'overhaul']),
    body('cost').optional().isFloat({ min: 0 }),
    body('is_capitalized').optional().isBoolean(),
    body('capitalize').optional().isBoolean(),
    body('payment_account_id').optional({ nullable: true }).isUUID(),
    body('expense_account_id').optional({ nullable: true }).isUUID(),
    body('supplier_id').optional({ nullable: true }).isUUID(),
    body('vendor_name').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('next_due_date').optional({ nullable: true }).isISO8601(),
    body('set_under_maintenance').optional().isBoolean(),
  ],
  validate,
  ctrl.createMaintenance
);

// ═══════════════════════════════════════════════════════════════════════════
// 4) التخلص والبيع (Disposals) — static
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/disposals',
  authorize('asset_disposals.view'),
  [
    query('asset_id').optional().isUUID(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  validate,
  ctrl.listDisposals
);

router.post(
  '/disposals',
  authorize('asset_disposals.create'),
  [
    body('asset_id').isUUID(),
    body('disposal_date').optional().isISO8601(),
    body('disposal_type').optional().isIn(['sale', 'scrap', 'write_off', 'donation']),
    body('proceeds_amount').optional().isFloat({ min: 0 }),
    body('proceeds_account_id').optional({ nullable: true }).isUUID(),
    body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('auto_post').optional().isBoolean(),
  ],
  validate,
  ctrl.disposeAsset
);

// ═══════════════════════════════════════════════════════════════════════════
// 5) الأصول الثابتة — القائمة والإنشاء
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/',
  authorize('fixed_assets.view'),
  [
    query('category_id').optional().isUUID(),
    query('branch_id').optional().isUUID(),
    query('department_id').optional().isUUID(),
    query('status').optional().isIn([
      'active', 'under_maintenance', 'disposed', 'sold', 'written_off',
      'fully_depreciated', 'inactive',
    ]),
    query('search').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.listAssets
);

router.post(
  '/',
  authorize('fixed_assets.create'),
  [
    body('name').isString().trim().notEmpty().isLength({ max: 200 }),
    body('name_en').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body('category_id').isUUID(),
    body('branch_id').optional({ nullable: true }).isUUID(),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('custodian_employee_id').optional({ nullable: true }).isUUID(),
    body('supplier_id').optional({ nullable: true }).isUUID(),
    body('serial_number').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('purchase_date').optional().isISO8601(),
    body('depreciation_start_date').optional({ nullable: true }).isISO8601(),
    body('purchase_cost').isFloat({ gt: 0 }),
    body('salvage_value').optional().isFloat({ min: 0 }),
    body('useful_life_years').optional().isFloat({ gt: 0 }),
    body('depreciation_method').optional().isIn(['straight_line', 'declining_balance']),
    body('auto_journal').optional().isBoolean(),
    body('payment_account_id').optional({ nullable: true }).isUUID(),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  ],
  validate,
  ctrl.createAsset
);

// ═══════════════════════════════════════════════════════════════════════════
// 6) ⚠️ مسارات /:id — دائماً في النهاية
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/:id',
  authorize('fixed_assets.view'),
  [param('id').isUUID()],
  validate,
  ctrl.getAssetById
);

router.patch(
  '/:id',
  authorize('fixed_assets.update'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 200 }),
    body('name_en').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body('branch_id').optional({ nullable: true }).isUUID(),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('custodian_employee_id').optional({ nullable: true }).isUUID(),
    body('serial_number').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('status').optional().isIn([
      'active', 'under_maintenance', 'disposed', 'sold', 'written_off',
      'fully_depreciated', 'inactive',
    ]),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  ],
  validate,
  ctrl.updateAsset
);

router.delete(
  '/:id',
  authorize('fixed_assets.delete'),
  [param('id').isUUID()],
  validate,
  ctrl.deleteAsset
);

router.post(
  '/:id/transfer',
  authorize('fixed_assets.transfer'),
  [
    param('id').isUUID(),
    body('branch_id').optional({ nullable: true }).isUUID(),
    body('department_id').optional({ nullable: true }).isUUID(),
    body('custodian_employee_id').optional({ nullable: true }).isUUID(),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validate,
  ctrl.transferCustody
);

router.post(
  '/:id/maintenances',
  authorize('asset_maintenance.create'),
  [
    param('id').isUUID(),
    body('maintenance_date').optional().isISO8601(),
    body('maintenance_type').optional().isIn(['routine', 'repair', 'upgrade', 'inspection', 'overhaul']),
    body('cost').optional().isFloat({ min: 0 }),
    body('is_capitalized').optional().isBoolean(),
    body('capitalize').optional().isBoolean(),
    body('payment_account_id').optional({ nullable: true }).isUUID(),
    body('expense_account_id').optional({ nullable: true }).isUUID(),
    body('supplier_id').optional({ nullable: true }).isUUID(),
    body('vendor_name').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('next_due_date').optional({ nullable: true }).isISO8601(),
    body('set_under_maintenance').optional().isBoolean(),
  ],
  validate,
  ctrl.createMaintenance
);

router.post(
  '/:id/dispose',
  authorize('asset_disposals.create'),
  [
    param('id').isUUID(),
    body('disposal_date').optional().isISO8601(),
    body('disposal_type').optional().isIn(['sale', 'scrap', 'write_off', 'donation']),
    body('proceeds_amount').optional().isFloat({ min: 0 }),
    body('proceeds_account_id').optional({ nullable: true }).isUUID(),
    body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('auto_post').optional().isBoolean(),
  ],
  validate,
  ctrl.disposeAsset
);

module.exports = router;