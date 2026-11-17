// services/purchaseOrder/helpers/stock.js
const ApiError = require('../../../errors/ApiError');
// const { formatDate } = require('../../../utils/dateUtils');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function checkSupplierStockAvailability(client, { orderId, supplierCompanyId }) {
  const items = await client.query(
    `SELECT poi.id, poi.product_id, poi.supplier_product_id, poi.paid_quantity,
            poi.bonus_quantity, poi.quantity, poi.conversion_factor
     FROM purchase_order_items poi WHERE poi.order_id = $1`,
    [orderId]
  );

  for (const item of items.rows) {
    const factor = Number(item.conversion_factor) || 1;
    if (factor <= 0) throw new ApiError(500, `Invalid conversion_factor for item ${item.id}`);

    const isNetwork = Boolean(item.supplier_product_id);
    const targetProductId = isNetwork ? item.supplier_product_id : item.product_id;
    const qtyForStock = isNetwork ? Number(item.paid_quantity) : Number(item.quantity);

    if (!Number.isFinite(qtyForStock) || qtyForStock <= 0) {
      throw new ApiError(500, `Invalid quantity for item ${item.id}`);
    }

    const requiredBase = qtyForStock * factor;

    const total = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
       FROM product_batches pb
       JOIN warehouses w ON w.id = pb.warehouse_id
       WHERE pb.product_id = $1 AND w.company_id = $2 AND w.is_active = TRUE
         AND pb.quantity > 0 AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)`,
      [targetProductId, supplierCompanyId]
    );

    const reserved = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
       FROM stock_reservations
       WHERE product_id = $1 AND company_id = $2 AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [targetProductId, supplierCompanyId]
    );

    const available = Number(total.rows[0].total) - Number(reserved.rows[0].reserved);

    if (available < requiredBase - 0.001) {
      throw new ApiError(409, `الكمية غير متوفرة للصنف ${targetProductId}: مطلوب ${requiredBase}، متاح ${available} (بعد الحجوزات)`);
    }
  }
}

async function confirmInventory(client, { order, buyerCompanyId, supplierCompanyId, userId }) {
  const itemsRes = await client.query(
    `SELECT poi.*, p.name AS product_name
     FROM purchase_order_items poi
     JOIN products p ON p.id = poi.product_id
     WHERE poi.order_id = $1 ORDER BY poi.id`,
    [order.id]
  );

  if (itemsRes.rowCount === 0) throw new ApiError(500, 'Order has no items');

  
  const buyerWarehouseId = await getDefaultWarehouse(client, buyerCompanyId, 'buyer');
  const rate = Number(order.exchange_rate) || 1;

  let totalCost = 0;
  const buyerBatches = [];

  for (const item of itemsRes.rows) {
    const factor = Number(item.conversion_factor) || 1;
    if (factor <= 0) throw new ApiError(500, `Invalid conversion_factor for item ${item.id}`);

    const baseQty = Number(item.quantity) * factor;
    if (!Number.isFinite(baseQty) || baseQty <= 0) throw new ApiError(500, `Invalid base quantity for item ${item.id}`);

    const unitCostBase = resolveUnitCostBase(item);
    const unitCostBaseInBaseCurrency = round2(unitCostBase * rate);

    const receipt = await receiveBuyerStock(client, {
      buyerCompanyId, buyerWarehouseId, order, item, baseQty,
      unitCostBase, unitCostBaseInBaseCurrency, rate, userId,
    });

    buyerBatches.push(receipt);
    totalCost += round2(unitCostBase * baseQty);
  }

  return { totalCost: round2(totalCost), buyerBatches };
}

function resolveUnitCostBase(item) {
  const factor = Number(item.conversion_factor) || 1;

  let pricePerSelectedUnit = Number(item.net_unit_price);
  if (!Number.isFinite(pricePerSelectedUnit) || pricePerSelectedUnit <= 0) {
    const lineTotal = Number(item.line_total);
    const taxAmount = Number(item.tax_amount);
    const totalQty = Number(item.quantity);
    if (totalQty > 0 && Number.isFinite(lineTotal) && Number.isFinite(taxAmount)) {
      pricePerSelectedUnit = round2((lineTotal - taxAmount) / totalQty);
    } else {
      pricePerSelectedUnit = Number(item.unit_price);
    }
  }

  if (!Number.isFinite(pricePerSelectedUnit) || pricePerSelectedUnit < 0) {
    throw new ApiError(500, `Invalid price for item ${item.id}`);
  }

  return round2(pricePerSelectedUnit / factor);
}

async function getDefaultWarehouse(client, companyId, label) {
  const r = await client.query(
    `SELECT id FROM warehouses WHERE company_id = $1 AND is_active = TRUE
     ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [companyId]
  );
  if (!r.rowCount) throw new ApiError(400, `No active warehouse for ${label} company ${companyId}`);
  return r.rows[0].id;
}

async function receiveBuyerStock(client, {
  buyerCompanyId, buyerWarehouseId, order, item, baseQty,
  unitCostBase, unitCostBaseInBaseCurrency, rate, userId,
}) {
  const batchNumber = resolveBatchNumber(item, order);
  const expiry = resolveExpiryDate(item);

  const existing = await client.query(
    `SELECT id, cost_price, cost_price_base, quantity
     FROM product_batches
     WHERE product_id = $1 AND warehouse_id = $2 AND batch_number = $3
     FOR UPDATE`,
    [item.product_id, buyerWarehouseId, batchNumber]
  );

  let batchId;

  if (existing.rowCount) {
    const oldQty = Number(existing.rows[0].quantity) || 0;
    const oldCostBase = Number(existing.rows[0].cost_price_base) || Number(existing.rows[0].cost_price) || 0;
    const oldCost = Number(existing.rows[0].cost_price) || 0;

    const newCostBase = (oldQty + baseQty) > 0
      ? round2((oldQty * oldCostBase + baseQty * unitCostBaseInBaseCurrency) / (oldQty + baseQty))
      : unitCostBaseInBaseCurrency;

    const newCost = (oldQty + baseQty) > 0
      ? round2((oldQty * oldCost + baseQty * unitCostBase) / (oldQty + baseQty))
      : unitCostBase;

    await client.query(
      `UPDATE product_batches SET quantity = quantity + $1, cost_price = $2, cost_price_base = $3 WHERE id = $4`,
      [baseQty, newCost, newCostBase, existing.rows[0].id]
    );

    batchId = existing.rows[0].id;
  } else {
    const nb = await client.query(
      `INSERT INTO product_batches
         (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, cost_price_base, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [buyerCompanyId, item.product_id, buyerWarehouseId, batchNumber, expiry, unitCostBase, unitCostBaseInBaseCurrency, baseQty]
    );
    batchId = nb.rows[0].id;
  }

  await client.query(
    `INSERT INTO stock_movements
       (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, movement_date, created_by)
     VALUES ($1, $2, $3, 'in', $4, $5, 'purchase', $6, $7, $8)`,
    [buyerCompanyId, buyerWarehouseId, batchId, baseQty, unitCostBase, order.id, order.order_date, userId]
  );

  return {
    product_id: item.product_id,
    batch_id: batchId,
    quantity: baseQty,
    unit_cost: unitCostBase,
    unit_cost_base: unitCostBaseInBaseCurrency,
  };
}

function resolveBatchNumber(item, order) {
  if (item.batch_number && String(item.batch_number).trim()) return String(item.batch_number).trim();
  return `PO${order.order_number}-${item.id}`;
}

function resolveExpiryDate(item) {
  if (!item.expiry_date) {
    return '2099-12-31';
  }

  // 1) استخرج 'YYYY-MM-DD' نصياً (بدون أي Date object!)
  const expiryStr = extractISODate(item.expiry_date);
  if (!expiryStr) {
    throw new ApiError(400,
      `Invalid expiry_date for item ${item.id}: ${item.expiry_date}`);
  }

  // 2) today كـ 'YYYY-MM-DD' **بتوقيت UTC** (يتسق مع CURRENT_DATE في DB)
  const today = new Date();
  const todayStr =
    today.getUTCFullYear() + '-' +
    String(today.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(today.getUTCDate()).padStart(2, '0');

  // 3) مقارنة نصية ISO
  if (expiryStr < todayStr) {
    throw new ApiError(400,
      `Expiry date (${expiryStr}) is in the past for item ${item.id} ` +
      `(today=${todayStr})`);
  }

  return expiryStr;
}

// helper: يستخرج 'YYYY-MM-DD' من أي مصدر
function extractISODate(value) {
  if (!value) return null;

  // (أ) Date object (نادراً — بعد setTypeParser)
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // (ب) string 'YYYY-MM-DD' — الحالة عندك
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // 'DD/MM/YYYY'
    const m2 = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
    return null;
  }

  return null;
}


module.exports = {
  checkSupplierStockAvailability, confirmInventory, getDefaultWarehouse,
  resolveUnitCostBase, resolveBatchNumber, resolveExpiryDate,
};