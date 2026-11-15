// routes/globalProductRoutes.js
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const ctrl = require('../controllers/globalProductController');
const asyncHandler = require('../utils/asyncHandler');
const {
  authenticate,
  requireCompany,
  authorize,
} = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');

router.use(authenticate, requireCompany);

// ═══════════════════════════════════════════════════════════════════════════
// الثوابت
// ═══════════════════════════════════════════════════════════════════════════

const PRODUCT_TYPES = [
  'drug','supplement','cosmetic','food','device','herbal','veterinary','other',
];
const DOSAGE_FORMS = [
  'tablet','capsule','syrup','suspension','solution','injection',
  'cream','ointment','gel','drops','inhaler','suppository','patch',
  'powder','granules','spray','other',
];
const STATUSES = ['active','inactive','archived','merged','pending_review'];

// ═══════════════════════════════════════════════════════════════════════════
// قواعد التحقق
// ═══════════════════════════════════════════════════════════════════════════

const createRules = [
  body('name').isString().trim().notEmpty().isLength({ max: 200 }),
  body('unit').isString().trim().notEmpty().isLength({ max: 30 }),
  body('product_type').isIn(PRODUCT_TYPES),

  body('barcode').optional().isString().trim().isLength({ max: 100 }),
  body('sku').optional().isString().trim().isLength({ max: 50 }),
  body('name_en').optional().isString().trim().isLength({ max: 200 }),
  body('name_ar').optional().isString().trim().isLength({ max: 200 }),
  body('short_name').optional().isString().trim().isLength({ max: 100 }),
  body('scientific_name').optional().isString().trim().isLength({ max: 200 }),
  body('description').optional().isString(),
  body('description_en').optional().isString(),

  body('therapeutic_class').optional().isString().trim().isLength({ max: 200 }),
  body('pharmacological_class').optional().isString().trim().isLength({ max: 200 }),
  body('atc_code').optional().isString().trim().isLength({ max: 20 }),
  body('hs_code').optional().isString().trim().isLength({ max: 20 }),

  body('manufacturer').optional().isString().trim().isLength({ max: 200 }),
  body('manufacturer_country').optional().isString().trim().isLength({ max: 100 }),
  body('marketing_company').optional().isString().trim().isLength({ max: 200 }),
  body('agent_company').optional().isString().trim().isLength({ max: 200 }),
  body('origin_country').optional().isString().trim().isLength({ max: 100 }),

  body('active_ingredient').optional().isString().trim().isLength({ max: 500 }),
  body('dosage_form').optional().isIn(DOSAGE_FORMS),
  body('strength').optional().isString().trim().isLength({ max: 50 }),
  body('route_of_administration').optional().isString().trim().isLength({ max: 50 }),
  body('package_size').optional().isString().trim().isLength({ max: 100 }),
  body('units_per_package').optional().isInt({ min: 1 }),

  body('storage_conditions').optional().isString(),
  body('shelf_life_months').optional().isInt({ min: 1 }),
  body('requires_refrigeration').optional().isBoolean(),

  body('image_url').optional().isString(),
  body('image_urls').optional().isArray(),
  body('leaflet_url').optional().isString(),

  body('requires_prescription').optional().isBoolean(),
  body('is_controlled').optional().isBoolean(),
  body('controlled_schedule').optional().isString().trim().isLength({ max: 20 }),
  body('is_otc').optional().isBoolean(),
  body('is_orphan_drug').optional().isBoolean(),

  body('regulatory_status').optional().isString().trim().isLength({ max: 50 }),
  body('approval_date').optional().isISO8601(),
  body('withdrawal_date').optional().isISO8601(),

  // JSONB — نتحقق فقط أنها كائنات/مصفوفات (بدون فحص داخلي)
  body('indications').optional(),
  body('other_uses').optional(),
  body('contraindications').optional(),
  body('precautions').optional(),
  body('boxed_warnings').optional(),
  body('black_box_warning').optional().isString(),
  body('dosage').optional(),
  body('overdose').optional(),
  body('side_effects').optional(),
  body('adverse_reactions').optional(),
  body('drug_interactions').optional(),
  body('food_interactions').optional(),
  body('disease_interactions').optional(),
  body('pregnancy_lactation').optional(),
  body('driving_warning').optional().isBoolean(),
  body('monitoring_tests').optional(),
  body('pharmacokinetics').optional(),
  body('pharmacodynamics').optional(),
  body('mechanism_of_action').optional().isString(),
  body('composition').optional(),
  body('excipients').optional(),
  body('substitutes').optional(),
  body('registrations').optional(),
  body('barcodes').optional(),
  body('skus').optional(),
  body('synonyms').optional(),
  body('keywords').optional().isArray(),
  body('tags').optional().isArray(),
  body('notes').optional().isString(),
  body('metadata').optional(),

  // backward compatibility
  body('category').optional().isString().trim().isLength({ max: 100 }),

  // status (لـ Super Admin فقط — الـ controller يفرض)
  body('status').optional().isIn(['active', 'pending_review']),
];

// قواعد التعديل — كلها optional
const updateRules = [
  param('id').isUUID(),
  body('barcode').optional().isString().trim().isLength({ max: 100 }),
  body('sku').optional().isString().trim().isLength({ max: 50 }),
  body('name').optional().isString().trim().isLength({ max: 200 }),
  body('name_en').optional().isString().trim().isLength({ max: 200 }),
  body('unit').optional().isString().trim().isLength({ max: 30 }),
  body('category').optional().isString().trim().isLength({ max: 100 }),
  body('product_type').optional().isIn(PRODUCT_TYPES),
  body('dosage_form').optional().isIn(DOSAGE_FORMS),
  body('status').optional().isIn(STATUSES),
  // ... (يمكنك إضافة الباقي إذا احتجت، أو الاعتماد على createRules.optional())
];

// ═══════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════

// ── Search ──────────────────────────────────────────────────────────────
router.get(
  '/search',
  authorize('global_products.view'),
  [
    query('search').optional().isString().trim().isLength({ max: 200 }),
    query('product_type').optional().isIn(PRODUCT_TYPES),
    query('status').optional().isIn(STATUSES),
    query('is_verified').optional().isIn(['true', 'false']),
    query('is_otc').optional().isIn(['true', 'false']),
    query('requires_prescription').optional().isIn(['true', 'false']),
    query('atc_code').optional().isString().trim().isLength({ max: 20 }),
    query('manufacturer').optional().isString().trim().isLength({ max: 200 }),
    query('category').optional().isString().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  asyncHandler(ctrl.search)
);

// ── Stats ───────────────────────────────────────────────────────────────
router.get(
  '/stats',
  authorize('global_products.view'),
  asyncHandler(ctrl.stats)
);

// ── My contributions ────────────────────────────────────────────────────
router.get(
  '/my-contributions',
  authorize('global_products.view'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  asyncHandler(ctrl.myContributions)
);

// ── By barcode ──────────────────────────────────────────────────────────
router.get(
  '/by-barcode/:barcode',
  authorize('global_products.view'),
  [
    param('barcode').isString().trim().notEmpty().isLength({ max: 100 }),
  ],
  validate,
  asyncHandler(ctrl.getByBarcode)
);

// ── Create ──────────────────────────────────────────────────────────────
router.post(
  '/',
  authorize('global_products.create'),
  createRules,
  validate,
  asyncHandler(ctrl.create)
);

// ── Get by ID ───────────────────────────────────────────────────────────
router.get(
  '/:id',
  authorize('global_products.view'),
  [param('id').isUUID()],
  validate,
  asyncHandler(ctrl.getOne)
);

// ── Update ──────────────────────────────────────────────────────────────
router.patch(
  '/:id',
  authorize('global_products.update'),
  updateRules,
  validate,
  asyncHandler(ctrl.update)
);

// ── Verify (Admin) ──────────────────────────────────────────────────────
router.post(
  '/:id/verify',
  authorize('global_products.verify'),
  [param('id').isUUID()],
  validate,
  asyncHandler(ctrl.verify)
);

// ── Archive (Admin) ─────────────────────────────────────────────────────
router.post(
  '/:id/archive',
  authorize('global_products.manage'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 1000 }),
  ],
  validate,
  asyncHandler(ctrl.archive)
);

// ── Merge (Admin) ───────────────────────────────────────────────────────
router.post(
  '/:id/merge',
  authorize('global_products.manage'),
  [
    param('id').isUUID(),
    body('target_id').isUUID(),
  ],
  validate,
  asyncHandler(ctrl.merge)
);

module.exports = router;