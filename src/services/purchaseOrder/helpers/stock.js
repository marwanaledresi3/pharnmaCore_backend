const ApiError = require('../../../errors/ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يتحقق أن كل بند في الطلب متوفر في مخزون المورد.
 */
async function checkSupplierStockAvailability(client, { orderId, supplierCompanyId }) {
  const items = await client.query(
    `SELECT poi.id, poi.product_id, poi.supplier_product_id, poi.quantity,
            COALESCE(poi.supplier_product_id, poi.product_id) AS target_product_id
     FROM purchase_order_items poi
     WHERE poi.order_id = $1`,
    [orderId]
  );

  for (const item of items.rows) {
    const total = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
       FROM product_batches pb
       JOIN warehouses w ON w.id = pb.warehouse_id
       WHERE pb.product_id = $1 AND w.company_id = $2 AND w.is_active = TRUE
         AND pb.quantity > 0
         AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)`,
      [item.target_product_id, supplierCompanyId]
    );

    const reserved = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
       FROM stock_reservations
       WHERE product_id = $1 AND company_id = $2
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [item.target_product_id, supplierCompanyId]
    );

    const available = Number(total.rows[0].total) - Number(reserved.rows[0].reserved);
    const required = Number(item.quantity);

    if (available < required) {
      throw new ApiError(
        409,
        `الكمية غير متوفرة للصنف ${item.target_product_id}: مطلوب ${required}، متاح ${available} (بعد الحجوزات)`
      );
    }
  }
}

/**
 * استلام المشتري + خصم المورد (FIFO).
 */
async function confirmInventory(client, {
  order,
  buyerCompanyId,
  supplierCompanyId,
  userId,
}) {
  const itemsRes = await client.query(
    `SELECT poi.*, p.name AS product_name
     FROM purchase_order_items poi
     JOIN products p ON p.id = poi.product_id
     WHERE poi.order_id = $1`,
    [order.id]
  );

  const buyerWarehouseId = await getDefaultWarehouse(client, buyerCompanyId, 'buyer');

  let supplierWarehouseId = null;
  if (supplierCompanyId) {
    supplierWarehouseId = await getDefaultWarehouse(client, supplierCompanyId, 'supplier');
  }

  let totalCost = 0;
  const buyerBatches = [];
  const supplierConsumptions = [];

  for (const item of itemsRes.rows) {
    const qty = Number(item.quantity);
    const unitCost =
      Number(item.net_unit_price) > 0
        ? Number(item.net_unit_price)
        : Number(item.unit_price);

    // ═══ استلام المشتري ═══
    const receipt = await receiveBuyerStock(client, {
      buyerCompanyId,
      buyerWarehouseId,
      order,
      item,
      qty,
      unitCost,
      userId,
    });
    buyerBatches.push(receipt);
    totalCost += round2(unitCost * qty);

   
  }

  return { totalCost, buyerBatches, supplierConsumptions };
}

async function getDefaultWarehouse(client, companyId, label) {
  const r = await client.query(
    `SELECT id FROM warehouses
     WHERE company_id = $1 AND is_active = TRUE
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [companyId]
  );
  if (!r.rowCount) {
    throw new ApiError(400, `No active warehouse for ${label} company ${companyId}`);
  }
  return r.rows[0].id;
}

async function receiveBuyerStock(client, {
  buyerCompanyId,
  buyerWarehouseId,
  order,
  item,
  qty,
  unitCost,
  userId,
}) {
  const batchNumber =
    item.batch_number || `PO${order.order_number}-${item.id.slice(0, 8)}`;
  const expiry = item.expiry_date || '2099-12-31';

  const existing = await client.query(
    `SELECT id FROM product_batches
     WHERE product_id = $1 AND warehouse_id = $2 AND batch_number = $3
     FOR UPDATE`,
    [item.product_id, buyerWarehouseId, batchNumber]
  );

  let batchId;
  if (existing.rowCount) {
    await client.query(
      `UPDATE product_batches SET quantity = quantity + $1, cost_price = $2
       WHERE id = $3`,
      [qty, unitCost, existing.rows[0].id]
    );
    batchId = existing.rows[0].id;
  } else {
    const nb = await client.query(
      `INSERT INTO product_batches
         (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [buyerCompanyId, item.product_id, buyerWarehouseId, batchNumber, expiry, unitCost, qty]
    );
    batchId = nb.rows[0].id;
  }

  await client.query(
    `INSERT INTO stock_movements
       (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, movement_date, created_by)
     VALUES ($1,$2,$3,'in',$4,$5,'purchase',$6,$7,$8)`,
    [buyerCompanyId, buyerWarehouseId, batchId, qty, unitCost,
     order.id, order.order_date, userId]
  );

  return { product_id: item.product_id, batch_id: batchId, quantity: qty };
}

async function consumeSupplierStockFIFO(client, {
  supplierCompanyId,
  supplierWarehouseId,
  productId,
  quantity,
  referenceId,
  movementDate,
  userId,
}) {
  const batches = await client.query(
    `SELECT pb.id, pb.quantity, pb.cost_price, pb.expiry_date
     FROM product_batches pb
     JOIN warehouses w ON w.id = pb.warehouse_id
     WHERE pb.product_id = $1
       AND w.company_id = $2
       AND w.is_active = TRUE
       AND pb.quantity > 0
       AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)
     ORDER BY pb.expiry_date ASC NULLS LAST, pb.created_at ASC
     FOR UPDATE OF pb`,
    [productId, supplierCompanyId]
  );

  let remaining = Number(quantity);
  let totalCost = 0;
  const consumed = [];

  for (const b of batches.rows) {
    if (remaining <= 0) break;
    const available = Number(b.quantity);
    const take = Math.min(available, remaining);
    const cost = Number(b.cost_price) || 0;

    await client.query(
      `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`,
      [take, b.id]
    );

    await client.query(
      `INSERT INTO stock_movements
         (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
          reference_type, reference_id, movement_date, created_by)
       VALUES ($1,$2,$3,'out',$4,$5,'sales',$6,$7,$8)`,
      [supplierCompanyId, supplierWarehouseId, b.id, take, cost,
       referenceId, movementDate, userId]
    );

    consumed.push({ batch_id: b.id, quantity: take, cost_price: cost });
    totalCost += round2(cost * take);
    remaining -= take;
  }

  if (remaining > 0) {
    throw new ApiError(
      409,
      `الكمية غير متوفرة لدى المورد للصنف ${productId}: نقص ${remaining}`
    );
  }

  return { consumed, totalCost: round2(totalCost) };
}

module.exports = {
  checkSupplierStockAvailability,
  confirmInventory,
  consumeSupplierStockFIFO,
  getDefaultWarehouse,
};