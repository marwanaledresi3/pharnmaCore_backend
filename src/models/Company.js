const {pool} = require('../config/pool');

class Company {

// دالة جلب الشركات مع الموردين (القائمة المختلطة)
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

  // دالة جلب الشركات فقط مع تفاصيل العملة
  static async findAllCompanies() {
    const r = await pool.query(
      `SELECT c.id, c.name, c.currency_id, c.tax_number, c.address,
              c.logo_url, c.is_active, c.created_at, c.updated_at,
              c.email, c.phone, c.website, c.country, c.city,
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
      `SELECT c.id, c.name, c.currency_id, c.tax_number, c.address,
              c.logo_url, c.is_active, c.created_at, c.updated_at,
              c.email, c.phone, c.website, c.country, c.city,
              cu.code AS currency_code, cu.symbol AS currency_symbol
       FROM companies c
       JOIN currencies cu ON cu.id = c.currency_id
       WHERE c.id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  static async create(client, { name, currency_id, tax_number, address, logo_url, email, phone }) {
    const r = await client.query(
      `INSERT INTO companies
         (name, currency_id, tax_number, address, logo_url, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, currency_id, created_at`,
      [name, currency_id, tax_number || null, address || null,
       logo_url || null, email || null, phone || null]
    );
    return r.rows[0];
  }

  static async update(id, payload) {
    const allowed = [
      'name', 'tax_number', 'address', 'logo_url',
      'email', 'phone', 'website', 'country', 'city',
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
       RETURNING id, name, tax_number, address, logo_url,
                 email, phone, website, country, city, updated_at`,
      params
    );
    return r.rows[0] || null;
  }

  /**
   * هل يمكن تغيير العملة الأساسية؟
   * لا يمكن إذا كانت هناك قيود مرحّلة أو فواتير
   */
  static async canChangeCurrency(companyId) {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM journal_entries WHERE company_id = $1 AND status = 'posted') AS posted_entries,
         (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1) AS invoices,
         (SELECT COUNT(*)::int FROM sales_orders WHERE company_id = $1 AND status <> 'draft') AS orders`,
      [companyId]
    );
    const { posted_entries, invoices, orders } = r.rows[0];
    return {
      can_change: posted_entries === 0 && invoices === 0 && orders === 0,
      reasons: {
        posted_entries,
        invoices,
        orders,
      },
    };
  }

  static async changeCurrency(id, newCurrencyId) {
    const r = await pool.query(
      `UPDATE companies SET currency_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, currency_id, updated_at`,
      [newCurrencyId, id]
    );
    return r.rows[0] || null;
  }
}

module.exports = Company;