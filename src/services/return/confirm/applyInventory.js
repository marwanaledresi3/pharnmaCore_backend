// services/return/confirm/applyInventory.js
const ApiError = require('../../../errors/ApiError');
const { round2 } = require('../helpers/rounding');

/**
 * يعدّل المخزون حسب نوع المرتجع — محصّن
 *
 * - مرتجع بيع: إضافة كمية (مع دفعة أصلية أو جديدة)
 * - مرتجع شراء: خصم كمية (مع دفعة إلزامية)
 *
 * ✅ يستخدم return_type === 'sale' (بدون s) — متوافق مع CHECK
 */
async function applyInventory(client, companyId, userId, ret, items) {
  const rate = Number(ret.exchange_rate) || 1;
  let totalCostChange = 0;

  for (const item of items) {
    const factor = Number(item.conversion_factor) || 1;
    const baseQty = round2(Number(item.quantity) * factor);

    if (baseQty <= 0) {
      throw new ApiError(400, `Invalid quantity for item ${item.id}`);
    }

    // ═══ مرتجع بيع ══════════════════════════════════════════════════
    if (ret.return_type === 'sale') {
      if (item.batch_id) {
        // 1) قفل الدفعة
        const batchRes = await client.query(
          `SELECT id, warehouse_id, cost_price, cost_price_base
           FROM product_batches
           WHERE id = $1 AND company_id = $2
           FOR UPDATE`,
          [item.batch_id, companyId]
        );
        if (!batchRes.rowCount) {
          throw new ApiError(400, `Batch ${item.batch_id} not found`);
        }
        const batch = batchRes.rows[0];

        // 2) إضافة كمية
        const upd = await client.query(
          `UPDATE product_batches
           SET quantity = quantity + $1
           WHERE id = $2 AND company_id = $3
           RETURNING id`,
          [baseQty, item.batch_id, companyId]
        );
        if (!upd.rowCount) {
          throw new ApiError(500, `Failed to update batch ${item.batch_id}`);
        }

        // 3) حركة مخزون
        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           VALUES ($1, $2, $3, 'in', $4, $5, 'sale_return', $6, $7, $8)`,
          [
            companyId, batch.warehouse_id, item.batch_id, baseQty,
            batch.cost_price_base || batch.cost_price || 0,
            ret.id, ret.return_date, userId,
          ]
        );

        const unitCostBase = Number(batch.cost_price_base)
          || round2(Number(batch.cost_price || 0) * rate);
        totalCostChange = round2(totalCostChange + baseQty * unitCostBase);
      } else {
        // بدون دفعة → إنشاء دفعة جديدة
        const warehouseRes = await client.query(
          `SELECT id FROM warehouses
           WHERE company_id = $1 AND is_active = TRUE
           ORDER BY is_default DESC, created_at ASC LIMIT 1`,
          [companyId]
        );
        if (!warehouseRes.rowCount) {
          throw new ApiError(400, 'No active warehouse');
        }
        const warehouseId = warehouseRes.rows[0].id;

        // ✅ fallback: item.cost_price → products.cost_price → unit_price
        let unitCostBase = Number(item.cost_price);
        if (!unitCostBase || unitCostBase <= 0) {
          const prodRes = await client.query(
            `SELECT cost_price FROM products WHERE id = $1 AND company_id = $2`,
            [item.product_id, companyId]
          );
          unitCostBase = prodRes.rowCount
            ? Number(prodRes.rows[0].cost_price) || 0
            : 0;
        }
        if (!unitCostBase || unitCostBase <= 0) {
          unitCostBase = round2(Number(item.unit_price || 0) * rate / factor);
        }

        // ✅ تاريخ انتهاء: من البند إن وُجد
        const expiryDate = item.expiry_date || '2099-12-31';

        const newBatch = await client.query(
          `INSERT INTO product_batches
             (company_id, product_id, warehouse_id, batch_number, expiry_date,
              cost_price, cost_price_base, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            companyId, item.product_id, warehouseId,
            `RTN-${ret.id.slice(0, 8)}-${item.id.slice(0, 8)}`,
            expiryDate,
            unitCostBase, unitCostBase, baseQty,
          ]
        );

        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           VALUES ($1, $2, $3, 'in', $4, $5, 'sale_return', $6, $7, $8)`,
          [
            companyId, warehouseId, newBatch.rows[0].id, baseQty,
            unitCostBase, ret.id, ret.return_date, userId,
          ]
        );

        totalCostChange = round2(totalCostChange + baseQty * unitCostBase);
      }
    } else {
      // ═══ مرتجع شراء ═══════════════════════════════════════════════
      if (!item.batch_id) {
        throw new ApiError(
          400,
          `Purchase return requires batch_id for product ${item.product_id}`
        );
      }

      const batchRes = await client.query(
        `SELECT quantity, cost_price, cost_price_base, warehouse_id
         FROM product_batches
         WHERE id = $1 AND company_id = $2
         FOR UPDATE`,
        [item.batch_id, companyId]
      );
      if (!batchRes.rowCount) {
        throw new ApiError(400, `Batch ${item.batch_id} not found`);
      }
      const batch = batchRes.rows[0];

      if (Number(batch.quantity) < baseQty) {
        throw new ApiError(
          400,
          `Insufficient stock in batch (have ${batch.quantity}, need ${baseQty})`
        );
      }

      const upd = await client.query(
        `UPDATE product_batches
         SET quantity = quantity - $1
         WHERE id = $2 AND company_id = $3
         RETURNING id`,
        [baseQty, item.batch_id, companyId]
      );
      if (!upd.rowCount) {
        throw new ApiError(500, `Failed to update batch ${item.batch_id}`);
      }

      const unitCostBase = Number(batch.cost_price_base)
        || round2(Number(batch.cost_price || 0) * rate);

      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         VALUES ($1, $2, $3, 'out', $4, $5, 'purchase_return', $6, $7, $8)`,
        [
          companyId, batch.warehouse_id, item.batch_id, baseQty,
          unitCostBase, ret.id, ret.return_date, userId,
        ]
      );

      totalCostChange = round2(totalCostChange + baseQty * unitCostBase);
    }
  }

  return { totalCostChange };
}

module.exports = { applyInventory };