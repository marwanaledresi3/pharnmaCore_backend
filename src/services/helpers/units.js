// services/helpers/units.js
/**
 * مساعدات وحدات القياس.
 *
 * المبدأ:
 * - كل الكميات في product_batches و stock_movements بـ الوحدة الأساسية.
 * - كل بند (sales_order_items, ...) له unit_id + conversion_factor.
 * - base_qty = quantity * conversion_factor
 * - إذا unit_id = NULL → السلوك القديم (quantity = base_qty، factor = 1)
 */

const ApiError = require('../../errors/ApiError');

/**
 * يحوّل كمية بوحدة معينة إلى الوحدة الأساسية.
 *
 * @param {object} client - pg client (داخل معاملة)
 * @param {object} params
 * @param {string} params.productId - المنتج
 * @param {string|null} params.unitId - الوحدة (NULL = السلوك القديم)
 * @param {number} params.quantity - الكمية بالوحدة المختارة
 * @returns {Promise<{baseQuantity: number, conversionFactor: number}>}
 */
async function resolveBaseQuantity(client, { productId, unitId, quantity }) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new ApiError(400, `Quantity must be >= 0 (got ${quantity})`);
  }

  // بدون وحدة → السلوك القديم
  if (!unitId) {
    return { baseQuantity: qty, conversionFactor: 1 };
  }

  // ابحث عن معامل التحويل
  const r = await client.query(
    `SELECT conversion_factor
     FROM product_units
     WHERE product_id = $1 AND unit_id = $2`,
    [productId, unitId]
  );

  if (!r.rowCount) {
    throw new ApiError(
      400,
      `Unit ${unitId} is not configured for product ${productId}`
    );
  }

  const factor = Number(r.rows[0].conversion_factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new ApiError(
      500,
      `Invalid conversion_factor (${r.rows[0].conversion_factor}) for product ${productId}`
    );
  }

  return { baseQuantity: qty * factor, conversionFactor: factor };
}

/**
 * يحوّل عدة بنود دفعة واحدة (batch).
 * يستخدم Promise.all لتقليل عدد الاستعلامات.
 *
 * @param {object} client
 * @param {Array<{product_id, unit_id, quantity}>} items
 * @returns {Promise<Array<{baseQuantity, conversionFactor}>>}
 */
async function resolveBaseQuantities(client, items) {
  return Promise.all(
    items.map((item) =>
      resolveBaseQuantity(client, {
        productId: item.product_id,
        unitId: item.unit_id,
        quantity: item.quantity,
      })
    )
  );
}

/**
 * يتحقق أن الوحدة موجودة في الشركة ونشطة.
 * يُستخدم عند إنشاء بنود جديدة.
 */
async function validateUnit(client, { companyId, unitId }) {
  if (!unitId) return;

  const r = await client.query(
    `SELECT id, is_active
     FROM units
     WHERE id = $1 AND company_id = $2`,
    [unitId, companyId]
  );

  if (!r.rowCount) {
    throw new ApiError(400, `Unit ${unitId} not found in this company`);
  }
  if (!r.rows[0].is_active) {
    throw new ApiError(400, `Unit ${unitId} is inactive`);
  }
}

/**
 * يجلب الوحدة الأساسية لمنتج.
 * يعيد null إذا لم تُعرَّف (يستخدم products.unit النصي).
 */
async function getBaseUnitId(client, { productId }) {
  const r = await client.query(
    `SELECT base_unit_id FROM products WHERE id = $1`,
    [productId]
  );
  return r.rowCount ? r.rows[0].base_unit_id : null;
}

/**
 * يعيد سعر الوحدة (بيع أو شراء) من product_units.
 * إذا لم يُعرَّف، يعيد null.
 */
async function getUnitPrice(client, { productId, unitId, kind = 'sale' }) {
  if (!unitId) return null;

  const col = kind === 'sale' ? 'sale_price' : 'purchase_price';
  const r = await client.query(
    `SELECT ${col} AS price
     FROM product_units
     WHERE product_id = $1 AND unit_id = $2`,
    [productId, unitId]
  );

  if (!r.rowCount) return null;
  const price = r.rows[0].price;
  return price != null ? Number(price) : null;
}

module.exports = {
  resolveBaseQuantity,
  resolveBaseQuantities,
  validateUnit,
  getBaseUnitId,
  getUnitPrice,
};