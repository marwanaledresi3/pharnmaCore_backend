// services/helpers/pricing.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يحسب سعر البيع من سعر الشراء ونسبة الزيادة.
 * markup = 20 → selling = cost × 1.20
 */
function computeSellingPrice(costPrice, markupPercentage) {
  const cost = Number(costPrice) || 0;
  const markup = Number(markupPercentage) || 0;

  if (cost <= 0) return 0;
  return round2(cost * (1 + markup / 100));
}

/**
 * يجلب نسبة الزيادة الفعلية للمنتج:
 * - products.markup_percentage إذا موجود
 * - وإلا: companies.default_markup_percentage
 */
async function getEffectiveMarkup(client, { companyId, productId }) {
  const r = await client.query(
    `SELECT
       p.markup_percentage AS product_markup,
       c.default_markup_percentage AS company_markup
     FROM products p
     JOIN companies c ON c.id = p.company_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [productId, companyId]
  );

  if (!r.rowCount) {
    throw new Error(`Product ${productId} not found`);
  }

  const row = r.rows[0];
  const effective =
    row.product_markup != null
      ? Number(row.product_markup)
      : Number(row.company_markup) || 0;

  return {
    productMarkup: row.product_markup != null ? Number(row.product_markup) : null,
    companyMarkup: Number(row.company_markup) || 0,
    effective,
  };
}

/**
 * يعيد حساب سعر البيع لمنتج بعد تغيّر التكلفة.
 * - إذا pricing_policy = 'fixed' → لا تغيير
 * - إذا pricing_policy = 'auto_markup' → selling = cost × (1 + markup/100)
 * - يسجل في product_price_history
 * - يعيد { old_selling, new_selling, markup, updated }
 */
async function recalculateSellingPrice(client, {
  companyId,
  productId,
  newCostPrice,
  changeSource = 'purchase',
  referenceId = null,
  userId = null,
}) {
  // 1) اقرأ سياسة التسعير + الأسعار الحالية
  const cur = await client.query(
    `SELECT p.selling_price, p.cost_price, p.pricing_policy,
            p.markup_percentage,
            c.default_markup_percentage
     FROM products p
     JOIN companies c ON c.id = p.company_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [productId, companyId]
  );
  if (!cur.rowCount) {
    throw new Error(`Product ${productId} not found`);
  }

  const product = cur.rows[0];
  const oldCost = Number(product.cost_price) || 0;
  const oldSelling = Number(product.selling_price) || 0;
  const policy = product.pricing_policy || 'auto_markup';

  // 2) احسب markup الفعلي
  const markup =
    product.markup_percentage != null
      ? Number(product.markup_percentage)
      : Number(product.default_markup_percentage) || 0;

  // 3) اقرأ min_selling_price (إن وُجد)
  const minPriceRes = await client.query(
    `SELECT MIN(min_selling_price) AS min_price
     FROM product_units
     WHERE product_id = $1 AND min_selling_price IS NOT NULL`,
    [productId]
  );
  const minPrice = minPriceRes.rows[0]?.min_price;
  const minPriceNum = minPrice != null ? Number(minPrice) : null;

  // 4) pricing_policy = 'fixed' → لا تغيير
  if (policy === 'fixed') {
    await client.query(
      `UPDATE products SET cost_price = $1 WHERE id = $2 AND company_id = $3`,
      [newCostPrice, productId, companyId]
    );

    await client.query(
      `INSERT INTO product_price_history
         (company_id, product_id, change_source, reference_id,
          old_cost_price, new_cost_price, old_selling_price, new_selling_price,
          markup_applied, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId, productId, changeSource, referenceId,
        oldCost, newCostPrice, oldSelling, oldSelling,
        null, userId,
      ]
    );

    return {
      old_selling: oldSelling,
      new_selling: oldSelling,
      markup,
      updated: false,
      min_price_applied: false,
    };
  }

  // 5) auto_markup — احسب الجديد
  let newSelling = computeSellingPrice(newCostPrice, markup);
  let minPriceApplied = false;

  // ✅ احترم min_selling_price (اختر الأعلى)
  if (minPriceNum != null && newSelling < minPriceNum - 0.01) {
    newSelling = minPriceNum;
    minPriceApplied = true;
    console.warn(
      `[pricing] Product ${productId}: selling_price raised to min_selling_price (${minPriceNum})`
    );
  }

  // 6) تحديث
  await client.query(
    `UPDATE products
     SET cost_price = $1, selling_price = $2
     WHERE id = $3 AND company_id = $4`,
    [newCostPrice, newSelling, productId, companyId]
  );

  // 7) سجل في التاريخ
  await client.query(
    `INSERT INTO product_price_history
       (company_id, product_id, change_source, reference_id,
        old_cost_price, new_cost_price, old_selling_price, new_selling_price,
        markup_applied, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      companyId, productId, changeSource, referenceId,
      oldCost, newCostPrice, oldSelling, newSelling,
      markup, userId,
    ]
  );

  return {
    old_selling: oldSelling,
    new_selling: newSelling,
    markup,
    updated: true,
    min_price_applied: minPriceApplied,
  };
}

/**
 * يعيد حساب سعر البيع يدوياً (تعديل المستخدم).
 */
async function updateSellingPriceManually(client, {
  companyId,
  productId,
  newSellingPrice,
  userId,
}) {
  const cur = await client.query(
    `SELECT cost_price, selling_price FROM products
     WHERE id = $1 AND company_id = $2`,
    [productId, companyId]
  );
  if (!cur.rowCount) throw new Error('Product not found');

  const oldSelling = Number(cur.rows[0].selling_price) || 0;
  const cost = Number(cur.rows[0].cost_price) || 0;

  // احسب markup الفعلي (للتاريخ)
  const actualMarkup = cost > 0
    ? round2(((Number(newSellingPrice) - cost) / cost) * 100)
    : null;

  await client.query(
    `UPDATE products SET selling_price = $1
     WHERE id = $2 AND company_id = $3`,
    [newSellingPrice, productId, companyId]
  );

  await client.query(
    `INSERT INTO product_price_history
       (company_id, product_id, change_source, old_cost_price, new_cost_price,
        old_selling_price, new_selling_price, markup_applied, changed_by)
     VALUES ($1,$2,'manual',$3,$3,$4,$5,$6,$7)`,
    [companyId, productId, cost, oldSelling, newSellingPrice, actualMarkup, userId]
  );

  return { new_selling: newSellingPrice, actual_markup: actualMarkup };
}
/**
 * يتحقق أن سعر البيع ≥ الحد الأدنى للوحدة (min_selling_price).
 * إذا لم يُعرَّف min_selling_price → لا تحقق.
 */
async function assertMinSellingPrice(client, {
  productId,
  unitId,
  sellingPrice,
}) {
  if (!unitId) return; // بدون وحدة → لا تحقق

  const r = await client.query(
    `SELECT min_selling_price FROM product_units
     WHERE product_id = $1 AND unit_id = $2`,
    [productId, unitId]
  );

  if (!r.rowCount) {
    throw new ApiError(400, `Unit ${unitId} not configured for product ${productId}`);
  }

  const min = r.rows[0].min_selling_price;
  if (min == null) return;

  const price = Number(sellingPrice);
  const minNum = Number(min);

  if (!Number.isFinite(price)) {
    throw new ApiError(400, 'Invalid selling price');
  }

  if (price < minNum - 0.01) {
    throw new ApiError(
      400,
      `سعر البيع (${price}) أقل من الحد الأدنى (${minNum}) للمنتج ${productId}`
    );
  }
}

module.exports = {
  computeSellingPrice,
  getEffectiveMarkup,
  recalculateSellingPrice,
  updateSellingPriceManually,
  assertMinSellingPrice,   // ← جديد
};