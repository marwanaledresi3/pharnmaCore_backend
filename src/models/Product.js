// models/Product.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function paginate(page, limit, def = 100, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// هل يستوفي المنتج شروط الإضافة التلقائية للكتالوج؟
function shouldAutoContribute(data) {
  return Boolean(
    data.barcode && String(data.barcode).trim() &&
    data.scientific_name && String(data.scientific_name).trim() &&
    data.manufacturer && String(data.manufacturer).trim() &&
    data.product_type && String(data.product_type).trim()
  );
}

// نسخ الحقول الفارغة من الكتالوج إلى بيانات المنتج
function copyFromGlobal(finalData, gp) {
  const isEmpty = (v) => v === undefined || v === null || v === '';
  if (isEmpty(finalData.name))            finalData.name = gp.name;
  if (isEmpty(finalData.barcode))         finalData.barcode = gp.barcode;
  if (isEmpty(finalData.sku))             finalData.sku = gp.sku;
  if (isEmpty(finalData.unit))            finalData.unit = gp.unit;
  if (isEmpty(finalData.category))        finalData.category = gp.category;
  if (isEmpty(finalData.scientific_name)) finalData.scientific_name = gp.scientific_name;
  if (isEmpty(finalData.description))     finalData.description = gp.description;
}

// إضافة تلقائية للكتالوج كمسودة pending_review
async function autoContributeToCatalog(client, companyId, data) {
  try {
    const existing = await client.query(
      `SELECT * FROM global_products WHERE barcode = $1 LIMIT 1`,
      [data.barcode]
    );
    if (existing.rowCount) return existing.rows[0];

    const inserted = await client.query(
      `INSERT INTO global_products (
         barcode, sku, name, name_en, name_ar,
         scientific_name, description,
         product_type, therapeutic_class, atc_code,
         manufacturer, manufacturer_country, marketing_company,
         active_ingredient, dosage_form, strength,
         package_size, storage_conditions, shelf_life_months,
         requires_prescription, is_controlled, is_otc,
         image_url,
         unit, category,
         created_by_company_id,
         status, is_verified
       )
       VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,
         $8,$9,$10,
         $11,$12,$13,
         $14,$15,$16,
         $17,$18,$19,
         $20,$21,$22,
         $23,
         $24,$25,
         $26,
         'pending_review', false
       )
       ON CONFLICT (barcode) DO NOTHING
       RETURNING *`,
      [
        data.barcode, data.sku || null, data.name,
        data.name_en || null, data.name_ar || null,
        data.scientific_name, data.description || null,
        data.product_type, data.therapeutic_class || null, data.atc_code || null,
        data.manufacturer, data.manufacturer_country || null, data.marketing_company || null,
        data.active_ingredient || null, data.dosage_form || null, data.strength || null,
        data.package_size || null, data.storage_conditions || null, data.shelf_life_months ?? null,
        data.requires_prescription ?? false, data.is_controlled ?? false, data.is_otc ?? false,
        data.image_url || null,
        data.unit, data.category || null,
        companyId,
      ]
    );

    if (inserted.rowCount) return inserted.rows[0];

    const fallback = await client.query(
      `SELECT * FROM global_products WHERE barcode = $1 LIMIT 1`,
      [data.barcode]
    );
    return fallback.rows[0] || null;
  } catch (err) {
    console.error('[autoContributeToCatalog] failed:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Class
// ═══════════════════════════════════════════════════════════════════════════

class Product {

  // ═══════════════════════════════════════════════════════════════════════
  // قائمة المنتجات
  // ═══════════════════════════════════════════════════════════════════════
  static async list(companyId, {
    search,
    is_active,
    product_type,
    has_global_link,
    page = 1,
    limit = 100,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [companyId];
    const conds = ['p.company_id = $1'];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conds.push(`(
        p.name ILIKE $${p}
        OR p.sku ILIKE $${p}
        OR p.barcode ILIKE $${p}
        OR gp.name ILIKE $${p}
        OR gp.name_en ILIKE $${p}
        OR gp.scientific_name ILIKE $${p}
        OR gp.active_ingredient ILIKE $${p}
        OR gp.barcode ILIKE $${p}
      )`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      conds.push(`p.is_active = $${params.length}`);
    }
    if (product_type) {
      params.push(product_type);
      conds.push(`gp.product_type = $${params.length}`);
    }
    if (has_global_link !== undefined) {
      conds.push(has_global_link
        ? `p.global_product_id IS NOT NULL`
        : `p.global_product_id IS NULL`);
    }

    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT
         p.id, p.sku, p.barcode, p.name, p.unit,
         p.category, p.cost_price, p.selling_price, p.profit_margin,
         p.markup_percentage, p.pricing_policy,
         p.tax_rate_id, p.min_stock_level, p.is_active, p.created_at,
         p.base_unit_id,
         p.global_product_id,
         gp.name           AS global_name,
         gp.name_en        AS global_name_en,
         gp.scientific_name AS global_scientific_name,
         gp.active_ingredient AS global_active_ingredient,
         gp.dosage_form    AS global_dosage_form,
         gp.strength       AS global_strength,
         gp.product_type   AS global_product_type,
         gp.is_verified    AS global_is_verified,
         gp.status         AS global_status,
         bu.code AS base_unit_code,
         bu.name AS base_unit_name,
         tr.name AS tax_rate_name, tr.rate AS tax_rate_value,

         -- وحدات المنتج
         COALESCE(
           (SELECT json_agg(
                     json_build_object(
                       'unit_id', pu.unit_id,
                       'unit_name', u.name,
                       'unit_code', u.code,
                       'conversion_factor', pu.conversion_factor,
                       'is_base_unit', pu.is_base_unit,
                       'sale_price', pu.sale_price,
                       'purchase_price', pu.purchase_price,
                       'min_selling_price', pu.min_selling_price,
                       'barcode', pu.barcode
                     ) ORDER BY pu.is_base_unit DESC, u.name
                   )
            FROM product_units pu
            JOIN units u ON u.id = pu.unit_id
            WHERE pu.product_id = p.id),
           '[]'::json
         ) AS units,

         COALESCE((SELECT SUM(quantity) FROM product_batches
                   WHERE product_id = p.id AND quantity > 0), 0)::numeric AS current_stock

       FROM products p
       LEFT JOIN global_products gp ON gp.id = p.global_product_id
       LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
       LEFT JOIN units bu ON bu.id = p.base_unit_id
       WHERE ${conds.join(' AND ')}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM products p
       LEFT JOIN global_products gp ON gp.id = p.global_product_id
       WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );

    const total = countRes.rows[0].total;
    return {
      items: rows.rows,
      pagination: {
        page: pg, limit: lm, total,
        pages: Math.ceil(total / lm),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // منتج واحد + بيانات الكتالوج + الوحدات
  // ═══════════════════════════════════════════════════════════════════════
  static async findById(companyId, id) {
    const r = await pool.query(
      `SELECT p.id, p.sku, p.barcode, p.name, p.unit,
              p.category, p.cost_price, p.selling_price, p.profit_margin,
              p.markup_percentage, p.pricing_policy,
              p.tax_rate_id, p.revenue_account_id, p.inventory_account_id, p.cogs_account_id,
              p.min_stock_level, p.is_active, p.created_at,
              p.base_unit_id, p.global_product_id,
              bu.code AS base_unit_code,
              bu.name AS base_unit_name,
              gp.id                  AS gp_id,
              gp.name                AS gp_name,
              gp.name_en             AS gp_name_en,
              gp.name_ar             AS gp_name_ar,
              gp.scientific_name     AS gp_scientific_name,
              gp.active_ingredient   AS gp_active_ingredient,
              gp.dosage_form         AS gp_dosage_form,
              gp.strength            AS gp_strength,
              gp.package_size        AS gp_package_size,
              gp.manufacturer        AS gp_manufacturer,
              gp.manufacturer_country AS gp_manufacturer_country,
              gp.marketing_company   AS gp_marketing_company,
              gp.product_type        AS gp_product_type,
              gp.therapeutic_class   AS gp_therapeutic_class,
              gp.atc_code            AS gp_atc_code,
              gp.requires_prescription AS gp_requires_prescription,
              gp.is_controlled       AS gp_is_controlled,
              gp.is_otc              AS gp_is_otc,
              gp.is_verified         AS gp_is_verified,
              gp.status              AS gp_status,
              gp.indications         AS gp_indications,
              gp.contraindications   AS gp_contraindications,
              gp.dosage              AS gp_dosage,
              gp.side_effects        AS gp_side_effects,
              gp.drug_interactions   AS gp_drug_interactions,
              gp.pregnancy_lactation AS gp_pregnancy_lactation,
              gp.pharmacokinetics    AS gp_pharmacokinetics,
              gp.composition         AS gp_composition,
              gp.substitutes         AS gp_substitutes,
              gp.image_url           AS gp_image_url
       FROM products p
       LEFT JOIN units bu ON bu.id = p.base_unit_id
       LEFT JOIN global_products gp ON gp.id = p.global_product_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [id, companyId]
    );
    const row = r.rows[0];
    if (!row) return null;

    // فصل بيانات الكتالوج
    const product = {};
    const globalProduct = {};
    for (const [key, val] of Object.entries(row)) {
      if (key.startsWith('gp_')) globalProduct[key.slice(3)] = val;
      else product[key] = val;
    }
    product.global_product = globalProduct.id ? globalProduct : null;

    // الوحدات
    const unitsRes = await pool.query(
      `SELECT pu.id, pu.unit_id, pu.conversion_factor, pu.is_base_unit,
              pu.sale_price, pu.purchase_price, pu.min_selling_price, pu.barcode,
              u.code, u.name, u.name_en
       FROM product_units pu
       JOIN units u ON u.id = pu.unit_id
       WHERE pu.product_id = $1
       ORDER BY pu.is_base_unit DESC, u.name`,
      [id]
    );
    product.units = unitsRes.rows;

    return product;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // دفعات منتج
  // ═══════════════════════════════════════════════════════════════════════
  static async getBatches(companyId, productId) {
    const r = await pool.query(
      `SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity,
              pb.cost_price, pb.cost_price_base,
              w.name AS warehouse_name
       FROM product_batches pb
       JOIN warehouses w ON w.id = pb.warehouse_id
       WHERE pb.company_id = $1 AND pb.product_id = $2 AND pb.quantity > 0
       ORDER BY pb.expiry_date ASC NULLS LAST`,
      [companyId, productId]
    );
    return r.rows;
  }

  static async existsBySku(companyId, sku) {
    const r = await pool.query(
      `SELECT 1 FROM products WHERE company_id = $1 AND sku = $2 LIMIT 1`,
      [companyId, sku]
    );
    return r.rowCount > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // إنشاء منتج (مع دعم الوحدات الفرعية)
  // ═══════════════════════════════════════════════════════════════════════
  static async create(client, companyId, data) {
    // 1) تحقق base_unit_id
    if (data.base_unit_id) {
      const u = await client.query(
        `SELECT id FROM units WHERE id = $1 AND company_id = $2`,
        [data.base_unit_id, companyId]
      );
      if (!u.rowCount) {
        throw new ApiError(400, `Base unit ${data.base_unit_id} not found in this company`);
      }
    }

    // 2) تحقق الوحدات الفرعية (لا تكرار، نفس الشركة)
    const subUnits = Array.isArray(data.units) ? data.units : [];
    if (subUnits.length > 0) {
      if (!data.base_unit_id) {
        throw new ApiError(400, 'base_unit_id is required when units are provided');
      }

      const seen = new Set();
      for (const u of subUnits) {
        if (!u.unit_id) throw new ApiError(400, 'Each unit must have unit_id');
        if (u.unit_id === data.base_unit_id) {
          throw new ApiError(400, 'Base unit cannot appear in sub-units');
        }
        if (seen.has(u.unit_id)) {
          throw new ApiError(400, 'Duplicate unit_id in units');
        }
        seen.add(u.unit_id);

        const factor = Number(u.conversion_factor);
        if (!Number.isFinite(factor) || factor <= 0) {
          throw new ApiError(400, 'Each unit must have conversion_factor > 0');
        }

        const unitCheck = await client.query(
          `SELECT id FROM units WHERE id = $1 AND company_id = $2`,
          [u.unit_id, companyId]
        );
        if (!unitCheck.rowCount) {
          throw new ApiError(400, `Unit ${u.unit_id} not found in this company`);
        }
      }
    }

    // 3) تحقق markup_percentage
    let markup = null;
    if (data.markup_percentage !== undefined && data.markup_percentage !== null) {
      const m = Number(data.markup_percentage);
      if (!Number.isFinite(m) || m < 0 || m > 1000) {
        throw new ApiError(400, 'markup_percentage must be between 0 and 1000');
      }
      markup = m;
    }

    // 4) تحقق pricing_policy
    const policy = data.pricing_policy || 'auto_markup';
    if (!['fixed', 'auto_markup'].includes(policy)) {
      throw new ApiError(400, 'pricing_policy must be "fixed" or "auto_markup"');
    }

    // 5) ربط الكتالوج العالمي
    let gp = null;
    let finalData = { ...data };
    let globalProductId = data.global_product_id || null;

    if (globalProductId) {
      const gpRes = await client.query(
        `SELECT * FROM global_products WHERE id = $1 AND status = 'active'`,
        [globalProductId]
      );
      gp = gpRes.rows[0];
      if (!gp) {
        throw new ApiError(400, `Global product ${globalProductId} not found or inactive`);
      }
      copyFromGlobal(finalData, gp);
    } else if (shouldAutoContribute(data) && data.skip_catalog_contribution !== true) {
      const contributed = await autoContributeToCatalog(client, companyId, data);
      if (contributed) {
        gp = contributed;
        globalProductId = contributed.id;
        copyFromGlobal(finalData, gp);
      }
    }

    // 6) حساب profit_margin
    const cost = Number(finalData.cost_price) || 0;
    const selling = Number(finalData.selling_price) || 0;
    let profitMargin = Number(finalData.profit_margin);
    if (!Number.isFinite(profitMargin) || profitMargin === 0) {
      profitMargin = selling > 0 ? ((selling - cost) / selling) * 100 : 0;
    }

    // 7) INSERT products
    const r = await client.query(
      `INSERT INTO products
         (company_id, sku, barcode, name, unit, category,
          cost_price, selling_price, profit_margin,
          markup_percentage, pricing_policy,
          tax_rate_id, revenue_account_id, inventory_account_id, cogs_account_id,
          min_stock_level, base_unit_id,
          global_product_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16, $17, $18)
       RETURNING id, sku, barcode, name, unit, category,
                 cost_price, selling_price, profit_margin,
                 markup_percentage, pricing_policy,
                 is_active, created_at, base_unit_id,
                 global_product_id`,
      [
        companyId,
        finalData.sku,
        finalData.barcode || null,
        finalData.name,
        finalData.unit,
        finalData.category || null,
        cost, selling, round2(profitMargin),
        markup,
        policy,
        finalData.tax_rate_id || null,
        finalData.revenue_account_id || null,
        finalData.inventory_account_id || null,
        finalData.cogs_account_id || null,
        finalData.min_stock_level || 0,
        finalData.base_unit_id || null,
        globalProductId,
      ]
    );
    const product = r.rows[0];

    // 8) product_units — الوحدة الأساسية
    if (finalData.base_unit_id) {
      await client.query(
        `INSERT INTO product_units
           (product_id, unit_id, conversion_factor, is_base_unit, sale_price, purchase_price)
         VALUES ($1, $2, 1, TRUE, $3, $4)
         ON CONFLICT (product_id, unit_id) DO NOTHING`,
        [product.id, finalData.base_unit_id, selling || null, cost || null]
      );
    }

    // 9) product_units — الوحدات الفرعية
    for (const u of subUnits) {
      if (!u.unit_id) continue;
      if (u.unit_id === finalData.base_unit_id) continue;

      const factor = Number(u.conversion_factor);
      if (!Number.isFinite(factor) || factor <= 0) continue;

      await client.query(
        `INSERT INTO product_units
           (product_id, unit_id, conversion_factor, is_base_unit,
            sale_price, purchase_price, barcode)
         VALUES ($1, $2, $3, FALSE, $4, $5, $6)
         ON CONFLICT (product_id, unit_id) DO NOTHING`,
        [
          product.id,
          u.unit_id,
          factor,
          u.sale_price != null ? Number(u.sale_price) : null,
          u.purchase_price != null ? Number(u.purchase_price) : null,
          u.barcode || null,
        ]
      );
    }

    // 10) معلومات المساهمة
    if (gp && !data.global_product_id && gp.status === 'pending_review') {
      product.catalog_contributed = true;
      product.catalog_status = 'pending_review';
    }

    return product;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // تعديل منتج
  // ═══════════════════════════════════════════════════════════════════════
  static async update(companyId, id, payload) {
    const allowed = [
      'sku', 'barcode', 'name', 'unit', 'category',
      'cost_price', 'selling_price', 'profit_margin',
      'markup_percentage', 'pricing_policy',
      'tax_rate_id', 'revenue_account_id', 'inventory_account_id', 'cogs_account_id',
      'min_stock_level', 'is_active',
    ];
    const fields = [];
    const params = [];

    for (const k of allowed) {
      if (payload[k] !== undefined) {
        if (k === 'markup_percentage' && payload[k] !== null) {
          const m = Number(payload[k]);
          if (!Number.isFinite(m) || m < 0 || m > 1000) {
            throw new ApiError(400, 'markup_percentage must be between 0 and 1000');
          }
          params.push(m);
        } else if (k === 'pricing_policy') {
          if (!['fixed', 'auto_markup'].includes(payload[k])) {
            throw new ApiError(400, 'pricing_policy must be "fixed" or "auto_markup"');
          }
          params.push(payload[k]);
        } else {
          params.push(payload[k]);
        }
        fields.push(`${k} = $${params.length}`);
      }
    }

    // global_product_id
    if (payload.global_product_id !== undefined) {
      if (payload.global_product_id) {
        const gp = await pool.query(
          `SELECT id FROM global_products WHERE id = $1 AND status = 'active'`,
          [payload.global_product_id]
        );
        if (!gp.rowCount) {
          throw new ApiError(400, `Global product ${payload.global_product_id} not found or inactive`);
        }
      }
      params.push(payload.global_product_id || null);
      fields.push(`global_product_id = $${params.length}`);
    }

    // base_unit_id
    if (payload.base_unit_id !== undefined) {
      if (payload.base_unit_id) {
        const u = await pool.query(
          `SELECT id FROM units WHERE id = $1 AND company_id = $2`,
          [payload.base_unit_id, companyId]
        );
        if (!u.rowCount) {
          throw new ApiError(400, `Base unit ${payload.base_unit_id} not found`);
        }

        const stock = await pool.query(
          `SELECT COALESCE(SUM(quantity), 0)::numeric AS qty
           FROM product_batches WHERE product_id = $1 AND company_id = $2`,
          [id, companyId]
        );
        if (Number(stock.rows[0].qty) > 0) {
          throw new ApiError(400, 'Cannot change base unit while product has stock');
        }
      }
      params.push(payload.base_unit_id || null);
      fields.push(`base_unit_id = $${params.length}`);
    }

    if (!fields.length) return null;

    params.push(id, companyId);
    const r = await pool.query(
      `UPDATE products SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING id, sku, name, unit, category, cost_price, selling_price,
                 profit_margin, markup_percentage, pricing_policy,
                 is_active, base_unit_id, global_product_id`,
      params
    );
    const updated = r.rows[0];
    if (!updated) return null;

    if (payload.base_unit_id !== undefined) {
      await pool.query(`DELETE FROM product_units WHERE product_id = $1`, [id]);
      if (updated.base_unit_id) {
        await pool.query(
          `INSERT INTO product_units
             (product_id, unit_id, conversion_factor, is_base_unit, sale_price, purchase_price)
           VALUES ($1, $2, 1, TRUE, $3, $4)`,
          [id, updated.base_unit_id, updated.selling_price || null, updated.cost_price || null]
        );
      }
    }

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // حذف منتج
  // ═══════════════════════════════════════════════════════════════════════
  static async delete(companyId, id) {
    const stock = await pool.query(
      `SELECT 1 FROM product_batches
       WHERE product_id = $1 AND company_id = $2 AND quantity > 0 LIMIT 1`,
      [id, companyId]
    );
    if (stock.rowCount) {
      throw new ApiError(400, 'Cannot delete product with stock');
    }

    const refs = await pool.query(
      `SELECT 1 FROM sales_order_items WHERE product_id = $1 LIMIT 1
       UNION ALL
       SELECT 1 FROM purchase_order_items WHERE product_id = $1 LIMIT 1
       UNION ALL
       SELECT 1 FROM invoice_items WHERE product_id = $1 LIMIT 1
       UNION ALL
       SELECT 1 FROM return_items WHERE product_id = $1 LIMIT 1
       LIMIT 1`,
      [id]
    );
    if (refs.rowCount) {
      throw new ApiError(400, 'Cannot delete product: used in orders/invoices/returns');
    }

    const r = await pool.query(
      `DELETE FROM products WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return r.rowCount > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // مخزون منتج واحد
  // ═══════════════════════════════════════════════════════════════════════
  static async getStock(companyId, productId) {
    const r = await pool.query(
      `SELECT
        COALESCE(SUM(b.quantity), 0)::numeric AS total_quantity,
        COALESCE((
          SELECT SUM(sr.quantity) FROM stock_reservations sr
          WHERE sr.product_id = $1 AND sr.company_id = $2
            AND sr.status = 'active'
            AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
        ), 0)::numeric AS reserved_quantity,
        COALESCE(SUM(b.quantity), 0)::numeric - COALESCE((
          SELECT SUM(sr.quantity) FROM stock_reservations sr
          WHERE sr.product_id = $1 AND sr.company_id = $2
            AND sr.status = 'active'
            AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
        ), 0)::numeric AS available_quantity,
        (
          SELECT json_build_object('id', u.id, 'code', u.code, 'name', u.name)
          FROM units u
          JOIN products p2 ON p2.base_unit_id = u.id
          WHERE p2.id = $1
        ) AS base_unit,
        COALESCE(
          json_agg(
            json_build_object(
              'warehouse_id', b.warehouse_id,
              'warehouse_name', w.name,
              'batch_id', b.id,
              'batch_number', b.batch_number,
              'expiry_date', b.expiry_date,
              'quantity', b.quantity,
              'cost_price', b.cost_price,
              'cost_price_base', b.cost_price_base
            )
            ORDER BY b.expiry_date ASC
          ) FILTER (WHERE b.quantity > 0),
          '[]'::json
        ) AS batches
      FROM product_batches b
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.product_id = $1 AND b.company_id = $2
      GROUP BY b.product_id`,
      [productId, companyId]
    );
    if (!r.rowCount) {
      return {
        total_quantity: 0, reserved_quantity: 0,
        available_quantity: 0, base_unit: null, batches: [],
      };
    }
    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // مخزون كل المنتجات
  // ═══════════════════════════════════════════════════════════════════════
  static async getAllStock(companyId) {
    const r = await pool.query(
      `SELECT
        p.id AS product_id,
        p.id AS id,
        p.name AS product_name,
        p.name AS name,
        p.sku,
        p.base_unit_id,
        p.global_product_id,
        gp.name AS global_name,
        gp.product_type AS global_product_type,
        bu.code AS base_unit_code,
        bu.name AS base_unit_name,
        COALESCE(p.cost_price, 0)::numeric AS cost_price,
        COALESCE(p.selling_price, 0)::numeric AS selling_price,
        p.markup_percentage,
        p.pricing_policy,
        COALESCE(SUM(b.quantity), 0)::numeric AS total_quantity,
        COALESCE((
          SELECT SUM(sr.quantity) FROM stock_reservations sr
          WHERE sr.product_id = p.id AND sr.company_id = p.company_id
            AND sr.status = 'active'
            AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
        ), 0)::numeric AS reserved_quantity,
        COALESCE(SUM(b.quantity), 0)::numeric - COALESCE((
          SELECT SUM(sr.quantity) FROM stock_reservations sr
          WHERE sr.product_id = p.id AND sr.company_id = p.company_id
            AND sr.status = 'active'
            AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
        ), 0)::numeric AS available_quantity,
        COALESCE(
          json_agg(
            json_build_object(
              'warehouse_id', b.warehouse_id,
              'warehouse_name', w.name,
              'batch_id', b.id,
              'batch_number', b.batch_number,
              'expiry_date', b.expiry_date,
              'quantity', b.quantity,
              'cost_price', b.cost_price,
              'cost_price_base', b.cost_price_base
            )
            ORDER BY b.expiry_date ASC
          ) FILTER (WHERE b.id IS NOT NULL AND b.quantity > 0),
          '[]'::json
        ) AS batches,

        -- وحدات المنتج
        COALESCE(
          (SELECT json_agg(
                     json_build_object(
                       'unit_id', pu.unit_id,
                       'unit_name', u.name,
                       'unit_code', u.code,
                       'conversion_factor', pu.conversion_factor,
                       'is_base_unit', pu.is_base_unit,
                       'sale_price', pu.sale_price,
                       'purchase_price', pu.purchase_price,
                       'min_selling_price', pu.min_selling_price,
                       'barcode', pu.barcode
                     ) ORDER BY pu.is_base_unit DESC, u.name
                   )
           FROM product_units pu
           JOIN units u ON u.id = pu.unit_id
           WHERE pu.product_id = p.id),
          '[]'::json
        ) AS units

      FROM products p
      LEFT JOIN global_products gp ON gp.id = p.global_product_id
      LEFT JOIN units bu ON bu.id = p.base_unit_id
      LEFT JOIN product_batches b
        ON b.product_id = p.id AND b.company_id = p.company_id
      LEFT JOIN warehouses w ON w.id = b.warehouse_id
      WHERE p.company_id = $1 AND p.is_active = TRUE
      GROUP BY p.id, p.name, p.sku, p.cost_price, p.selling_price,
               p.markup_percentage, p.pricing_policy,
               p.base_unit_id, p.global_product_id,
               gp.name, gp.product_type,
               bu.code, bu.name
      ORDER BY p.name`,
      [companyId]
    );
    return r.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ربط منتج موجود بمنتج عالمي
  // ═══════════════════════════════════════════════════════════════════════
  static async linkToGlobal(companyId, productId, globalProductId) {
    const gp = await pool.query(
      `SELECT id FROM global_products WHERE id = $1 AND status = 'active'`,
      [globalProductId]
    );
    if (!gp.rowCount) {
      throw new ApiError(404, `Global product ${globalProductId} not found or inactive`);
    }

    const r = await pool.query(
      `UPDATE products
       SET global_product_id = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id, name, global_product_id`,
      [globalProductId, productId, companyId]
    );
    if (!r.rowCount) throw new ApiError(404, 'Product not found');
    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // نسخ الحقول التعريفية من الكتالوج
  // ═══════════════════════════════════════════════════════════════════════
  static async copyFromGlobal(companyId, productId, { overwrite = false } = {}) {
    const p = await pool.query(
      `SELECT id, global_product_id FROM products
       WHERE id = $1 AND company_id = $2`,
      [productId, companyId]
    );
    if (!p.rowCount) throw new ApiError(404, 'Product not found');

    const gpId = p.rows[0].global_product_id;
    if (!gpId) throw new ApiError(400, 'Product is not linked to a global product');

    const gp = await pool.query(`SELECT * FROM global_products WHERE id = $1`, [gpId]);
    if (!gp.rowCount) throw new ApiError(404, 'Global product not found');
    const g = gp.rows[0];

    const mappings = [
      ['name', g.name],
      ['barcode', g.barcode],
      ['sku', g.sku],
      ['unit', g.unit],
      ['category', g.category],
    ];

    const sets = [];
    const params = [];
    let i = 1;

    for (const [col, val] of mappings) {
      if (overwrite) {
        sets.push(`${col} = $${i++}`);
        params.push(val);
      } else {
        sets.push(`${col} = COALESCE(NULLIF(${col}, ''), $${i++})`);
        params.push(val);
      }
    }

    params.push(productId, companyId);
    const r = await pool.query(
      `UPDATE products
       SET ${sets.join(', ')}
       WHERE id = $${i} AND company_id = $${i + 1}
       RETURNING id, name, sku, barcode, unit, category, global_product_id`,
      params
    );
    return r.rows[0];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // إعادة حساب سعر البيع لكل منتجات الشركة
  // ═══════════════════════════════════════════════════════════════════════
  static async recalculateAllSellingPrices(companyId, userId = null) {
    const { recalculateSellingPrice } = require('../services/helpers/pricing');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const products = await client.query(
        `SELECT id, cost_price FROM products
         WHERE company_id = $1 AND pricing_policy = 'auto_markup'
           AND cost_price > 0`,
        [companyId]
      );

      const results = [];
      for (const p of products.rows) {
        const r = await recalculateSellingPrice(client, {
          companyId,
          productId: p.id,
          newCostPrice: Number(p.cost_price),
          changeSource: 'bulk_update',
          userId,
        });
        results.push({ product_id: p.id, ...r });
      }

      await client.query('COMMIT');
      return { updated: results.length, results };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = Product;