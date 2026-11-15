
const { pool } = require('../config/pool');

class StockAdjustment {
  static async getById(client, companyId, id) {
    const headRes = await client.query(
      `SELECT sa.*,
              w.name AS warehouse_name,
              u.name AS created_by_name,
              cu.name AS confirmed_by_name,
              x.name AS cancelled_by_name
       FROM stock_adjustments sa
       LEFT JOIN warehouses w ON w.id = sa.warehouse_id
       LEFT JOIN users u ON u.id = sa.created_by
       LEFT JOIN users cu ON cu.id = sa.confirmed_by
       LEFT JOIN users x ON x.id = sa.cancelled_by
       WHERE sa.id = $1 AND sa.company_id = $2`,
      [id, companyId]
    );

    const head = headRes.rows[0];
    if (!head) return null;

    const itemsRes = await client.query(
      `SELECT sai.*,
              p.name AS product_name,
              p.sku AS product_sku,
              p.unit AS product_unit,
              pb.batch_number,
              pb.expiry_date AS batch_expiry
       FROM stock_adjustment_items sai
       JOIN products p ON p.id = sai.product_id
       LEFT JOIN product_batches pb ON pb.id = sai.batch_id
       WHERE sai.adjustment_id = $1
       ORDER BY sai.sort_order ASC, sai.created_at ASC`,
      [id]
    );

    head.items = itemsRes.rows;
    return head;
  }

  static async checkWarehouse(client, companyId, warehouseId) {
    const result = await client.query(
      `SELECT 1
       FROM warehouses
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [warehouseId, companyId]
    );
    return result.rowCount > 0;
  }

  static async checkProduct(client, companyId, productId) {
    const result = await client.query(
      `SELECT 1
       FROM products
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [productId, companyId]
    );
    return result.rowCount > 0;
  }

  static async checkBatch(client, companyId, warehouseId, batchId) {
    const result = await client.query(
      `SELECT 1
       FROM product_batches
       WHERE id = $1 AND company_id = $2 AND warehouse_id = $3`,
      [batchId, companyId, warehouseId]
    );
    return result.rowCount > 0;
  }

  static async getSystemQuantity(
    client,
    companyId,
    warehouseId,
    productId,
    batchId
  ) {
    if (batchId) {
      const result = await client.query(
        `SELECT quantity
         FROM product_batches
         WHERE id = $1 AND company_id = $2 AND warehouse_id = $3`,
        [batchId, companyId, warehouseId]
      );

      return result.rowCount
        ? Number(result.rows[0].quantity)
        : 0;
    }

    const result = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
       FROM product_batches
       WHERE company_id = $1
         AND warehouse_id = $2
         AND product_id = $3`,
      [companyId, warehouseId, productId]
    );

    return Number(result.rows[0].total);
  }

  static async getUnitCost(client, productId, batchId) {
    if (batchId) {
      const result = await client.query(
        `SELECT cost_price FROM product_batches WHERE id = $1`,
        [batchId]
      );
      return result.rowCount
        ? Number(result.rows[0].cost_price)
        : 0;
    }

    const result = await client.query(
      `SELECT cost_price FROM products WHERE id = $1`,
      [productId]
    );

    return result.rowCount
      ? Number(result.rows[0].cost_price)
      : 0;
  }

  static async createAdjustment(client, data) {
    const result = await client.query(
      `INSERT INTO stock_adjustments
        (company_id, adjustment_number, adjustment_date,
         warehouse_id, reason, notes, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
       RETURNING id, adjustment_number, adjustment_date, status`,
      [
        data.company_id,
        data.adjustment_number,
        data.adjustment_date,
        data.warehouse_id,
        data.reason,
        data.notes,
        data.created_by,
      ]
    );

    return result.rows[0];
  }

  static async createItem(client, data) {
    await client.query(
      `INSERT INTO stock_adjustment_items
        (adjustment_id, product_id, batch_id,
         system_quantity, actual_quantity, difference,
         unit_cost, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        data.adjustment_id,
        data.product_id,
        data.batch_id,
        data.system_quantity,
        data.actual_quantity,
        data.difference,
        data.unit_cost,
        data.notes,
        data.sort_order,
      ]
    );
  }

  static async lockAdjustment(client, companyId, id) {
    const result = await client.query(
      `SELECT *
       FROM stock_adjustments
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    return result.rows[0] || null;
  }

  static async getItems(client, adjustmentId) {
    const result = await client.query(
      `SELECT *
       FROM stock_adjustment_items
       WHERE adjustment_id = $1
       ORDER BY sort_order ASC`,
      [adjustmentId]
    );
    return result.rows;
  }

  
  /**
   * ✅ زيادة كمية دفعة — مع التحقق من الملكية
   */
  static async increaseBatch(client, { companyId, batchId, quantity }) {
    const r = await client.query(
      `UPDATE product_batches
       SET quantity = quantity + $1
       WHERE id = $2 AND company_id = $3
       RETURNING id`,
      [quantity, batchId, companyId]
    );
    if (!r.rowCount) {
      throw new Error(`Batch ${batchId} not found in company ${companyId}`);
    }
  }

  /**
   * ✅ خصم كمية من دفعة — مع التحقق من الملكية والكمية
   */
  static async decreaseBatch(client, { companyId, batchId, quantity }) {
    const r = await client.query(
      `UPDATE product_batches
       SET quantity = quantity - $1
       WHERE id = $2 AND company_id = $3 AND quantity >= $1
       RETURNING id`,
      [quantity, batchId, companyId]
    );
    return r.rowCount > 0;
  }

  /**
   * ✅ إنشاء دفعة جديدة — مع SAVEPOINT للتعامل مع race condition
   */
  static async createBatchWithSavepoint(client, data) {
    const SAVEPOINT = `create_adj_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await client.query(`SAVEPOINT ${SAVEPOINT}`);

    try {
      const result = await client.query(
        `INSERT INTO product_batches
          (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          data.company_id, data.product_id, data.warehouse_id,
          data.batch_number, data.expiry_date, data.cost_price, data.quantity,
        ]
      );
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return { id: result.rows[0].id, created: true };
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);

      if (err.code === '23505') {
        // تعارض — ابحث عن الدفعة
        const existing = await client.query(
          `SELECT id FROM product_batches
           WHERE company_id = $1 AND product_id = $2
             AND warehouse_id = $3 AND batch_number = $4
           FOR UPDATE`,
          [data.company_id, data.product_id, data.warehouse_id, data.batch_number]
        );
        if (!existing.rowCount) {
          throw new Error(`Batch ${data.batch_number} conflict — not found after retry`);
        }
        return { id: existing.rows[0].id, created: false };
      }
      throw err;
    }
  }

  /**
   * ✅ FIFO مع company_id
   */
  static async getFifoBatches(client, { companyId, productId, warehouseId }) {
    const result = await client.query(
      `SELECT id, quantity
       FROM product_batches
       WHERE company_id = $1
         AND product_id = $2
         AND warehouse_id = $3
         AND quantity > 0
       ORDER BY expiry_date ASC, created_at ASC
       FOR UPDATE`,
      [companyId, productId, warehouseId]
    );
    return result.rows;
  }

  /**
   * ✅ تحديث الحالة — مع company_id + status + RETURNING
   */
  static async updateStatus(client, { id, companyId, status, userId, extra = {} }) {
    if (status === 'confirmed') {
      const r = await client.query(
        `UPDATE stock_adjustments
         SET status = 'confirmed',
             confirmed_by = $1,
             confirmed_at = NOW(),
             journal_entry_id = $2
         WHERE id = $3 AND company_id = $4 AND status = 'draft'
         RETURNING id`,
        [userId, extra.journalEntryId || null, id, companyId]
      );
      if (!r.rowCount) {
        throw new Error(`Failed to confirm adjustment ${id} — status changed or not found`);
      }
      return;
    }

    if (status === 'cancelled') {
      const r = await client.query(
        `UPDATE stock_adjustments
         SET status = 'cancelled',
             cancelled_by = $1,
             cancelled_at = NOW(),
             cancel_reason = $2
         WHERE id = $3 AND company_id = $4 AND status IN ('draft', 'confirmed')
         RETURNING id`,
        [userId, extra.reason || null, id, companyId]
      );
      if (!r.rowCount) {
        throw new Error(`Failed to cancel adjustment ${id}`);
      }
      return;
    }

    throw new Error(`Invalid status: ${status}`);
  }


  static async createBatch(client, data) {
    const result = await client.query(
      `INSERT INTO product_batches
        (company_id, product_id, warehouse_id,
         batch_number, expiry_date, cost_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        data.company_id,
        data.product_id,
        data.warehouse_id,
        data.batch_number,
        data.expiry_date,
        data.cost_price,
        data.quantity,
      ]
    );
    return result.rows[0];
  }



  static async createMovement(client, data) {
    await client.query(
      `INSERT INTO stock_movements
        (company_id, warehouse_id, batch_id,
         movement_type, quantity, unit_cost,
         reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        data.company_id,
        data.warehouse_id,
        data.batch_id,
        data.movement_type,
        data.quantity,
        data.unit_cost,
        data.reference_type,
        data.reference_id,
        data.created_by,
      ]
    );
  }

  static async getAccounts(client, companyId) {
    const result = await client.query(
      `SELECT id, code
       FROM chart_of_accounts
       WHERE company_id = $1
         AND code IN ('113', '518')
         AND is_active = TRUE`,
      [companyId]
    );

    return result.rows;
  }

 

  // جلب كل الحركات الأصلية، بما فيها الحركات الموزعة عبر FIFO.
  static async getAdjustmentMovements(client, companyId, adjustmentId) {
    const result = await client.query(
      `SELECT *
       FROM stock_movements
       WHERE company_id = $1
         AND reference_type = 'stock_adjustment'
         AND reference_id = $2
       ORDER BY created_at DESC
       FOR UPDATE`,
      [companyId, adjustmentId]
    );
    return result.rows;
  }

  static async list(companyId, filters = {}) {
    const {
      status,
      warehouse_id,
      reason,
      date_from,
      date_to,
      search,
      page = 1,
      limit = 20,
    } = filters;

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const params = [companyId];
    const conditions = ['sa.company_id = $1'];

    if (status) {
      params.push(status);
      conditions.push(`sa.status = $${params.length}`);
    }

    if (warehouse_id) {
      params.push(warehouse_id);
      conditions.push(`sa.warehouse_id = $${params.length}`);
    }

    if (reason) {
      params.push(reason);
      conditions.push(`sa.reason = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conditions.push(`sa.adjustment_date >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(`sa.adjustment_date <= $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;
      conditions.push(
        `(sa.adjustment_number ILIKE $${p} OR sa.notes ILIKE $${p})`
      );
    }

    const where = conditions.join(' AND ');
    const queryParams = [...params, safeLimit, offset];
    const limitPosition = queryParams.length - 1;
    const offsetPosition = queryParams.length;

    const [data, count] = await Promise.all([
      pool.query(
        `SELECT
           sa.id, sa.adjustment_number, sa.adjustment_date,
           sa.reason, sa.status, sa.notes, sa.warehouse_id,
           w.name AS warehouse_name, sa.created_at,
           u.name AS created_by_name,
           (SELECT COUNT(*)::int
            FROM stock_adjustment_items
            WHERE adjustment_id = sa.id) AS items_count,
           (SELECT COALESCE(
              SUM(ABS(difference) * COALESCE(unit_cost, 0)), 0
            )::numeric
            FROM stock_adjustment_items
            WHERE adjustment_id = sa.id) AS total_value
         FROM stock_adjustments sa
         LEFT JOIN warehouses w ON w.id = sa.warehouse_id
         LEFT JOIN users u ON u.id = sa.created_by
         WHERE ${where}
         ORDER BY sa.adjustment_date DESC, sa.created_at DESC
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        queryParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM stock_adjustments sa
         WHERE ${where}`,
        params
      ),
    ]);

    const total = count.rows[0].total;

    return {
      items: data.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }
  static async getWarehouseProducts(companyId, warehouseId, search = '') {
    const params = [companyId, warehouseId];
    let searchCond = '';

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;

      searchCond = `
        AND (
          p.name ILIKE $${p}
          OR p.sku ILIKE $${p}
          OR pb.batch_number ILIKE $${p}
        )
      `;
    }

    const { rows } = await pool.query(
      `SELECT
         pb.product_id,
         p.name AS product_name,
         p.sku AS product_sku,
         p.unit AS product_unit,
         pb.id AS batch_id,
         pb.batch_number,
         pb.expiry_date AS batch_expiry,
         pb.quantity AS system_quantity,
         pb.cost_price
       FROM product_batches pb
       JOIN products p ON p.id = pb.product_id
       WHERE pb.company_id = $1
         AND pb.warehouse_id = $2
         AND pb.quantity > 0
         AND p.is_active = TRUE
         ${searchCond}
       ORDER BY p.name ASC, pb.expiry_date ASC`,
      params
    );

    return rows;
  }

}

module.exports =  StockAdjustment;
