const {pool} = require('../config/pool');

class ExchangeRate {
  /**
   * قائمة الأسعار مع فلترة
   */
  static async list(companyId, { currency_id, date_from, date_to, page = 1, limit = 50 }) {
    const params = [companyId];
    const conds = ['er.company_id = $1'];

    if (currency_id) { params.push(currency_id); conds.push(`er.currency_id = $${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`er.rate_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`er.rate_date <= $${params.length}`); }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT er.id, er.currency_id, c.code AS currency_code, c.name AS currency_name,
              er.rate, er.rate_date, er.created_at
       FROM exchange_rates er
       JOIN currencies c ON c.id = er.currency_id
       WHERE ${conds.join(' AND ')}
       ORDER BY er.rate_date DESC, c.code ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM exchange_rates er WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page), limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT er.id, er.currency_id, c.code AS currency_code,
              er.rate, er.rate_date, er.created_at
       FROM exchange_rates er
       JOIN currencies c ON c.id = er.currency_id
       WHERE er.id = $1 AND er.company_id = $2`,
      [id, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * السعر الحالي (الأحدث ≤ اليوم)
   */
  static async getCurrent(companyId, currencyId, asOfDate = null) {
    const asOf = asOfDate || new Date().toISOString().slice(0, 10);

    // إذا كانت العملة الأساسية، السعر = 1
    const company = await pool.query(
      `SELECT currency_id FROM companies WHERE id = $1`,
      [companyId]
    );
    if (company.rows[0].currency_id === currencyId) {
      return { rate: 1, rate_date: asOf, is_base: true };
    }

    const r = await pool.query(
      `SELECT rate, rate_date FROM exchange_rates
       WHERE company_id = $1 AND currency_id = $2 AND rate_date <= $3
       ORDER BY rate_date DESC
       LIMIT 1`,
      [companyId, currencyId, asOf]
    );
    if (!r.rowCount) return null;
    return { ...r.rows[0], is_base: false };
  }

  static async create(client, companyId, { currency_id, rate, rate_date }) {
    const r = await client.query(
      `INSERT INTO exchange_rates (company_id, currency_id, rate, rate_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, currency_id, rate_date)
       DO UPDATE SET rate = EXCLUDED.rate
       RETURNING id, currency_id, rate, rate_date, created_at`,
      [companyId, currency_id, rate, rate_date]
    );
    return r.rows[0];
  }

  static async update(companyId, id, { rate }) {
    const r = await pool.query(
      `UPDATE exchange_rates SET rate = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id, currency_id, rate, rate_date`,
      [rate, id, companyId]
    );
    return r.rows[0] || null;
  }

  static async delete(companyId, id) {
    const r = await pool.query(
      `DELETE FROM exchange_rates WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }
}

module.exports = ExchangeRate;