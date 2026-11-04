const ApiError = require('../../../errors/ApiError');
const { round2 } = require('../helpers/rounding');

/**
 * يعدّل المخزون حسب نوع المرتجع:
 * - sale → إضافة إلى batch (استرجاع)
 * - purchase → خصم من batch (إرجاع للمورد)
 */
async function applyInventory(client, companyId, userId, ret, items) {
  console.log('[confirm:2] applyInventory START, items =', items.length);
  let totalCostChange = 0;

  for (const item of items) {
    console.log('[confirm:2] processing item:', item.product_id, 'qty:', item.quantity, 'type:', ret.return_type);

    if (ret.return_type === 'sales') {
      if (item.batch_id) {
        console.log('[confirm:2] sales - UPDATE batch (add) batch_id:', item.batch_id);
        await client.query(
          `UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`,
          [item.quantity, item.batch_id]
        );

        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           SELECT $1, b.warehouse_id, b.id, 'in', $2, b.cost_price,
                  'sale_return', $3, $4, $5
           FROM product_batches b WHERE b.id = $6`,
          [companyId, item.quantity, ret.id, ret.return_date, userId, item.batch_id]
        );
      } else {
        console.log('[confirm:2] sales - create new batch');
        const warehouseRes = await client.query(
          `SELECT id FROM warehouses
           WHERE company_id = $1 AND is_active = TRUE
           ORDER BY created_at ASC LIMIT 1`,
          [companyId]
        );
        if (!warehouseRes.rowCount) {
          throw new ApiError(400, 'No active warehouse');
        }
        const warehouseId = warehouseRes.rows[0].id;

        const newBatch = await client.query(
          `INSERT INTO product_batches
             (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
           VALUES ($1, $2, $3, $4, '2099-12-31', $5, $6)
           RETURNING id`,
          [
            companyId,
            item.product_id,
            warehouseId,
            `RTN-${ret.id.slice(0, 8)}-${item.id.slice(0, 4)}`,
            item.cost_price,
            item.quantity,
          ]
        );

        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           VALUES ($1, $2, $3, 'in', $4, $5, 'sale_return', $6, $7, $8)`,
          [
            companyId,
            warehouseId,
            newBatch.rows[0].id,
            item.quantity,
            item.cost_price,
            ret.id,
            ret.return_date,
            userId,
          ]
        );
      }
      totalCostChange = round2(
        totalCostChange + Number(item.quantity) * Number(item.cost_price)
      );
    } else {
      // purchase return → خصم من batch
      if (!item.batch_id) {
        throw new ApiError(
          400,
          `Purchase return requires batch_id for product ${item.product_id}`
        );
      }

      console.log('[confirm:2] purchase - FOR UPDATE batch_id:', item.batch_id);
      const batchRes = await client.query(
        `SELECT quantity, cost_price, warehouse_id FROM product_batches
         WHERE id = $1 FOR UPDATE`,
        [item.batch_id]
      );

      if (!batchRes.rowCount) {
        throw new ApiError(400, `Batch ${item.batch_id} not found`);
      }
      const batch = batchRes.rows[0];

      if (Number(batch.quantity) < Number(item.quantity)) {
        throw new ApiError(
          400,
          `Insufficient stock in batch (have ${batch.quantity}, need ${item.quantity})`
        );
      }

      await client.query(
        `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`,
        [item.quantity, item.batch_id]
      );

      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         VALUES ($1, $2, $3, 'out', $4, $5, 'purchase_return', $6, $7, $8)`,
        [
          companyId,
          batch.warehouse_id,
          item.batch_id,
          item.quantity,
          batch.cost_price,
          ret.id,
          ret.return_date,
          userId,
        ]
      );

      totalCostChange = round2(
        totalCostChange + Number(item.quantity) * Number(batch.cost_price)
      );
    }
  }

  console.log('[confirm:2] applyInventory DONE, totalCostChange =', totalCostChange);
  return { totalCostChange };
}

module.exports = { applyInventory };