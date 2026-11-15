// models/GlobalProduct.js
const { pool } = require('../config/pool');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function paginate(page, limit, def = 20, max = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || def, 1), max);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

function asJson(v) {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// Class
// ═══════════════════════════════════════════════════════════════════════════

class GlobalProduct {

  // الحقول التي تُعاد في القوائم (مختصرة — للأداء)
  static SUMMARY_COLUMNS = `
    id, barcode, sku,
    name, name_en, name_ar,
    scientific_name, active_ingredient,
    dosage_form, strength, package_size,
    manufacturer, manufacturer_country, marketing_company,
    product_type, therapeutic_class, atc_code,
    unit, category,
    requires_prescription, is_controlled, is_otc,
    image_url, status, is_verified,
    created_by_company_id, created_at, updated_at
  `;

  // ═══════════════════════════════════════════════════════════════════════
  // البحث المتقدم
  //   - بحث نصي ضبابي في: name, name_en, name_ar, scientific_name,
  //     active_ingredient, barcode, sku, atc_code
  //   - فلترة حسب: product_type, status, is_verified, is_otc,
  //     requires_prescription, manufacturer, atc_code
  //   - pagination
  // ═══════════════════════════════════════════════════════════════════════
  static async search({
    search,
    product_type,
    status = 'active',
    is_verified,
    is_otc,
    requires_prescription,
    atc_code,
    manufacturer,
    category,
    page = 1,
    limit = 20,
  } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const params = [];
    const conds = [];

    // ─── بحث نصي ─────────────────────────────────────────────────────
    let exactMatchParam = null;
    if (search && String(search).trim() !== '') {
      const term = String(search).trim();
      params.push(`%${term}%`);
      exactMatchParam = params.length;
      const p = params.length;

      conds.push(`(
        name                ILIKE $${p}
        OR name_en          ILIKE $${p}
        OR name_ar          ILIKE $${p}
        OR scientific_name  ILIKE $${p}
        OR active_ingredient ILIKE $${p}
        OR barcode          ILIKE $${p}
        OR sku              ILIKE $${p}
        OR atc_code         ILIKE $${p}
        OR manufacturer     ILIKE $${p}
      )`);
    }

    // ─── فلاتر مباشرة ─────────────────────────────────────────────────
    if (product_type) {
      params.push(product_type);
      conds.push(`product_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    if (typeof is_verified === 'boolean') {
      params.push(is_verified);
      conds.push(`is_verified = $${params.length}`);
    }
    if (typeof is_otc === 'boolean') {
      params.push(is_otc);
      conds.push(`is_otc = $${params.length}`);
    }
    if (typeof requires_prescription === 'boolean') {
      params.push(requires_prescription);
      conds.push(`requires_prescription = $${params.length}`);
    }
    if (atc_code) {
      params.push(`${atc_code}%`);
      conds.push(`atc_code LIKE $${params.length}`);
    }
    if (manufacturer) {
      params.push(`%${manufacturer}%`);
      conds.push(`manufacturer ILIKE $${params.length}`);
    }
    if (category) {
      params.push(category);
      conds.push(`category = $${params.length}`);
    }

    const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

    // ─── الترتيب: مطابقة تامة أولاً ────────────────────────────────────
    let orderClause = `name ASC`;
    if (exactMatchParam) {
      orderClause = `
        CASE
          WHEN name = $${exactMatchParam} THEN 0
          WHEN name ILIKE $${exactMatchParam} THEN 1
          ELSE 2
        END,
        name ASC
      `;
    }

    params.push(lm, offset);

    const rows = await pool.query(
      `SELECT ${this.SUMMARY_COLUMNS}
       FROM global_products
       ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // ─── العدد الكلي ──────────────────────────────────────────────────
    const countParams = params.slice(0, -2);
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM global_products
       ${whereClause}`,
      countParams
    );

    const total = countRes.rows[0].total;

    return {
      items: rows.rows,
      pagination: {
        page: pg,
        limit: lm,
        total,
        pages: Math.ceil(total / lm),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // جلب منتج واحد بكل تفاصيله
  // ═══════════════════════════════════════════════════════════════════════
  static async findById(id) {
    const r = await pool.query(
      `SELECT * FROM global_products WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // بحث بالباركود (للاستخدام السريع عند البيع/الشراء)
  // ═══════════════════════════════════════════════════════════════════════
  static async findByBarcode(barcode) {
    const r = await pool.query(
      `SELECT ${this.SUMMARY_COLUMNS}
       FROM global_products
       WHERE barcode = $1
       LIMIT 1`,
      [barcode]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // إضافة منتج جديد للكتالوج
  //   - ON CONFLICT (barcode) DO NOTHING → يُرجع null إذا مكرر
  //   - جميع الحقول الاختيارية nullable (ما عدا name, unit)
  //   - status يبدأ 'pending_review' (للمراجعة) أو 'active' (إن أضافه Admin)
  // ═══════════════════════════════════════════════════════════════════════
  static async create(companyId, data) {
    const r = await pool.query(
      `INSERT INTO global_products (
        barcode, sku, name, name_en, name_ar, short_name,
        scientific_name, description, description_en,
        product_type, therapeutic_class, pharmacological_class,
        atc_code, hs_code, rxnorm_cui, snomed_code,
        manufacturer, manufacturer_country, marketing_company,
        agent_company, origin_country,
        active_ingredient, dosage_form, strength,
        route_of_administration, package_size, units_per_package,
        storage_conditions, shelf_life_months, requires_refrigeration,
        image_url, image_urls, leaflet_url,
        requires_prescription, is_controlled, controlled_schedule,
        is_otc, is_orphan_drug,
        regulatory_status, approval_date, withdrawal_date,
        patent_expiry, exclusivity_expiry,
        indications, other_uses, contraindications, precautions,
        boxed_warnings, black_box_warning,
        dosage, overdose,
        side_effects, adverse_reactions,
        drug_interactions, food_interactions, disease_interactions,
        pregnancy_lactation, driving_warning, monitoring_tests,
        pharmacokinetics, pharmacodynamics, mechanism_of_action,
        composition, excipients, substitutes,
        registrations, barcodes, skus, synonyms,
        keywords, tags, notes, metadata,
        unit, category,
        created_by_company_id,
        status, is_verified
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,
        $10,$11,$12,
        $13,$14,$15,$16,
        $17,$18,$19,
        $20,$21,
        $22,$23,$24,
        $25,$26,$27,
        $28,$29,$30,
        $31,$32,$33,
        $34,$35,$36,
        $37,$38,
        $39,$40,$41,
        $42,$43,
        $44,$45,$46,$47,
        $48,$49,
        $50,$51,
        $52,$53,
        $54,$55,$56,
        $57,$58,$59,
        $60,$61,$62,
        $63,$64,$65,
        $66,$67,$68,$69,
        $70,$71,$72,$73,
        $74,$75,
        $76,
        $77,$78
      )
      ON CONFLICT (barcode) DO NOTHING
      RETURNING *`,
      [
        data.barcode || null,
        data.sku || null,
        data.name,
        data.name_en || null,
        data.name_ar || null,
        data.short_name || null,
        data.scientific_name || null,
        data.description || null,
        data.description_en || null,
        data.product_type || null,
        data.therapeutic_class || null,
        data.pharmacological_class || null,
        data.atc_code || null,
        data.hs_code || null,
        data.rxnorm_cui || null,
        data.snomed_code || null,
        data.manufacturer || null,
        data.manufacturer_country || null,
        data.marketing_company || null,
        data.agent_company || null,
        data.origin_country || null,
        data.active_ingredient || null,
        data.dosage_form || null,
        data.strength || null,
        data.route_of_administration || null,
        data.package_size || null,
        data.units_per_package ?? null,
        data.storage_conditions || null,
        data.shelf_life_months ?? null,
        data.requires_refrigeration ?? false,
        data.image_url || null,
        asJson(data.image_urls),
        data.leaflet_url || null,
        data.requires_prescription ?? false,
        data.is_controlled ?? false,
        data.controlled_schedule || null,
        data.is_otc ?? false,
        data.is_orphan_drug ?? false,
        data.regulatory_status || null,
        data.approval_date || null,
        data.withdrawal_date || null,
        data.patent_expiry || null,
        data.exclusivity_expiry || null,
        asJson(data.indications),
        asJson(data.other_uses),
        asJson(data.contraindications),
        asJson(data.precautions),
        asJson(data.boxed_warnings),
        data.black_box_warning || null,
        asJson(data.dosage),
        asJson(data.overdose),
        asJson(data.side_effects),
        asJson(data.adverse_reactions),
        asJson(data.drug_interactions),
        asJson(data.food_interactions),
        asJson(data.disease_interactions),
        asJson(data.pregnancy_lactation),
        data.driving_warning ?? false,
        asJson(data.monitoring_tests),
        asJson(data.pharmacokinetics),
        asJson(data.pharmacodynamics),
        data.mechanism_of_action || null,
        asJson(data.composition),
        asJson(data.excipients),
        asJson(data.substitutes),
        asJson(data.registrations),
        asJson(data.barcodes),
        asJson(data.skus),
        asJson(data.synonyms),
        data.keywords || null,
        data.tags || null,
        data.notes || null,
        asJson(data.metadata),
        data.unit,
        data.category || null,
        companyId || null,
        data.status || 'pending_review',
        data.is_verified ?? false,
      ]
    );

    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // تعديل منتج — ديناميكي (فقط الحقول الممرَّرة)
  // ═══════════════════════════════════════════════════════════════════════
  static async update(id, data) {
    const directCols = [
      'barcode','sku','name','name_en','name_ar','short_name',
      'scientific_name','description','description_en',
      'product_type','therapeutic_class','pharmacological_class',
      'atc_code','hs_code','rxnorm_cui','snomed_code',
      'manufacturer','manufacturer_country','marketing_company',
      'agent_company','origin_country',
      'active_ingredient','dosage_form','strength',
      'route_of_administration','package_size','units_per_package',
      'storage_conditions','shelf_life_months','requires_refrigeration',
      'image_url','leaflet_url',
      'requires_prescription','is_controlled','controlled_schedule',
      'is_otc','is_orphan_drug',
      'regulatory_status','approval_date','withdrawal_date',
      'patent_expiry','exclusivity_expiry',
      'black_box_warning','driving_warning',
      'mechanism_of_action',
      'keywords','tags','notes',
      'unit','category','status',
    ];

    const jsonCols = [
      'image_urls',
      'indications','other_uses','contraindications','precautions',
      'boxed_warnings',
      'dosage','overdose',
      'side_effects','adverse_reactions',
      'drug_interactions','food_interactions','disease_interactions',
      'pregnancy_lactation','monitoring_tests',
      'pharmacokinetics','pharmacodynamics',
      'composition','excipients','substitutes',
      'registrations','barcodes','skus','synonyms','metadata',
    ];

    const fields = [];
    const params = [];
    let i = 1;

    for (const col of directCols) {
      if (data[col] !== undefined) {
        fields.push(`${col} = $${i++}`);
        params.push(data[col]);
      }
    }
    for (const col of jsonCols) {
      if (data[col] !== undefined) {
        fields.push(`${col} = $${i++}`);
        params.push(asJson(data[col]));
      }
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    params.push(id);
    const r = await pool.query(
      `UPDATE global_products
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      params
    );

    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // التحقق (verify) — بواسطة Admin
  // ═══════════════════════════════════════════════════════════════════════
  static async verify(id, userId) {
    const r = await pool.query(
      `UPDATE global_products
       SET is_verified = true,
           verified_by = $1,
           verified_at = NOW(),
           status      = 'active',
           updated_at  = NOW()
       WHERE id = $2
         AND is_verified = false
         AND status = 'pending_review'
       RETURNING *`,
      [userId, id]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // رفض/أرشفة منتج
  // ═══════════════════════════════════════════════════════════════════════
  static async archive(id, reason = null) {
    const r = await pool.query(
      `UPDATE global_products
       SET status = 'archived',
           notes = COALESCE($2, notes),
           updated_at = NOW()
       WHERE id = $1 AND status <> 'archived'
       RETURNING *`,
      [id, reason]
    );
    return r.rows[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // عدد المنتجات حسب الحالة (لـ Dashboard)
  // ═══════════════════════════════════════════════════════════════════════
  static async countByStatus() {
    const r = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM global_products
       GROUP BY status
       ORDER BY status`
    );
    return r.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // منتجات هذه الشركة (مساهماتها في الكتالوج)
  // ═══════════════════════════════════════════════════════════════════════
  static async listByCompany(companyId, { page = 1, limit = 20 } = {}) {
    const { page: pg, limit: lm, offset } = paginate(page, limit);
    const r = await pool.query(
      `SELECT ${this.SUMMARY_COLUMNS}
       FROM global_products
       WHERE created_by_company_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, lm, offset]
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM global_products
       WHERE created_by_company_id = $1`,
      [companyId]
    );
    const total = countRes.rows[0].total;
    return {
      items: r.rows,
      pagination: {
        page: pg, limit: lm, total,
        pages: Math.ceil(total / lm),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // دمج منتج مكرر في آخر
  //   - ينسخ created_by_company_id (للتوثيق)
  //   - يحوّل merged_into_id للمنتج المدمج
  //   - المنتجات المحلية (products.global_product_id) تُحوّل للمنتج الجديد
  // ═══════════════════════════════════════════════════════════════════════
  static async merge(duplicateId, targetId, userId) {
    if (duplicateId === targetId) {
      throw new Error('Cannot merge product with itself');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // التحقق من وجود المنتجين
      const check = await client.query(
        `SELECT id, status FROM global_products
         WHERE id IN ($1, $2)`,
        [duplicateId, targetId]
      );
      if (check.rowCount !== 2) {
        throw new Error('One or both products not found');
      }

      // حوّل كل المنتجات المحلية المرتبطة بالمكرر إلى الهدف
      await client.query(
        `UPDATE products
         SET global_product_id = $1
         WHERE global_product_id = $2`,
        [targetId, duplicateId]
      );

      // أرشف المكرر وأشِر إلى الهدف
      await client.query(
        `UPDATE global_products
         SET status = 'merged',
             merged_into_id = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [targetId, duplicateId]
      );

      await client.query('COMMIT');

      return { merged: duplicateId, into: targetId, merged_by: userId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = GlobalProduct;