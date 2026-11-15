// controllers/B2BController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { pool } = require('../config/pool');
const Product = require('../models/Product');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/b2b/companies
// ═══════════════════════════════════════════════════════════════════════════
const listCompanies = asyncHandler(async (req, res) => {
  const userCompanyId = req.user.company_id;
  const { search, type, page = 1, limit = 20 } = req.query;

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const params = [userCompanyId];
  const conds = ['c.id <> $1', 'c.is_active = TRUE'];

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const p = params.length;
    conds.push(`(
      c.name ILIKE $${p}
      OR c.name_en ILIKE $${p}
      OR c.tax_number ILIKE $${p}
      OR c.city ILIKE $${p}
    )`);
  }

  // نوع النشاط — نستخدم tax_number/city كفلتر بسيط (لأن companies لا تحتوي business_type)
  // يمكن توسيعها لاحقاً بحقل مخصص.

  params.push(safeLimit, offset);

  const rows = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.name_en,
       c.email,
       c.phone,
       c.address,
       c.city,
       c.country,
       c.tax_number,
       c.website,
       c.logo_url,
       c.is_active,
       c.created_at,

       -- حالة الاتصال
       cc.id AS connection_id,
       cc.status AS connection_status,
       CASE
         WHEN cc.requester_company_id = $1 THEN 'sent'
         WHEN cc.receiver_company_id = $1 THEN 'received'
         ELSE NULL
       END AS connection_direction

     FROM companies c
     LEFT JOIN company_connections cc
       ON (
         (cc.requester_company_id = $1 AND cc.receiver_company_id = c.id)
         OR (cc.receiver_company_id = $1 AND cc.requester_company_id = c.id)
       )
     WHERE ${conds.join(' AND ')}
     ORDER BY c.name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM companies c WHERE ${conds.join(' AND ')}`,
    params.slice(0, -2)
  );

  const total = countRes.rows[0].total;

  const items = rows.rows.map((row) => ({
    ...row,
    business_type: 'distributor',   // افتراضي — يمكن توسيعه لاحقاً
    business_type_label: 'شركة مسجلة',
    connection_status: row.connection_status || 'none',
    verified: true,
    is_from_database: true,
  }));

  // فلترة بـ type (إذا أراد العميل)
  const filtered = type && type !== 'all'
    ? items.filter((i) => i.business_type === type)
    : items;

  res.json({
    success: true,
    items: filtered,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/b2b/companies/register
// ═══════════════════════════════════════════════════════════════════════════
const registerCompany = asyncHandler(async (req, res) => {
  const userCompanyId = req.user.company_id;
  const {
    name,
    business_type,
    phone,
    email,
    tax_number,
    city,
    address,
  } = req.body;

  if (!name || !String(name).trim()) {
    throw new ApiError(400, 'name is required');
  }
  if (!phone || !String(phone).trim()) {
    throw new ApiError(400, 'phone is required');
  }
  if (!business_type) {
    throw new ApiError(400, 'business_type is required');
  }

  const validTypes = ['warehouse', 'distributor', 'manufacturer', 'pharmacy'];
  if (!validTypes.includes(business_type)) {
    throw new ApiError(400, `business_type must be one of: ${validTypes.join(', ')}`);
  }

  // التحقق من عدم وجود شركة بنفس الاسم
  const existing = await pool.query(
    `SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1`,
    [String(name).trim()]
  );
  if (existing.rowCount > 0) {
    throw new ApiError(409, 'A company with this name already exists');
  }

  // إنشاء شركة جديدة (بدون currency — سيتم تعيينها لاحقاً)
  // ⚠️ companies.currency_id إلزامي في الـ schema
  // الحل: استخدام عملة الشركة المُسجِّلة (userCompanyId)
  const userCompany = await pool.query(
    `SELECT currency_id FROM companies WHERE id = $1`,
    [userCompanyId]
  );
  if (!userCompany.rowCount) {
    throw new ApiError(404, 'Your company not found');
  }
  const currencyId = userCompany.rows[0].currency_id;

  const inserted = await pool.query(
    `INSERT INTO companies
       (name, currency_id, email, phone, address, city, tax_number, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
     RETURNING id, name, name_en, email, phone, address, city, country,
               tax_number, website, logo_url, is_active, created_at`,
    [
      String(name).trim(),
      currencyId,
      email ? String(email).trim() : null,
      String(phone).trim(),
      address ? String(address).trim() : null,
      city ? String(city).trim() : null,
      tax_number ? String(tax_number).trim() : null,
    ]
  );

  const company = inserted.rows[0];

  res.status(201).json({
    success: true,
    data: {
      ...company,
      business_type,
      business_type_label: `${business_type} — جديد`,
      connection_status: 'none',
      verified: false,
      is_from_database: true,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/b2b/companies/:id/products/stock
// ═══════════════════════════════════════════════════════════════════════════
const getCompanyStock = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userCompanyId = req.user.company_id;

  if (id === userCompanyId) {
    throw new ApiError(400, 'Cannot view your own company stock via B2B endpoint');
  }

  // 1) التحقق من وجود اتصال مقبول
  const conn = await pool.query(
    `SELECT id, status
     FROM company_connections
     WHERE (
       (requester_company_id = $1 AND receiver_company_id = $2)
       OR (requester_company_id = $2 AND receiver_company_id = $1)
     )
       AND status = 'accepted'
     LIMIT 1`,
    [userCompanyId, id]
  );

  if (!conn.rowCount) {
    throw new ApiError(
      403,
      'No active B2B connection with this company — request connection first'
    );
  }

  // 2) التحقق من وجود الشركة
  const company = await pool.query(
    `SELECT id, name FROM companies WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  if (!company.rowCount) {
    throw new ApiError(404, 'Company not found or inactive');
  }

  // 3) جلب مخزون الشركة (منتجات + batches + units)
  const products = await Product.getAllStock(id);

  res.json({
    success: true,
    supplier_company: {
      id: company.rows[0].id,
      name: company.rows[0].name,
    },
    data: products,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/b2b/companies/:id
// ═══════════════════════════════════════════════════════════════════════════
const getCompany = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userCompanyId = req.user.company_id;

  if (id === userCompanyId) {
    throw new ApiError(400, 'Cannot view your own company via B2B endpoint');
  }

  const company = await pool.query(
    `SELECT
       c.id, c.name, c.name_en, c.email, c.phone, c.address,
       c.city, c.country, c.tax_number, c.website, c.logo_url,
       c.is_active, c.created_at,
       cc.id AS connection_id,
       cc.status AS connection_status,
       CASE
         WHEN cc.requester_company_id = $1 THEN 'sent'
         WHEN cc.receiver_company_id = $1 THEN 'received'
         ELSE NULL
       END AS connection_direction
     FROM companies c
     LEFT JOIN company_connections cc
       ON (
         (cc.requester_company_id = $1 AND cc.receiver_company_id = c.id)
         OR (cc.receiver_company_id = $1 AND cc.requester_company_id = c.id)
       )
     WHERE c.id = $2 AND c.is_active = TRUE`,
    [userCompanyId, id]
  );

  if (!company.rowCount) {
    throw new ApiError(404, 'Company not found');
  }

  res.json({
    success: true,
    data: {
      ...company.rows[0],
      connection_status: company.rows[0].connection_status || 'none',
      is_from_database: true,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  listCompanies,
  registerCompany,
  getCompanyStock,
  getCompany,
};