const router = require('express').Router();
const ctrl = require('../controllers/CompanyController');
const { authenticate, requireCompany, authorize } = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validateMiddleware');
const { body } = require('express-validator');
const { uploadLogo } = require('../config/multer');

router.use(authenticate, requireCompany);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/current
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/current:
 *   get:
 *     summary: جلب بيانات الشركة الحالية
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: بيانات الشركة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     name_en: { type: string, nullable: true }
 *                     currency_id: { type: string, format: uuid }
 *                     currency_code: { type: string }
 *                     currency_symbol: { type: string }
 *                     tax_number: { type: string, nullable: true }
 *                     address: { type: string, nullable: true }
 *                     logo_url: { type: string, nullable: true }
 *                     use_shared_logo: { type: boolean }
 *                     phone: { type: string, nullable: true }
 *                     email: { type: string, nullable: true }
 *                     website: { type: string, nullable: true }
 *                     country: { type: string, nullable: true }
 *                     city: { type: string, nullable: true }
 *                     default_markup_percentage: { type: number }
 *                     is_active: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/current', authorize('companies.view'), ctrl.getCurrent);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/vendors
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/vendors:
 *   get:
 *     summary: قائمة موحدة للشركات والموردين المحليين
 *     description: تُستخدم في شاشات الشراء والطلب لاختيار الطرف.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: قائمة موحدة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       vendor_id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       phone: { type: string, nullable: true }
 *                       address: { type: string, nullable: true }
 *                       vendor_type:
 *                         type: string
 *                         enum: [registered, local]
 */
router.get('/vendors', authorize('companies.view'), ctrl.getAllVendorsAndSuppliers);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/list
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/list:
 *   get:
 *     summary: قائمة الشركات فقط مع تفاصيل العملة
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: قائمة الشركات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       currency_id: { type: string, format: uuid }
 *                       code: { type: string }
 *                       symbol: { type: string }
 *                       default_markup_percentage: { type: number }
 */
router.get('/list', authorize('companies.view'), ctrl.getCompaniesOnly);

/* ═══════════════════════════════════════════════════════════════
 * PUT /companies/logo
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/logo:
 *   put:
 *     summary: رفع شعار الشركة
 *     description: يرفع الشعار إلى Cloudinary ويحدّث `logo_url` و `use_shared_logo=false`.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [logo]
 *             properties:
 *               logo:
 *                 type: string
 *                 format: binary
 *                 description: صورة (PNG, JPG, SVG, WebP) — حد أقصى 2MB
 *     responses:
 *       200:
 *         description: تم رفع الشعار
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     logo_url: { type: string }
 *                     use_shared_logo: { type: boolean }
 *       400:
 *         description: ملف مفقود أو غير صالح
 *       404:
 *         description: الشركة غير موجودة
 */
router.put(
  '/logo',
  authorize('companies.update'),
  uploadLogo.single('logo'),
  ctrl.uploadLogo
);

/* ═══════════════════════════════════════════════════════════════
 * PATCH /companies/current
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/current:
 *   patch:
 *     summary: تعديل بيانات الشركة
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 200 }
 *               name_en: { type: string, maxLength: 200 }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               website: { type: string }
 *               country: { type: string }
 *               city: { type: string }
 *               tax_number: { type: string, maxLength: 50 }
 *               address: { type: string }
 *               use_shared_logo: { type: boolean }
 *               default_markup_percentage: { type: number, minimum: 0, maximum: 1000 }
 *     responses:
 *       200:
 *         description: تم الحفظ
 *       400:
 *         description: لا توجد حقول للتحديث
 */
router.patch(
  '/current',
  authorize('companies.update'),
  [
    body('name').optional().trim().notEmpty(),
    body('name_en').optional().trim().isLength({ max: 200 }),
    body('email').optional({ nullable: true }).isEmail(),
    body('phone').optional({ nullable: true }).trim(),
    body('website').optional({ nullable: true }).trim(),
    body('country').optional({ nullable: true }).trim(),
    body('city').optional({ nullable: true }).trim(),
    body('tax_number').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('address').optional({ nullable: true }).trim(),
    body('use_shared_logo').optional().isBoolean(),
    body('default_markup_percentage').optional().isFloat({ min: 0, max: 1000 }),
  ],
  validate,
  ctrl.updateCurrent
);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/settings
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/settings:
 *   get:
 *     summary: جلب كل إعدادات الشركة (مسطّحة)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: الإعدادات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   additionalProperties: true
 *                   example:
 *                     timezone: "Asia/Aden"
 *                     date_format: "YYYY-MM-DD"
 *                     invoice_prefix: "INV-"
 *                     numbering_padding: 4
 *                     inventory_method: "fifo"
 */
router.get('/settings', authorize('settings.view'), ctrl.getSettings);

/* ═══════════════════════════════════════════════════════════════
 * PUT /companies/settings
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/settings:
 *   put:
 *     summary: تحديث إعدادات الشركة (جزئي)
 *     description: |
 *       يقبل كائن `{key: value}`. يتم التحقق من كل مفتاح عبر `SETTINGS_SCHEMA`.
 *       المفاتيح المجهولة → 400.
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *             example:
 *               invoice_due_days: 45
 *               invoice_show_logo: false
 *               numbering_padding: 5
 *     responses:
 *       200:
 *         description: تم التحديث
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     updated:
 *                       type: array
 *                       items: { type: string }
 *       400:
 *         description: قيمة غير صالحة أو مفتاح مجهول
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 message: { type: string }
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key: { type: string }
 *                       error: { type: string }
 */
router.put('/settings', authorize('settings.update'), ctrl.updateSettings);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/settings/grouped
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/settings/grouped:
 *   get:
 *     summary: جلب الإعدادات مجمّعة حسب القسم
 *     description: |
 *       يعيد `{ invoicing: {...}, inventory: {...}, numbering: {...}, ... }`
 *       لاستخدامها في واجهة Sub-Nav.
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: الإعدادات مجمّعة
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     additionalProperties: true
 */
router.get('/settings/grouped', authorize('settings.view'), ctrl.getSettingsGrouped);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/payment-accounts
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/payment-accounts:
 *   get:
 *     summary: جلب الحسابات النقدية والبنكية المتاحة
 *     description: |
 *       يعيد الحسابات النقدية (1111*) والبنكية (1112*) النشطة
 *       لاستخدامها في تعيين `payment_cash_account_id` و `payment_bank_account_id`.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: قوائم الحسابات
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     cash_accounts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:   { type: string, format: uuid }
 *                           code: { type: string }
 *                           name: { type: string }
 *                     bank_accounts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:   { type: string, format: uuid }
 *                           code: { type: string }
 *                           name: { type: string }
 */
router.get('/payment-accounts', authorize('settings.view'), ctrl.getPaymentAccounts);

/* ═══════════════════════════════════════════════════════════════
 * POST /companies/change-currency
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/change-currency:
 *   post:
 *     summary: تغيير العملة الأساسية للشركة (تنفيذ فعلي)
 *     description: |
 *       **الشروط:**
 *       - المستخدم Owner فقط.
 *       - لا يوجد أي مستند مالي (فواتير، قيود، مدفوعات، أوامر...).
 *       - العملة الجديدة مختلفة عن الحالية.
 *
 *       استخدم `GET /companies/currency-change-check` للتحقق أولاً.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currency_id]
 *             properties:
 *               currency_id:
 *                 type: string
 *                 format: uuid
 *                 example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: تم تغيير العملة بنجاح
 *       400:
 *         description: مستندات تمنع التغيير / نفس العملة / غير موجودة
 *       403:
 *         description: ليس Owner
 */
router.post(
  '/change-currency',
  authorize('companies.update'),
  [body('currency_id').isUUID()],
  validate,
  ctrl.changeCurrency
);

/* ═══════════════════════════════════════════════════════════════
 * POST /companies/external-users
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/external-users:
 *   post:
 *     summary: إنشاء مستخدم خارجي (عميل أو مورد)
 *     description: |
 *       ينشئ مستخدم `user_type = 'external'` ويربطه بـ `customers` أو `suppliers`.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_type, name, email, password]
 *             properties:
 *               user_type:
 *                 type: string
 *                 enum: [customer, supplier]
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               phone: { type: string }
 *               address: { type: string }
 *               tax_number: { type: string }
 *               credit_limit: { type: number, minimum: 0 }
 *     responses:
 *       201:
 *         description: تم إنشاء الحساب
 *       409:
 *         description: البريد مستخدم
 */
router.post(
  '/external-users',
  authorize('users.create'),
  [
    body('user_type').isIn(['customer', 'supplier']),
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('phone').optional({ nullable: true }).trim(),
    body('credit_limit').optional().isFloat({ min: 0 }),
  ],
  validate,
  ctrl.createExternalUser
);

/* ═══════════════════════════════════════════════════════════════
 * GET /companies/currency-change-check
 * ═══════════════════════════════════════════════════════════════ */
/**
 * @swagger
 * /companies/currency-change-check:
 *   get:
 *     summary: فحص أهلية تغيير العملة الأساسية
 *     description: |
 *       يعيد نتيجة فحص شامل لكل الجداول المالية المرتبطة بالشركة.
 *       **لا يُنفّذ التغيير** — فحص فقط.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: نتيجة الفحص
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     can_change: { type: boolean, example: false }
 *                     current_currency:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         id:     { type: string, format: uuid }
 *                         code:   { type: string, example: 'YER' }
 *                         symbol: { type: string, example: '﷼' }
 *                         name:   { type: string, example: 'ريال يمني' }
 *                     reasons:
 *                       type: object
 *                       properties:
 *                         posted_entries:      { type: integer, example: 5 }
 *                         invoices:            { type: integer, example: 12 }
 *                         expenses:            { type: integer, example: 3 }
 *                         payments:            { type: integer, example: 7 }
 *                         returns:             { type: integer, example: 0 }
 *                         sales_orders:        { type: integer, example: 2 }
 *                         purchase_orders:     { type: integer, example: 1 }
 *                         active_reservations: { type: integer, example: 0 }
 *                         price_history:       { type: integer, example: 4 }
 *                     blockers:
 *                       type: array
 *                       items:
 *                         type: string
 *                         enum:
 *                           - posted_entries
 *                           - invoices
 *                           - expenses
 *                           - payments
 *                           - returns
 *                           - sales_orders
 *                           - purchase_orders
 *                           - active_reservations
 *                     message: { type: string }
 *                     checked_at: { type: string, format: date-time }
 *       403:
 *         description: ليس Owner
 */
router.get(
  '/currency-change-check',
  authorize('companies.update'),
  ctrl.checkCurrencyChange
);

module.exports = router;