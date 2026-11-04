const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Company = require('../models/Company');
const Currency = require('../models/Currency');
const {pool} = require('../config/pool');
const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

// جلب جميع الشركات والموردين معاً (القائمة المختلطة لشاشة الشراء)
const getAllVendorsAndSuppliers = asyncHandler(async (req, res) => {
  const vendors = await Company.findAllVendors();
  res.json({ 
    success: true, 
    count: vendors.length, 
    data: vendors 
  });
});

// جلب الشركات فقط مع تفاصيل العملة
const getCompaniesOnly = asyncHandler(async (req, res) => {
  const companies = await Company.findAllCompanies();
  res.json({ 
    success: true, 
    count: companies.length, 
    data: companies 
  });
});
const getCurrent = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.user.company_id);
  if (!company) throw new ApiError(404, 'Company not found');
  res.json({ success: true, data: company });
});

const updateCurrent = asyncHandler(async (req, res) => {
  const payload = {
    name: req.body.name,
    name_en: req.body.name_en,
    logo_url: req.body.logo_url,
    use_shared_logo: req.body.use_shared_logo,
    phone: req.body.phone,
    email: req.body.email,
    address: req.body.address,
    tax_number: req.body.tax_number,
    website: req.body.website,
    country: req.body.country,
    city: req.body.city,
  };

  const updated = await Company.update(req.user.company_id, payload);
  if (!updated) throw new ApiError(400, 'No valid fields to update');
  res.json({ success: true, data: updated });
});

const getSettings = asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT key, value FROM settings WHERE company_id = $1 ORDER BY key`,
    [req.user.company_id]
  );
  const settings = {};
  for (const row of r.rows) settings[row.key] = row.value;
  res.json({ success: true, data: settings });
});

const updateSettings = asyncHandler(async (req, res) => {
   const company_id = req.user.company_id;           // trust the JWT, not the URL
if (!company_id  ) {
   throw new ApiError(403, 'معرف الشركة ضروري');
}
  const entries = Object.entries(req.body || {});
  if (!entries.length) throw new ApiError(400, 'No settings provided');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO settings (company_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, key)
         DO UPDATE SET value = EXCLUDED.value`,
        [company_id, key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * تغيير العملة الأساسية للشركة
 * مسموح فقط للـ Owner، وفقط إذا لا توجد قيود/فواتير/أوامر
 */
const changeCurrency = asyncHandler(async (req, res) => {
  // فحص أن المستخدم Owner
  if (!(req.user.roles || []).includes('Owner')) {
    throw new ApiError(403, 'Only the company owner can change the base currency');
  }

  const { currency_id } = req.body;

  const currency = await Currency.findById(currency_id);
  if (!currency) throw new ApiError(400, 'Currency not found');

  const check = await Company.canChangeCurrency(req.user.company_id);
  if (!check.can_change) {
    throw new ApiError(400,
      `Cannot change currency: ${check.reasons.posted_entries} posted entries, ` +
      `${check.reasons.invoices} invoices, ${check.reasons.orders} orders exist`
    );
  }

  const updated = await Company.changeCurrency(req.user.company_id, currency_id);
  res.json({ success: true, data: updated });
});

/**
 * POST /companies/external-users
 * ينشئ مستخدم خارجي (عميل أو مورد) ويربطه
 * Body:
 *   { user_type: 'customer'|'supplier', name, email, password,
 *     phone?, address?, tax_number?, credit_limit? }
 */
const createExternalUser = asyncHandler(async (req, res) => {
  const {
    user_type, name, email, password,
    phone, address, tax_number, credit_limit,
  } = req.body;

  if (!['customer', 'supplier'].includes(user_type)) {
    throw new ApiError(400, 'user_type must be customer or supplier');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) تحقق من تكرار الإيميل
    const dup = await client.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (dup.rowCount) throw new ApiError(409, 'Email already registered');

    // 2) إنشاء user
    const passwordUtil = require('../utils/password');
    const hash = await passwordUtil.hash(password);

    const userRes = await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, user_type, is_active)
       VALUES ($1, $2, $3, $4, 'external', TRUE)
       RETURNING id, name, email, user_type`,
      [req.user.company_id, name, email, hash]
    );
    const user = userRes.rows[0];

    // 3) إنشاء customer أو supplier
    let entity;
    if (user_type === 'customer') {
      const r = await client.query(
        `INSERT INTO customers
           (company_id, user_id, name, phone, email, address, tax_number, credit_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, email, is_active`,
        [req.user.company_id, user.id, name, phone || null, email,
         address || null, tax_number || null, credit_limit || 0]
      );
      entity = { customer: r.rows[0] };
    } else {
      const r = await client.query(
        `INSERT INTO suppliers
           (company_id, user_id, name, phone, email, address, tax_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, is_active`,
        [req.user.company_id, user.id, name, phone || null, email,
         address || null, tax_number || null]
      );
      entity = { supplier: r.rows[0] };
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { user, ...entity } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
const update = asyncHandler(async (req, res) => {
  const id = req.user.company_id;           // trust the JWT, not the URL
if (id !== req.user.company_id && !req.user.is_super_admin) {
  return next(new ForbiddenError('غير مصرح'));
}
  const payload = {
    name: req.body.name,
    name_en: req.body.name_en,
    logo_url: req.body.logo_url,
    use_shared_logo: req.body.use_shared_logo,
    phone: req.body.phone,
    email: req.body.email,
    address: req.body.address,
    tax_number: req.body.tax_number
  };

  const result = await Company.update(req.user.company_id, payload);

  res.json({ success: true, data: result.rows[0] });
});


const uploadLogo = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id; // ✅ من JWT — يمنع IDOR

  if (!req.file) {
    throw new ApiError(400, 'لم يتم رفع أي ملف');
  }

  const company = await Company.findById(companyId);
  if (!company) {
    throw new ApiError(404, `الشركة بالمعرف ${companyId} غير موجودة.`);
  }

  // رفع إلى Cloudinary مع await
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'company-logos', resource_type: 'image' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
  });

  // حفظ في DB مع rollback عند الفشل
  let branding;
  try {
    branding = await Company.upsertBranding(companyId, {
      logo_url: result.secure_url,
      use_shared_logo: false,
    });
  } catch (dbErr) {
    await cloudinary.uploader.destroy(result.public_id).catch(() => {});
    throw new ApiError(500, 'فشل حفظ الشعار.');
  }

  res.json({
    success: true,
    message: 'تم رفع الشعار بنجاح.',
    data: branding,
  });
});

module.exports = {
getAllVendorsAndSuppliers,
getCompaniesOnly,
  getCurrent,
  updateCurrent,
  getSettings,
  updateSettings,
  changeCurrency,
  createExternalUser,
  uploadLogo,
  update,
};