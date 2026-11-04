const { pool } = require('../config/pool');

class PublicContent {
  /** كتالوج المنتجات العامة (مع بحث + ترقيم) */
  static async listGlobalProducts({ search, category, page = 1, limit = 12 }) {
    const params = [];
    const conds = ['1=1'];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      conds.push(`(name ILIKE $${i} OR scientific_name ILIKE $${i} OR category ILIKE $${i})`);
    }
    if (category && String(category).trim()) {
      params.push(String(category).trim());
      conds.push(`category = $${params.length}`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT id, barcode, sku, name, scientific_name, unit, category,
              is_verified, created_at
       FROM global_products
       WHERE ${conds.join(' AND ')}
       ORDER BY is_verified DESC, name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM global_products WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  /** منشورات الشركات العامة */
  static async listCompanyPosts({ search, page = 1, limit = 6 }) {
    const params = [];
    const conds = ['p.is_public = TRUE'];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      conds.push(`(p.title ILIKE $${i} OR p.content ILIKE $${i})`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT p.id, p.title, p.content, p.media_url, p.views_count,
              p.created_at,
              c.id AS company_id, c.name AS company_name,
              c.name_en AS company_name_en, c.logo_url AS company_logo
       FROM company_posts p
       JOIN companies c ON c.id = p.company_id
       WHERE ${conds.join(' AND ')}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM company_posts p WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    return {
      items: rows.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / Number(limit)),
      },
    };
  }

  /** قائمة التصنيفات المتاحة (للفلترة) */
  static async listCategories() {
    const r = await pool.query(
      `SELECT DISTINCT category FROM global_products
       WHERE category IS NOT NULL AND TRIM(category) <> ''
       ORDER BY category ASC`
    );
    return r.rows.map((x) => x.category);
  }

  /** زيادة عدد مشاهدات منشور */
  static async incrementPostViews(id) {
    await pool.query(
      `UPDATE company_posts SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1`,
      [id]
    );
  }
}

module.exports = PublicContent;