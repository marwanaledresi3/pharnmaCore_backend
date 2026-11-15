// services/purchaseOrder/helpers/totals.js
const ApiError = require('../../../errors/ApiError');
const { assertMinSellingPrice } = require('../../helpers/pricing');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function calculateTotals(client, {
  companyId,
  supplierCompanyId,
  isNetwork,
  items,
  invoiceDiscountRate = 0,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required');
  }

  const discountRate = Number(invoiceDiscountRate);
  if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100) {
    throw new ApiError(400, 'discount_rate must be between 0 and 100');
  }

  if (isNetwork && !supplierCompanyId) {
    throw new ApiError(400, 'Supplier company is required for network purchases');
  }

  const enrichedItems = [];

  for (const item of items) {
    if (!item.product_id) throw new ApiError(400, 'Product ID is required');

    const paidQty = Number(item.paid_quantity ?? item.quantity);
    const bonusQty = Number(item.bonus_quantity || 0);

    if (!Number.isFinite(paidQty) || paidQty <= 0)
      throw new ApiError(400, 'Paid quantity must be > 0');
    if (!Number.isFinite(bonusQty) || bonusQty < 0)
      throw new ApiError(400, 'Bonus quantity must be >= 0');

    let conversionFactor = 1;
    if (item.unit_id) {
      const unitResult = await client.query(
        `SELECT pu.conversion_factor
         FROM product_units pu
         JOIN products p ON p.id = pu.product_id
         WHERE pu.product_id = $1 AND pu.unit_id = $2 AND p.company_id = $3`,
        [item.product_id, item.unit_id, companyId]
      );
      if (!unitResult.rowCount) {
        throw new ApiError(400, `Unit not configured for product ${item.product_id}`);
      }
      conversionFactor = Number(unitResult.rows[0].conversion_factor);
      if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
        throw new ApiError(400, 'Invalid conversion_factor');
      }
    }

    const enriched = isNetwork
      ? await computeNetworkItem(client, { item, paidQty, supplierCompanyId, conversionFactor })
      : await computeLocalItem(client, { item, paidQty, companyId, conversionFactor });

    if (!enriched) throw new ApiError(400, `Failed to calculate product ${item.product_id}`);

    const lineTotal = Number(enriched.line_total);
    const taxAmount = Number(enriched.tax_amount);
    const taxRate = Number(enriched.tax_rate || 0);

    if (!Number.isFinite(lineTotal) || !Number.isFinite(taxAmount) || !Number.isFinite(taxRate) ||
        lineTotal < 0 || taxAmount < 0 || taxRate < 0 || taxRate > 100) {
      throw new ApiError(400, `Invalid totals for product ${item.product_id}`);
    }

    if (lineTotal - taxAmount < 0) {
      throw new ApiError(400, `Invalid tax amount for product ${item.product_id}`);
    }

    enriched.invoice_discount_amount = 0;
    enrichedItems.push(enriched);
  }

  const toCents = (value) => Math.round(Number(value) * 100);
  const fromCents = (value) => value / 100;

  const lines = enrichedItems.map((item, index) => {
    const lineTotalCents = toCents(item.line_total);
    const taxCents = toCents(item.tax_amount);
    return { index, item, baseCents: lineTotalCents - taxCents, taxRate: Number(item.tax_rate || 0) };
  });

  const subtotalCents = lines.reduce((sum, line) => sum + line.baseCents, 0);
  const discountCents = Math.round(subtotalCents * discountRate / 100);

  const allocations = lines.map((line) => {
    if (subtotalCents === 0) return { index: line.index, cents: 0, remainder: 0 };
    const numerator = discountCents * line.baseCents;
    return {
      index: line.index,
      cents: Math.floor(numerator / subtotalCents),
      remainder: numerator % subtotalCents,
    };
  });

  const remainingCents = discountCents - allocations.reduce((sum, a) => sum + a.cents, 0);
  const rankedAllocations = [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remainingCents; i++) rankedAllocations[i].cents += 1;

  const discountByIndex = new Map(allocations.map((a) => [a.index, a.cents]));

  let taxTotalCents = 0;
  for (const line of lines) {
    const item = line.item;
    const invoiceDiscountCents = discountByIndex.get(line.index) || 0;
    const discountedBaseCents = line.baseCents - invoiceDiscountCents;
    if (discountedBaseCents < 0) throw new ApiError(400, 'Invoice discount exceeds item value');

    const adjustedTaxCents = Math.round(discountedBaseCents * line.taxRate / 100);
    const adjustedLineTotalCents = discountedBaseCents + adjustedTaxCents;

    item.invoice_discount_amount = fromCents(invoiceDiscountCents);
    item.tax_amount = fromCents(adjustedTaxCents);
    item.line_total = fromCents(adjustedLineTotalCents);
    item.discount_amount = fromCents(invoiceDiscountCents);
    item.discount_rate = line.baseCents > 0
      ? round2((invoiceDiscountCents / line.baseCents) * 100)
      : 0;

    const totalQty = Number(item.quantity) || 0;
    item.net_unit_price = totalQty > 0
      ? round2(fromCents(discountedBaseCents) / totalQty)
      : 0;

    taxTotalCents += adjustedTaxCents;
  }

  const netAfterDiscountCents = subtotalCents - discountCents;
  const totalCents = netAfterDiscountCents + taxTotalCents;

  return {
    subtotal: fromCents(subtotalCents),
    discount_rate: discountRate,
    discount_amount: fromCents(discountCents),
    net_after_discount: fromCents(netAfterDiscountCents),
    tax_total: fromCents(taxTotalCents),
    total: fromCents(totalCents),
    enrichedItems,
  };
}

async function computeNetworkItem(client, { item, paidQty, supplierCompanyId, conversionFactor }) {
  if (!item.supplier_product_id) {
    throw new ApiError(400, `supplier_product_id is required for network supplier items (product ${item.product_id})`);
  }

  const baseQty = paidQty * conversionFactor;

  const stockRow = await client.query(
    `SELECT
       COALESCE(SUM(pb.quantity), 0)::numeric AS total_qty,
       COALESCE(
         (SELECT pb2.cost_price FROM product_batches pb2
          JOIN warehouses w2 ON w2.id = pb2.warehouse_id
          WHERE pb2.product_id = $1 AND w2.company_id = $2 AND w2.is_active = TRUE
            AND pb2.quantity > 0 AND (pb2.expiry_date IS NULL OR pb2.expiry_date > CURRENT_DATE)
          ORDER BY pb2.expiry_date ASC NULLS LAST LIMIT 1),
         0
       )::numeric AS supplier_price
     FROM product_batches pb
     JOIN warehouses w ON w.id = pb.warehouse_id
     WHERE pb.product_id = $1 AND w.company_id = $2 AND w.is_active = TRUE
       AND pb.quantity > 0 AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)`,
    [item.supplier_product_id, supplierCompanyId]
  );

  const totalQty = Number(stockRow.rows[0].total_qty);
  const supplierPriceBase = Number(stockRow.rows[0].supplier_price);

  if (!Number.isFinite(supplierPriceBase) || supplierPriceBase < 0) {
    throw new ApiError(409, `لا يوجد سعر معتمد للمورد للصنف ${item.product_id}`);
  }
  if (supplierPriceBase === 0) {
    throw new ApiError(409, `سعر المورد صفر للصنف ${item.product_id} — تحقق من دفعات المخزون`);
  }

  const pricePerSelectedUnit = round2(supplierPriceBase * conversionFactor);

  await assertMinSellingPrice(client, {
    productId: item.product_id,
    unitId: item.unit_id || null,
    sellingPrice: pricePerSelectedUnit,
  });

  const reservedRes = await client.query(
    `SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
     FROM stock_reservations
     WHERE product_id = $1 AND company_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [item.supplier_product_id, supplierCompanyId]
  );

  const reservedQty = Number(reservedRes.rows[0].reserved);
  const availableQty = totalQty - reservedQty;

  if (availableQty < baseQty - 0.001) {
    throw new ApiError(409, `الكمية غير متوفرة للصنف ${item.product_id}: مطلوب ${baseQty}، متاح ${availableQty} (منها ${reservedQty} محجوز)`);
  }

  const netSubtotal = round2(paidQty * pricePerSelectedUnit);

  return {
    product_id: item.product_id,
    supplier_product_id: item.supplier_product_id,
    unit_id: item.unit_id || null,
    conversion_factor: conversionFactor,
    paid_quantity: paidQty,
    bonus_quantity: 0,
    quantity: paidQty,
    base_quantity: round2(baseQty),
    unit_price: pricePerSelectedUnit,
    discount_rate: 0,
    discount_amount: 0,
    net_unit_price: pricePerSelectedUnit,
    tax_rate: 0,
    tax_amount: 0,
    line_total: netSubtotal,
    supplier_price_base: supplierPriceBase,
    batch_number: null,
    expiry_date: null,
    margin_rate: Number(item.margin_rate) || 0,
    computed_selling_price: Number(item.computed_selling_price) || 0,
    override_selling_price: item.override_selling_price ?? null,
    min_selling_price: Number(item.min_selling_price) || 0,
  };
}

async function computeLocalItem(client, { item, paidQty, companyId, conversionFactor }) {
  const product = await client.query(
    `SELECT id FROM products WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [item.product_id, companyId]
  );
  if (!product.rowCount) throw new ApiError(400, `Local product ${item.product_id} not found`);

  const bonusQty = Number(item.bonus_quantity ?? 0);
  const price = Number(item.unit_price);
  const discountRate = Number(item.discount_rate ?? 0);
  const taxRate = Number(item.tax_rate ?? 0);

  if (!Number.isFinite(bonusQty) || bonusQty < 0) throw new ApiError(400, 'Bonus quantity must be >= 0');
  if (!Number.isFinite(price) || price < 0) throw new ApiError(400, 'Price must be >= 0');
  if (discountRate < 0 || discountRate > 100) throw new ApiError(400, 'Discount rate must be between 0 and 100');
  if (taxRate < 0 || taxRate > 100) throw new ApiError(400, 'Tax rate must be between 0 and 100');

  const totalQty = paidQty + bonusQty;
  const baseQty = totalQty * conversionFactor;
  const grossSubtotal = paidQty * price;

  let discountAmt = Number(item.discount_amount ?? 0);
  if (!Number.isFinite(discountAmt) || discountAmt < 0) throw new ApiError(400, 'Discount amount must be >= 0');
  if (discountRate > 0) discountAmt = grossSubtotal * (discountRate / 100);
  discountAmt = Math.min(discountAmt, grossSubtotal);

  const netSubtotal = Math.max(0, grossSubtotal - discountAmt);
  const netUnitPrice = totalQty > 0 ? round2(netSubtotal / totalQty) : 0;
  const taxAmount = round2(netSubtotal * (taxRate / 100));
  const lineTotal = round2(netSubtotal + taxAmount);

  await assertMinSellingPrice(client, {
    productId: item.product_id,
    unitId: item.unit_id || null,
    sellingPrice: netUnitPrice,
  });

  return {
    product_id: item.product_id,
    supplier_product_id: item.supplier_product_id || null,
    unit_id: item.unit_id || null,
    conversion_factor: conversionFactor,
    paid_quantity: paidQty,
    bonus_quantity: bonusQty,
    quantity: totalQty,
    base_quantity: round2(baseQty),
    unit_price: price,
    discount_rate: discountRate,
    discount_amount: round2(discountAmt),
    net_unit_price: netUnitPrice,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    line_total: lineTotal,
    batch_number: item.batch_number || null,
    expiry_date: item.expiry_date || null,
    margin_rate: Number(item.margin_rate) || 0,
    computed_selling_price: Number(item.computed_selling_price) || 0,
    override_selling_price: item.override_selling_price ?? null,
    min_selling_price: Number(item.min_selling_price) || 0,
  };
}

async function recomputeOrderTotals(client, orderId) {
  const r = await client.query(
    `SELECT
       COALESCE(SUM(line_total), 0)::numeric AS total,
       COALESCE(SUM(tax_amount), 0)::numeric AS tax_total,
       COALESCE(SUM(invoice_discount_amount), 0)::numeric AS discount_amount
     FROM purchase_order_items WHERE order_id = $1`,
    [orderId]
  );
  const total = round2(r.rows[0].total);
  const taxTotal = round2(r.rows[0].tax_total);
  const discountAmount = round2(r.rows[0].discount_amount);
  return {
    subtotal: round2(total - taxTotal + discountAmount),
    discount_amount: discountAmount,
    net_after_discount: round2(total - taxTotal),
    tax_total: taxTotal,
    total,
  };
}

module.exports = {
  calculateTotals,
  recomputeOrderTotals,
  computeNetworkItem,
  computeLocalItem,
};