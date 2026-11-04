const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * تحديث تكلفة/سعر بيع المنتج عند الاستلام (للمشتري).
 */
async function updateProductCost(client, { companyId, productId, unitCost }) {
  const p = await client.query(
    `SELECT profit_margin FROM products WHERE id = $1 AND company_id = $2`,
    [productId, companyId]
  );
  if (!p.rowCount) return;

  const margin = Number(p.rows[0].profit_margin) || 0;

  if (margin > 0 && unitCost > 0) {
    const suggested = round2(unitCost * (1 + margin / 100));
    await client.query(
      `UPDATE products SET cost_price = $1, selling_price = $2
       WHERE id = $3 AND company_id = $4`,
      [unitCost, suggested, productId, companyId]
    );
  } else {
    await client.query(
      `UPDATE products SET cost_price = $1 WHERE id = $2 AND company_id = $3`,
      [unitCost, productId, companyId]
    );
  }
}

module.exports = { updateProductCost };