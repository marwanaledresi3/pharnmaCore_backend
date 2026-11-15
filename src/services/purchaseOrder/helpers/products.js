// services/purchaseOrder/helpers/products.js
const { recalculateSellingPrice } = require('../../helpers/pricing');

/**
 * يُستدعى عند استلام دفعة من المورد.
 * - يُحدّث cost_price للمنتج (آخر تكلفة شراء).
 * - يُعيد حساب selling_price تلقائياً إذا pricing_policy = 'auto_markup'.
 * - يسجل في product_price_history.
 *
 * @param {object} client
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.productId
 * @param {number} params.unitCost       - التكلفة الجديدة للوحدة الأساسية
 * @param {string} [params.referenceId]  - purchase_order id
 * @param {string} [params.userId]
 * @returns {Promise<{old_cost, new_cost, old_selling, new_selling, markup, updated}>}
 */
async function updateProductCost(client, {
  companyId,
  productId,
  unitCost,
  referenceId = null,
  userId = null,
}) {
  const newCost = Number(unitCost);
  if (!Number.isFinite(newCost) || newCost < 0) {
    throw new Error(`Invalid unitCost (${unitCost}) for product ${productId}`);
  }

  const result = await recalculateSellingPrice(client, {
    companyId,
    productId,
    newCostPrice: newCost,
    changeSource: 'purchase',
    referenceId,
    userId,
  });

  return {
    old_cost: null,
    new_cost: newCost,
    ...result,
  };
}

module.exports = { updateProductCost };