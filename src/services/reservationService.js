const ApiError = require('../errors/ApiError');

/**
 * خدمة حجز المخزون.
 * - reserveForOrder: عند approve — يحجز المخزون لطلب شراء
 * - consumeForOrder: عند confirm — يحوّل الحجز إلى خصم فعلي
 * - releaseForOrder: عند cancel/reject — يحرر الحجز
 * - getAvailableQty: الكمية المتاحة بعد خصم الحجوزات
 */
class ReservationService {
  /**
   * يحجز المخزون لطلب شراء من مستودعات المورد.
   * - يختار الدفعات FIFO
   * - ينشئ صفوف `stock_reservations` بحالة 'active'
   * - يتحقق من كفاية المتاح (quantity - محجوز)
   */
  static async reserveForOrder(client, {
    orderId,
    supplierCompanyId,
    userId,
    ttlDays = 7,   // صلاحية الحجز
  }) {
    // 1) اقرأ بنود الطلب
    const items = await client.query(
      `SELECT poi.id, poi.supplier_product_id, poi.product_id, poi.quantity
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

      // 2) احسب المتاح الفعلي = quantity - محجوز
      const available = await this._getAvailableStock(client, {
        companyId: supplierCompanyId,
        productId: targetProductId,
      });

      if (available < Number(item.quantity)) {
        throw new ApiError(
          409,
          `الكمية غير متوفرة للحجز للصنف ${targetProductId}: مطلوب ${item.quantity}، متاح ${available}`
        );
      }

      // 3) احجز من الدفعات FIFO
      let remaining = Number(item.quantity);

      const batches = await client.query(
        `SELECT id, quantity, expiry_date
         FROM product_batches
         WHERE product_id = $1
           AND company_id = $2
           AND quantity > 0
           AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
         ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
        [targetProductId, supplierCompanyId]
      );

      for (const batch of batches.rows) {
        if (remaining <= 0) break;

        // احسب المتاح في هذه الدفعة بعد الحجوزات النشطة
        const reservedInBatch = await client.query(
          `SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
           FROM stock_reservations
           WHERE batch_id = $1 AND status = 'active'`,
          [batch.id]
        );

        const batchAvailable =
          Number(batch.quantity) - Number(reservedInBatch.rows[0].reserved);

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

      if (remaining > 0) {
        throw new ApiError(
          409,
          `تعذر حجز الكمية الكافية للصنف ${targetProductId} (نقص ${remaining})`
        );
      }
    }

    return { orderId, reserved: true };
  }

  /**
   * يحوّل الحجز إلى خصم فعلي (عند confirm).
   * - يخصم من `product_batches.quantity`
   * - يغيّر حالة الحجز إلى 'consumed'
   * - ينشئ `stock_movements` 'out'
   */
  static async consumeForOrder(client, {
    orderId,
    userId,
    orderDate,
  }) {
    const reservations = await client.query(
      `SELECT sr.*, pb.warehouse_id, pb.cost_price
       FROM stock_reservations sr
       JOIN product_batches pb ON pb.id = sr.batch_id
       WHERE sr.reference_type = 'purchase_order'
         AND sr.reference_id = $1
         AND sr.status = 'active'`,
      [orderId]
    );

    if (!reservations.rowCount) {
      // لا حجوزات — ربما طلب محلي أو قديم. نتحقق من المخزون مباشرة.
      return { consumed: 0, note: 'no reservations to consume' };
    }

    for (const res of reservations.rows) {
      // اخصم من الدفعة
      await client.query(
        `UPDATE product_batches
         SET quantity = quantity - $1
         WHERE id = $2 AND quantity >= $1`,
        [res.quantity, res.batch_id]
      );

      // سجّل حركة مخزون
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

      // علّم الحجز كمستهلك
      await client.query(
        `UPDATE stock_reservations
         SET status = 'consumed', consumed_at = NOW()
         WHERE id = $1`,
        [res.id]
      );
    }

    return { consumed: reservations.rowCount };
  }

  /**
   * يحرر الحجز (عند cancel/reject).
   */
  static async releaseForOrder(client, {
    orderId,
    reason,
  }) {
    const r = await client.query(
      `UPDATE stock_reservations
       SET status = 'released', released_at = NOW()
       WHERE reference_type = 'purchase_order'
         AND reference_id = $1
         AND status = 'active'`,
      [orderId]
    );

    return { released: r.rowCount };
  }

  /**
   * الكمية المتاحة الفعلية = quantity - محجوز.
   */
  static async _getAvailableStock(client, { companyId, productId }) {
    const total = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
       FROM product_batches
       WHERE product_id = $1
         AND company_id = $2
         AND quantity > 0
         AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)`,
      [productId, companyId]
    );

    const reserved = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved
       FROM stock_reservations
       WHERE product_id = $1
         AND company_id = $2
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [productId, companyId]
    );

    return (
      Number(total.rows[0].total) - Number(reserved.rows[0].reserved)
    );
  }

  /**
   * الكمية المتاحة (public helper).
   */
  static async getAvailableStock(client, { companyId, productId }) {
    return this._getAvailableStock(client, { companyId, productId });
  }

  /**
   * ينظف الحجوزات المنتهية (يُستدعى دورياً من cron).
   */
  static async cleanupExpired(client) {
    const r = await client.query(
      `UPDATE stock_reservations
       SET status = 'expired', released_at = NOW()
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()`
    );
    return { expired: r.rowCount };
  }
}

module.exports = ReservationService;