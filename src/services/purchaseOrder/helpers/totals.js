const ApiError = require('../../../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يحسب الإجماليات ويعيد البنود المُثراة.
 *
 * للمورد الشبكي:
 *   - unit_price من دفعات المورد (FIFO)
 *   - bonus/discount/tax = 0 (المورد يعدّلها عند approve)
 *   - يتحقق من توفر الكمية
 *
 * للمورد المحلي:
 *   - unit_price من العميل
 *   - bonus/discount/tax من العميل
 */
async function calculateTotals(client, { companyId, supplierCompanyId, isNetwork, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required');
  }

  const enrichedItems = [];
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const paidQty = Number(item.paid_quantity ?? item.quantity);
    if (!Number.isFinite(paidQty) || paidQty <= 0) {
      throw new ApiError(400, 'Paid quantity must be > 0');
    }

    if (isNetwork) {
      const enriched = await computeNetworkItem(client, {
        item,
        paidQty,
        supplierCompanyId,
      });
      enrichedItems.push(enriched);
      subtotal += enriched.line_total - enriched.tax_amount;
      taxTotal += enriched.tax_amount;
    } else {
      const enriched = await computeLocalItem(client, {
        item,
        paidQty,
        companyId,
      });
      enrichedItems.push(enriched);
      subtotal += enriched.line_total - enriched.tax_amount;
      taxTotal += enriched.tax_amount;
    }
  }

  return {
    subtotal: round2(subtotal),
    tax_total: round2(taxTotal),
    total: round2(subtotal + taxTotal),
    enrichedItems,
  };
}

async function computeNetworkItem(client, { item, paidQty, supplierCompanyId }) {
  if (!item.supplier_product_id) {
    throw new ApiError(
      400,
      `supplier_product_id is required for network supplier items (product ${item.product_id})`
    );
  }

  // 1) اقرأ السعر (FIFO) + إجمالي المخزون
  const stockRow = await client.query(
    `SELECT
       COALESCE(SUM(pb.quantity), 0)::numeric AS total_qty,
       COALESCE(
         (SELECT pb2.cost_price FROM product_batches pb2
          JOIN warehouses w2 ON w2.id = pb2.warehouse_id
          WHERE pb2.product_id = $1 AND w2.company_id = $2 AND w2.is_active = TRUE
            AND pb2.quantity > 0
            AND (pb2.expiry_date IS NULL OR pb2.expiry_date > CURRENT_DATE)
          ORDER BY pb2.expiry_date ASC NULLS LAST LIMIT 1),
         0
       )::numeric AS supplier_price
     FROM product_batches pb
     JOIN warehouses w ON w.id = pb.warehouse_id
     WHERE pb.product_id = $1 AND w.company_id = $2 AND w.is_active = TRUE
       AND pb.quantity > 0
       AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)`,
    [item.supplier_product_id, supplierCompanyId]
  );

  const totalQty = Number(stockRow.rows[0].total_qty);
  const supplierPrice = Number(stockRow.rows[0].supplier_price);

  // 2) اقرأ الحجوزات النشطة
  const reservedRes = await client.query(
    `SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
     FROM stock_reservations
     WHERE product_id = $1
       AND company_id = $2
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [item.supplier_product_id, supplierCompanyId]
  );

  const reservedQty = Number(reservedRes.rows[0].reserved);
  const availableQty = totalQty - reservedQty;

  // 3) تحقق
  if (availableQty < paidQty) {
    throw new ApiError(
      409,
      `الكمية غير متوفرة للصنف ${item.product_id}: مطلوب ${paidQty}، متاح ${availableQty} (منها ${reservedQty} محجوز)`
    );
  }

  if (!Number.isFinite(supplierPrice) || supplierPrice < 0) {
    throw new ApiError(409, `لا يوجد سعر معتمد للمورد للصنف ${item.product_id}`);
  }

  // 4) احسب
  const finalQty = paidQty;  // لا بونص
  const netSubtotal = paidQty * supplierPrice;
  const netUnitPrice = finalQty > 0 ? round2(netSubtotal / finalQty) : 0;

  return {
    product_id: item.product_id,
    supplier_product_id: item.supplier_product_id,
    paid_quantity: paidQty,
    bonus_quantity: 0,
    quantity: finalQty,
    unit_price: round2(supplierPrice),
    discount_rate: 0,
    discount_amount: 0,
    net_unit_price: netUnitPrice,
    tax_rate: 0,
    tax_amount: 0,
    line_total: round2(netSubtotal),
    batch_number: null,
    expiry_date: null,
  };
}

async function computeLocalItem(client, { item, paidQty, companyId }) {
  const product = await client.query(
    `SELECT id FROM products
     WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [item.product_id, companyId]
  );
  if (!product.rowCount) {
    throw new ApiError(400, `Local product ${item.product_id} not found`);
  }

  const bonusQty = Number(item.bonus_quantity ?? 0);
  const price = Number(item.unit_price);
  const discountRate = Number(item.discount_rate ?? 0);
  const taxRate = Number(item.tax_rate ?? 0);

  if (!Number.isFinite(bonusQty) || bonusQty < 0)
    throw new ApiError(400, 'Bonus quantity must be >= 0');
  if (!Number.isFinite(price) || price < 0)
    throw new ApiError(400, 'Price must be >= 0');
  if (discountRate < 0 || discountRate > 100)
    throw new ApiError(400, 'Discount rate must be between 0 and 100');
  if (taxRate < 0 || taxRate > 100)
    throw new ApiError(400, 'Tax rate must be between 0 and 100');

  const totalQty = paidQty + bonusQty;
  const grossSubtotal = paidQty * price;

  let discountAmt = Number(item.discount_amount ?? 0);
  if (!Number.isFinite(discountAmt) || discountAmt < 0)
    throw new ApiError(400, 'Discount amount must be >= 0');

  if (discountRate > 0) {
    discountAmt = grossSubtotal * (discountRate / 100);
  }
  discountAmt = Math.min(discountAmt, grossSubtotal);

  const netSubtotal = Math.max(0, grossSubtotal - discountAmt);
  const netUnitPrice = totalQty > 0 ? round2(netSubtotal / totalQty) : 0;
  const taxAmount = netSubtotal * (taxRate / 100);
  const lineTotal = netSubtotal + taxAmount;

  return {
    product_id: item.product_id,
    supplier_product_id: item.supplier_product_id || null,
    paid_quantity: paidQty,
    bonus_quantity: bonusQty,
    quantity: totalQty,
    unit_price: price,
    discount_rate: discountRate,
    discount_amount: round2(discountAmt),
    net_unit_price: netUnitPrice,
    tax_rate: taxRate,
    tax_amount: round2(taxAmount),
    line_total: round2(lineTotal),
    batch_number: item.batch_number || null,
    expiry_date: item.expiry_date || null,
  };
}

/**
 * يعيد حساب مجاميع الطلب من بنوده (بعد تعديلات المورد).
 */
async function recomputeOrderTotals(client, orderId) {
  const r = await client.query(
    `SELECT
       COALESCE(SUM(
         CASE WHEN line_total > 0 THEN line_total - tax_amount ELSE 0 END
       ), 0)::numeric AS subtotal,
       COALESCE(SUM(tax_amount), 0)::numeric AS tax_total,
       COALESCE(SUM(line_total), 0)::numeric AS total
     FROM purchase_order_items
     WHERE order_id = $1`,
    [orderId]
  );
  return {
    subtotal: round2(r.rows[0].subtotal),
    tax_total: round2(r.rows[0].tax_total),
    total: round2(r.rows[0].total),
  };
}

module.exports = {
  calculateTotals,
  recomputeOrderTotals,
  computeNetworkItem,
  computeLocalItem,
};