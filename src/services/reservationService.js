// services/reservationService.js
const ApiError = require('../errors/ApiError');

class ReservationService {
  /* ============================================================
   * 1) حجز المخزون لطلب شراء
   *
   * - يحسب base_quantity = quantity × conversion_factor
   * - يحجز من batches FIFO داخل المستودع (إذا حُدِّد)
   * - يستخدم FOR UPDATE على product_batches لمنع over-reservation
   * - يستعلم reserved لكل batch في استعلام واحد (لا N+1)
   * ============================================================ */
  static async reserveForOrder(client, {
    orderId,
    supplierCompanyId,
    userId,
    ttlDays = 7,
    warehouseId = null,
  }) {
    // 1) اقرأ بنود الطلب
    const items = await client.query(
      `SELECT poi.id, poi.supplier_product_id, poi.product_id,
              poi.quantity, poi.conversion_factor
       FROM purchase_order_items poi
       WHERE poi.order_id = $1`,
      [orderId]
    );

    if (!items.rowCount) {
      throw new ApiError(400, 'No items to reserve');
    }

    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    for (const item of items.rows) {
      const targetProductId = item.supplier_product_id || item.product_id;

      const factor = Number(item.conversion_factor) || 1;
      const baseQuantity = Number(item.quantity) * factor;

      if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
        throw new ApiError(400, `Invalid quantity for item ${item.id}`);
      }

      // 2) احجز من الدفعات FIFO (مع FOR UPDATE)
      let batchesQuery;
      let batchesParams;

      if (warehouseId) {
        batchesQuery = `
          SELECT pb.id, pb.quantity, pb.expiry_date,
                 COALESCE((
                   SELECT SUM(sr.quantity)
                   FROM stock_reservations sr
                   WHERE sr.batch_id = pb.id
                     AND sr.status = 'active'
                     AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
                 ), 0)::numeric AS reserved
          FROM product_batches pb
          WHERE pb.product_id = $1
            AND pb.company_id = $2
            AND pb.warehouse_id = $3
            AND pb.quantity > 0
            AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)
          ORDER BY pb.expiry_date ASC NULLS LAST, pb.created_at ASC
          FOR UPDATE
        `;
        batchesParams = [targetProductId, supplierCompanyId, warehouseId];
      } else {
        batchesQuery = `
          SELECT pb.id, pb.quantity, pb.expiry_date,
                 COALESCE((
                   SELECT SUM(sr.quantity)
                   FROM stock_reservations sr
                   WHERE sr.batch_id = pb.id
                     AND sr.status = 'active'
                     AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
                 ), 0)::numeric AS reserved
          FROM product_batches pb
          WHERE pb.product_id = $1
            AND pb.company_id = $2
            AND pb.quantity > 0
            AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)
          ORDER BY pb.expiry_date ASC NULLS LAST, pb.created_at ASC
          FOR UPDATE
        `;
        batchesParams = [targetProductId, supplierCompanyId];
      }

      const batches = await client.query(batchesQuery, batchesParams);

      // 3) احسب الإجمالي المتاح بعد الحجوزات النشطة
      let totalAvailable = 0;
      for (const b of batches.rows) {
        totalAvailable += Number(b.quantity) - Number(b.reserved);
      }

      if (totalAvailable < baseQuantity - 0.001) {
        const scope = warehouseId
          ? `warehouse ${warehouseId}`
          : 'any warehouse';
        throw new ApiError(
          409,
          `الكمية غير متوفرة للحجز للصنف ${targetProductId} في ${scope}: ` +
          `مطلوب ${baseQuantity}، متاح ${totalAvailable}`
        );
      }

      // 4) احجز FIFO
      let remaining = baseQuantity;

      for (const batch of batches.rows) {
        if (remaining <= 0) break;

        const batchAvailable = Number(batch.quantity) - Number(batch.reserved);
        if (batchAvailable <= 0) continue;

        const take = Math.min(batchAvailable, remaining);

        await client.query(
          `INSERT INTO stock_reservations
             (company_id, product_id, batch_id, reference_type, reference_id,
              quantity, status, expires_at, created_by)
           VALUES ($1, $2, $3, 'purchase_order', $4, $5, 'active', $6, $7)`,
          [
            supplierCompanyId,
            targetProductId,
            batch.id,
            orderId,
            take,
            expiresAt,
            userId,
          ]
        );

        remaining -= take;
      }

      if (remaining > 0.001) {
        throw new ApiError(
          409,
          `تعذر حجز الكمية الكافية للصنف ${targetProductId} (نقص ${remaining})`
        );
      }
    }

    return { orderId, reserved: true, warehouseId: warehouseId || null };
  }

  /* ============================================================
   * 2) استهلاك الحجز (عند confirm)
   *
   * - يخصم من product_batches.quantity
   * - يتحقق من rowCount لمنع race conditions
   * - يسجّل stock_movements بـ reference_type = 'sale'
   *
   * ✅ FIX #4: يتحقق من صلاحية الدفعات قبل الاستهلاك.
   *    إذا كانت هناك دفعة منتهية → يرفض برسالة واضحة.
   * ============================================================ */
  static async consumeForOrder(client, {
    orderId,
    userId,
    orderDate,
  }) {
    // 1) جلب الحجوزات النشطة (بدون فلترة expiry — للفحص أولاً)
    const reservations = await client.query(
      `SELECT sr.*, pb.warehouse_id, pb.cost_price, pb.expiry_date
       FROM stock_reservations sr
       JOIN product_batches pb ON pb.id = sr.batch_id
       WHERE sr.reference_type = 'purchase_order'
         AND sr.reference_id = $1
         AND sr.status = 'active'
       FOR UPDATE OF sr, pb`,
      [orderId]
    );

    if (!reservations.rowCount) {
      return { consumed: 0, note: 'no reservations to consume' };
    }

    // 2) ✅ فحص الدفعات المنتهية
    const expiredBatches = reservations.rows.filter((r) => {
      if (!r.expiry_date) return false;
      const expiry = new Date(r.expiry_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return expiry <= today;
    });

    if (expiredBatches.length > 0) {
      const batchIds = [...new Set(expiredBatches.map((r) => r.batch_id))];
      throw new ApiError(
        409,
        `Cannot consume reservations: the following batch(es) have expired: ` +
        `${batchIds.join(', ')}. ` +
        `Please release and re-reserve the order with valid batches.`
      );
    }

    // 3) الاستهلاك
    for (const res of reservations.rows) {
      // خصم مع تحقق من rowCount
      const upd = await client.query(
        `UPDATE product_batches
         SET quantity = quantity - $1
         WHERE id = $2 AND quantity >= $1
         RETURNING id`,
        [res.quantity, res.batch_id]
      );

      if (!upd.rowCount) {
        throw new ApiError(
          409,
          `Insufficient stock for batch ${res.batch_id} — reservation ${res.id} cannot be consumed`
        );
      }

      // حركة مخزون
      await client.query(
        `INSERT INTO stock_movements
           (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, movement_date, created_by)
         VALUES ($1, $2, $3, 'out', $4, $5, 'sale', $6, $7, $8)`,
        [
          res.company_id,
          res.warehouse_id,
          res.batch_id,
          res.quantity,
          res.cost_price,
          orderId,
          orderDate,
          userId,
        ]
      );

      // علّم كمستهلك
      await client.query(
        `UPDATE stock_reservations
         SET status = 'consumed', consumed_at = NOW()
         WHERE id = $1`,
        [res.id]
      );
    }

    return { consumed: reservations.rowCount };
  }

  /* ============================================================
   * 3) تحرير الحجز (عند cancel/reject)
   * ============================================================ */
  static async releaseForOrder(client, { orderId, reason }) {
    const r = await client.query(
      `UPDATE stock_reservations
       SET status = 'released', released_at = NOW()
       WHERE reference_type = 'purchase_order'
         AND reference_id = $1
         AND status = 'active'
       RETURNING id`,
      [orderId]
    );
    return { released: r.rowCount, reason: reason || null };
  }

  /* ============================================================
   * 4) الكمية المتاحة
   * ============================================================ */
  static async _getAvailableStock(client, {
    companyId,
    productId,
    warehouseId = null,
  }) {
    const params = [productId, companyId];
    let whCond = '';

    if (warehouseId) {
      params.push(warehouseId);
      whCond = ` AND warehouse_id = $${params.length}`;
    }

    const total = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
       FROM product_batches
       WHERE product_id = $1
         AND company_id = $2
         AND quantity > 0
         AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
         ${whCond}`,
      params
    );

    // الحجوزات النشطة — نفلترها بنفس المستودع
    let reservedQuery;
    let reservedParams;

    if (warehouseId) {
      reservedQuery = `
        SELECT COALESCE(SUM(sr.quantity), 0)::numeric AS reserved
        FROM stock_reservations sr
        JOIN product_batches pb ON pb.id = sr.batch_id
        WHERE sr.product_id = $1
          AND sr.company_id = $2
          AND pb.warehouse_id = $3
          AND sr.status = 'active'
          AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
      `;
      reservedParams = [productId, companyId, warehouseId];
    } else {
      reservedQuery = `
        SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
        FROM stock_reservations
        WHERE product_id = $1
          AND company_id = $2
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > NOW())
      `;
      reservedParams = [productId, companyId];
    }

    const reserved = await client.query(reservedQuery, reservedParams);

    return Number(total.rows[0].total) - Number(reserved.rows[0].reserved);
  }

  static async getAvailableStock(client, { companyId, productId, warehouseId = null }) {
    return this._getAvailableStock(client, { companyId, productId, warehouseId });
  }

  /* ============================================================
   * 5) تنظيف الحجوزات المنتهية
   * ============================================================ */
  static async cleanupExpired(client) {
    const r = await client.query(
      `UPDATE stock_reservations
       SET status = 'expired', released_at = NOW()
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       RETURNING id`
    );
    return { expired: r.rowCount };
  }
}

module.exports = ReservationService;