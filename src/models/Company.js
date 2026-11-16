// models/Company.js
const { pool } = require('../config/pool');
function buildCurrencyChangeBlockMessage(reasons) {
  const labels = {
    posted_entries: 'قيود محاسبية مرحّلة',
    invoices: 'فواتير',
    expenses: 'مصروفات',
    payments: 'مدفوعات/مقبوضات',
    returns: 'مرتجعات',
    sales_orders: 'أوامر بيع',
    purchase_orders: 'أوامر شراء',
    active_reservations: 'حجوزات مخزون نشطة',
  };

  const parts = Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${labels[k] || k}`);

  return `لا يمكن تغيير العملة لوجود: ${parts.join('، ')}`;
}
class Company {
  /**
   * جلب الشركات + الموردين المحليين (قائمة موحدة للاختيار).
   */
  static async findAllVendors() {
    const r = await pool.query(
      `SELECT id AS vendor_id, name, phone, address, 'registered' AS vendor_type
       FROM companies
       WHERE is_active = TRUE
       UNION ALL
       SELECT id AS vendor_id, name, phone, address, 'local' AS vendor_type
       FROM suppliers
       WHERE is_active = TRUE
       ORDER BY name ASC`
    );
    return r.rows;
  }

  /**
   * جلب الشركات فقط مع تفاصيل العملة.
   */
  static async findAllCompanies() {
    const r = await pool.query(
      `SELECT c.id, c.name, c.currency_id, c.tax_number, c.address,
              c.logo_url, c.is_active, c.created_at, c.updated_at,
              c.email, c.phone, c.website, c.country, c.city,
              c.default_markup_percentage,
              cu.code, cu.symbol
       FROM companies c
       LEFT JOIN currencies cu ON cu.id = c.currency_id
       WHERE c.is_active = TRUE
       ORDER BY c.name ASC`
    );
    return r.rows;
  }

  static async findById(id) {
    const r = await pool.query(
      `SELECT c.id, c.name, c.name_en, c.currency_id, c.tax_number, c.address,
              c.logo_url, c.use_shared_logo, c.is_active, c.created_at, c.updated_at,
              c.email, c.phone, c.website, c.country, c.city,
              c.default_markup_percentage,
              cu.code AS currency_code, cu.symbol AS currency_symbol
       FROM companies c
       LEFT JOIN currencies cu ON cu.id = c.currency_id
       WHERE c.id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  static async create(client, {
    name, name_en, currency_id, tax_number, address, logo_url, email, phone,
    default_markup_percentage,
  }) {
    const r = await client.query(
      `INSERT INTO companies
         (name, name_en, currency_id, tax_number, address, logo_url, email, phone,
          default_markup_percentage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 20.00))
       RETURNING id, name, name_en, currency_id, default_markup_percentage, created_at`,
      [
        name,
        name_en,
        currency_id,
        tax_number || null,
        address || null,
        logo_url || null,
        email || null,
        phone || null,
        default_markup_percentage ?? null,
      ]
    );
    return r.rows[0];
  }

  static async update(id, payload) {
    const allowed = [
      'name_en', 'name', 'tax_number', 'address', 'logo_url',
      'email', 'phone', 'website', 'country', 'city', 'use_shared_logo',
      'default_markup_percentage',
    ];
    const fields = [];
    const params = [];

    for (const k of allowed) {
      if (payload[k] !== undefined) {
        params.push(payload[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }

    if (!fields.length) return null;

    params.push(id);
    const r = await pool.query(
      `UPDATE companies SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, name, name_en, tax_number, address, logo_url,
                 email, phone, website, country, city,
                 default_markup_percentage, updated_at`,
      params
    );
    return r.rows[0] || null;
  }


  /**
 * هل يمكن تغيير العملة الأساسية للشركة؟
 * نمنع التغيير إذا وُجد أي مستند/قيد/حركة مالية بعملة سابقة.
 *
 * @param {string} companyId
 * @returns {Promise<{
 *   can_change: boolean,
 *   reasons: Record<string, number>,
 *   details: { message: string }
 * }>}
 */
static async canChangeCurrency(companyId) {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM journal_entries
          WHERE company_id = $1 AND status = 'posted') AS posted_entries,

       (SELECT COUNT(*)::int FROM invoices
          WHERE company_id = $1) AS invoices,

       (SELECT COUNT(*)::int FROM expenses
          WHERE company_id = $1) AS expenses,

       (SELECT COUNT(*)::int FROM payments
          WHERE company_id = $1) AS payments,

       (SELECT COUNT(*)::int FROM returns
          WHERE company_id = $1 AND status <> 'draft') AS returns,

       (SELECT COUNT(*)::int FROM sales_orders
          WHERE company_id = $1 AND status <> 'draft') AS sales_orders,

       (SELECT COUNT(*)::int FROM purchase_orders
          WHERE company_id = $1 AND status <> 'draft') AS purchase_orders,

       (SELECT COUNT(*)::int FROM product_price_history
          WHERE company_id = $1) AS price_history,

       (SELECT COUNT(*)::int FROM stock_reservations
          WHERE company_id = $1 AND status = 'active') AS active_reservations`,
    [companyId]
  );

  const counts = r.rows[0];

  // الموانع الصارمة (أي واحدة > 0 تمنع التغيير)
  const blockers = [
    'posted_entries',
    'invoices',
    'expenses',
    'payments',
    'returns',
    'sales_orders',
    'purchase_orders',
    'active_reservations',
  ];

  const reasons = {};
  for (const k of blockers) reasons[k] = counts[k];

  // price_history: لا تمنع، لكنها مؤشر يجب على المستخدم معرفته
  // (إن أردت منعها أيضاً، أضفها لـ blockers)
  const canChange = blockers.every(k => counts[k] === 0);

  // بناء رسالة واضحة
  const message = canChange
    ? 'يمكن تغيير العملة بأمان'
    : buildCurrencyChangeBlockMessage(reasons);

  return {
    can_change: canChange,
    reasons,
    price_history: counts.price_history, // للإعلام فقط
    details: { message },
  };
}

  static async changeCurrency(id, newCurrencyId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const r = await client.query(
        `UPDATE companies SET currency_id = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, currency_id, updated_at`,
        [newCurrencyId, id]
      );

      // تحديث عملة الصناديق النقدية للشركة (بما أنه لا توجد حركات مالية مسبقة)
      await client.query(
        `UPDATE cash_registers SET currency_id = $1
         WHERE company_id = $2`,
        [newCurrencyId, id]
      );

      await client.query('COMMIT');
      return r.rows[0] || null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  static async upsertBranding(companyId, { logo_url, use_shared_logo }, client = pool) {
    const r = await client.query(
      `UPDATE companies
       SET logo_url = $2,
           use_shared_logo = COALESCE($3, use_shared_logo),
           updated_at = NOW()
       WHERE id = $1
       RETURNING logo_url, use_shared_logo, updated_at`,
      [companyId, logo_url, use_shared_logo ?? null]
    );
    if (!r.rowCount) throw new Error('Company not found');
    return r.rows[0];
  }
  
  /**
 * يفحص أهلية تغيير العملة ويعيد تفاصيل جاهزة للعرض.
 * @param {string} companyId
 * @returns {Promise<{
 *   can_change: boolean,
 *   current_currency: object|null,
 *   reasons: Record<string, number>,
 *   blockers: string[],
 *   message: string,
 *   checked_at: string
 * }>}
 */

static async getCurrencyChangeReadiness(companyId) {
  const r = await pool.query(
    `WITH checks AS (
       SELECT 'posted_entries' AS k, COUNT(*)::int AS n
         FROM journal_entries
         WHERE company_id = $1 AND status = 'posted'
       UNION ALL
       SELECT 'invoices', COUNT(*)::int
         FROM invoices WHERE company_id = $1
       UNION ALL
       SELECT 'expenses', COUNT(*)::int
         FROM expenses WHERE company_id = $1
       UNION ALL
       SELECT 'payments', COUNT(*)::int
         FROM payments WHERE company_id = $1
       UNION ALL
       SELECT 'returns', COUNT(*)::int
         FROM returns
         WHERE company_id = $1 AND status <> 'draft'
       UNION ALL
       SELECT 'sales_orders', COUNT(*)::int
         FROM sales_orders
         WHERE company_id = $1 AND status <> 'draft'
       UNION ALL
       SELECT 'purchase_orders', COUNT(*)::int
         FROM purchase_orders
         WHERE company_id = $1 AND status <> 'draft'
       UNION ALL
       SELECT 'active_reservations', COUNT(*)::int
         FROM stock_reservations
         WHERE company_id = $1 AND status = 'active'
       UNION ALL
       SELECT 'price_history', COUNT(*)::int
         FROM product_price_history WHERE company_id = $1
     )
     SELECT
       (SELECT jsonb_object_agg(k, n) FROM checks) AS counts,
       (SELECT jsonb_build_object(
          'id', c.id,
          'code', cu.code,
          'symbol', cu.symbol,
          'name', cu.name
        )
        FROM companies c
        LEFT JOIN currencies cu ON cu.id = c.currency_id
        WHERE c.id = $1) AS current_currency`,
    [companyId]
  );

  const counts = r.rows[0]?.counts || {};
  const current_currency = r.rows[0]?.current_currency || null;

  const blockerKeys = [
    'posted_entries', 'invoices', 'expenses', 'payments',
    'returns', 'sales_orders', 'purchase_orders', 'active_reservations',
  ];

  const blockers = blockerKeys.filter(k => (counts[k] || 0) > 0);
  const can_change = blockers.length === 0;

  const message = can_change
    ? 'يمكن تغيير العملة بأمان'
    : buildCurrencyChangeBlockMessage(counts);

  return {
    can_change,
    current_currency,
    reasons: counts,
    blockers,
    message,
    checked_at: new Date().toISOString(),
  };
}

/**
 * يبني رسالة عربية واضحة من أسباب المنع
 * @param {Record<string, number>} reasons
 * @returns {string}
 */

}

module.exports = Company;

