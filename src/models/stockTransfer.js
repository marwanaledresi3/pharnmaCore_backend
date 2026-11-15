
const { pool } = require('../config/pool');

class StockTransfer {

  static async getById(client, companyId, id) {
    const headRes = await client.query(
      `SELECT
         st.*,
         fw.name AS from_warehouse_name,
         tw.name AS to_warehouse_name,
         u.name AS created_by_name,
         cu.name AS confirmed_by_name,
         x.name AS cancelled_by_name
       FROM stock_transfers st
       LEFT JOIN warehouses fw ON fw.id = st.from_warehouse_id
       LEFT JOIN warehouses tw ON tw.id = st.to_warehouse_id
       LEFT JOIN users u ON u.id = st.created_by
       LEFT JOIN users cu ON cu.id = st.confirmed_by
       LEFT JOIN users x ON x.id = st.cancelled_by
       WHERE st.id = $1 AND st.company_id = $2`,
      [id, companyId]
    );

    const head = headRes.rows[0];
    if (!head) return null;

    const itemsRes = await client.query(
      `SELECT
         sti.*,
         p.name AS product_name,
         p.sku AS product_sku,
         p.unit AS product_unit,
         fb.batch_number AS from_batch_number,
         fb.expiry_date AS from_batch_expiry,
         tb.batch_number AS to_batch_number,
         tb.expiry_date AS to_batch_expiry
       FROM stock_transfer_items sti
       JOIN products p ON p.id = sti.product_id
       LEFT JOIN product_batches fb ON fb.id = sti.from_batch_id
       LEFT JOIN product_batches tb ON tb.id = sti.to_batch_id
       WHERE sti.transfer_id = $1
       ORDER BY sti.sort_order ASC, sti.created_at ASC`,
      [id]
    );

    head.items = itemsRes.rows;
    return head;
  }

  

  static async checkProduct(client, companyId, productId) {
    return client.query(
      `SELECT 1 FROM products
       WHERE id = $1
         AND company_id = $2
         AND is_active = TRUE`,
      [productId, companyId]
    );
  }


  static async createTransfer(client, data) {
    const {
      companyId,
      transferNumber,
      transferDate,
      fromWarehouseId,
      toWarehouseId,
      notes,
      userId,
    } = data;

    return client.query(
      `INSERT INTO stock_transfers
        (company_id, transfer_number, transfer_date,
         from_warehouse_id, to_warehouse_id, notes,
         status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
       RETURNING id, transfer_number, transfer_date, status`,
      [
        companyId,
        transferNumber,
        transferDate,
        fromWarehouseId,
        toWarehouseId,
        notes,
        userId,
      ]
    );
  }

 
  static async lockTransfer(client, companyId, id) {
    return client.query(
      `SELECT * FROM stock_transfers
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
  }

  static async getItems(client, transferId) {
    return client.query(
      `SELECT *
       FROM stock_transfer_items
       WHERE transfer_id = $1
       ORDER BY sort_order ASC`,
      [transferId]
    );
  }

  static async getAvailableBatches(client, productId, warehouseId) {
    return client.query(
      `SELECT id, batch_number, expiry_date, cost_price, quantity
       FROM product_batches
       WHERE product_id = $1
         AND warehouse_id = $2
         AND quantity > 0
       ORDER BY expiry_date ASC, created_at ASC`,
      [productId, warehouseId]
    );
  }







  static async createDestinationBatch(client, data) {
    const {
      companyId,
      productId,
      warehouseId,
      batchNumber,
      expiryDate,
      costPrice,
      quantity,
    } = data;

    return client.query(
      `INSERT INTO product_batches
        (company_id, product_id, warehouse_id,
         batch_number, expiry_date, cost_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        companyId,
        productId,
        warehouseId,
        batchNumber,
        expiryDate,
        costPrice,
        quantity,
      ]
    );
  }

  static async createMovement(client, data) {
    const {
      companyId,
      warehouseId,
      batchId,
      movementType,
      quantity,
      unitCost,
      referenceType,
      referenceId,
      userId,
    } = data;

    return client.query(
      `INSERT INTO stock_movements
        (company_id, warehouse_id, batch_id,
         movement_type, quantity, unit_cost,
         reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        companyId,
        warehouseId,
        batchId,
        movementType,
        quantity,
        unitCost,
        referenceType,
        referenceId,
        userId,
      ]
    );
  }

  static async updateItemDestinationBatch(client, batchId, itemId) {
    return client.query(
      `UPDATE stock_transfer_items
       SET to_batch_id = $1
       WHERE id = $2`,
      [batchId, itemId]
    );
  }


  static async restoreBatch(client, batchId, quantity) {
    return client.query(
      `UPDATE product_batches
       SET quantity = quantity + $1
       WHERE id = $2`,
      [quantity, batchId]
    );
  }

  static async deductDestinationBatch(client, batchId, quantity) {
    return client.query(
      `UPDATE product_batches
       SET quantity = quantity - $1
       WHERE id = $2 AND quantity >= $1
       RETURNING id`,
      [quantity, batchId]
    );
  }

 static async list(companyId, filters = {}) {
    try {
      const {
        status,
        from_warehouse_id,
        to_warehouse_id,
        date_from,
        date_to,
        search,
        limit = 10,  // قيمة افتراضية لتجنب undefined
        offset = 0,  // قيمة افتراضية لتجنب undefined
      } = filters;

      const params = [companyId];
      const conditions = ['st.company_id = $1'];

      const addFilter = (column, value) => {
        params.push(value);
        conditions.push(`${column} = $${params.length}`);
      };

      if (status) addFilter('st.status', status);
      if (from_warehouse_id) addFilter('st.from_warehouse_id', from_warehouse_id);
      if (to_warehouse_id) addFilter('st.to_warehouse_id', to_warehouse_id);

      if (date_from) {
        params.push(date_from);
        conditions.push(`st.transfer_date >= $${params.length}`);
      }

      if (date_to) {
        params.push(date_to);
        conditions.push(`st.transfer_date <= $${params.length}`);
      }

      if (search && String(search).trim()) {
        params.push(`%${String(search).trim()}%`);
        conditions.push(`st.transfer_number ILIKE $${params.length}`);
      }

      const where = conditions.join(' AND ');
      const queryParams = [...params, Number(limit), Number(offset)];

      const [result, countResult] = await Promise.all([
        pool.query(
          `SELECT
             st.id,
             st.transfer_number,
             st.transfer_date,
             st.status,
             st.from_warehouse_id,
             fw.name AS from_warehouse_name,
             st.to_warehouse_id,
             tw.name AS to_warehouse_name,
             st.notes,
             st.created_at,
             u.name AS created_by_name,
             (SELECT COUNT(*)::int
              FROM stock_transfer_items
              WHERE transfer_id = st.id) AS items_count
           FROM stock_transfers st
           LEFT JOIN warehouses fw ON fw.id = st.from_warehouse_id
           LEFT JOIN warehouses tw ON tw.id = st.to_warehouse_id
           LEFT JOIN users u ON u.id = st.created_by
           WHERE ${where}
           ORDER BY st.transfer_date DESC, st.created_at DESC
           LIMIT $${params.length + 1}
           OFFSET $${params.length + 2}`,
          queryParams
        ),

        pool.query(
          `SELECT COUNT(*)::int AS total
           FROM stock_transfers st
           WHERE ${where}`,
          params
        ),
      ]);

      const totalCount = countResult && countResult.rows && countResult.rows[0] 
        ? Number(countResult.rows[0].total) 
        : 0;

      return {
        items: result?.rows || [],
        total: totalCount,
      };
    } catch (error) {
      console.error('❌ Error in StockTransfer.list:', error);
      throw error;
    }
  }

  
  /**
   * ✅ checkWarehouses — تتحقق من مستودعين محددين
   */
  static async checkWarehouses(client, companyId, warehouseIds) {
    const r = await client.query(
      `SELECT id FROM warehouses
       WHERE company_id = $1
         AND id = ANY($2::uuid[])
         AND is_active = TRUE`,
      [companyId, warehouseIds]
    );
    return r.rows;
  }

  /**
   * ✅ checkBatch — مع company_id
   */
  static async checkBatch(client, companyId, warehouseId, batchId, quantity) {
    const r = await client.query(
      `SELECT id, quantity, cost_price, batch_number, expiry_date
       FROM product_batches
       WHERE id = $1
         AND company_id = $2
         AND warehouse_id = $3
         AND quantity >= $4
       FOR UPDATE`,
      [batchId, companyId, warehouseId, quantity]
    );
    return r.rows[0] || null;
  }

  /**
   * ✅ createItem — إضافة from_batch_id (كان مفقوداً!)
   */
  static async createItem(client, data) {
    const {
      transferId, productId, batchId, quantity, unitCost, notes, sortOrder,
    } = data;

    return client.query(
      `INSERT INTO stock_transfer_items
        (transfer_id, product_id, from_batch_id, quantity, unit_cost, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [transferId, productId, batchId || null, quantity, unitCost, notes, sortOrder]
    );
  }

  /**
   * ✅ deductBatch — مع company_id
   */
  static async deductBatch(client, { companyId, batchId, quantity }) {
    const r = await client.query(
      `UPDATE product_batches
       SET quantity = quantity - $1
       WHERE id = $2 AND company_id = $3 AND quantity >= $1
       RETURNING id, batch_number, expiry_date, cost_price, quantity`,
      [quantity, batchId, companyId]
    );
    return r.rows[0] || null;
  }

  /**
   * ✅ findDestinationBatch — مع FOR UPDATE
   */
  static async findDestinationBatch(client, { companyId, productId, warehouseId, batchNumber }) {
    const r = await client.query(
      `SELECT id FROM product_batches
       WHERE company_id = $1
         AND product_id = $2
         AND warehouse_id = $3
         AND batch_number = $4
       LIMIT 1
       FOR UPDATE`,
      [companyId, productId, warehouseId, batchNumber]
    );
    return r.rows[0] || null;
  }

  /**
   * ✅ updateBatchQuantity — مع company_id
   */
  static async updateBatchQuantity(client, { companyId, batchId, quantity }) {
    const r = await client.query(
      `UPDATE product_batches
       SET quantity = quantity + $1
       WHERE id = $2 AND company_id = $3
       RETURNING id`,
      [quantity, batchId, companyId]
    );
    if (!r.rowCount) {
      throw new Error(`Batch ${batchId} not found`);
    }
  }

  /**
   * ✅ createDestinationBatchWithSavepoint
   */
  static async createDestinationBatchWithSavepoint(client, data) {
    const SAVEPOINT = `create_dest_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await client.query(`SAVEPOINT ${SAVEPOINT}`);

    try {
      const r = await client.query(
        `INSERT INTO product_batches
          (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          data.companyId, data.productId, data.warehouseId,
          data.batchNumber, data.expiryDate, data.costPrice, data.quantity,
        ]
      );
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return { id: r.rows[0].id, created: true };
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);

      if (err.code === '23505') {
        const existing = await this.findDestinationBatch(client, {
          companyId: data.companyId,
          productId: data.productId,
          warehouseId: data.warehouseId,
          batchNumber: data.batchNumber,
        });
        if (!existing) {
          throw new Error(`Batch ${data.batchNumber} conflict — not found after retry`);
        }
        return { id: existing.id, created: false };
      }
      throw err;
    }
  }

  /**
   * ✅ updateTransferStatus — مع company_id + status + RETURNING
   */
  static async updateTransferStatus(client, { id, companyId, status, userId, reason }) {
    if (status === 'confirmed') {
      const r = await client.query(
        `UPDATE stock_transfers
         SET status = 'confirmed',
             confirmed_by = $1,
             confirmed_at = NOW()
         WHERE id = $2 AND company_id = $3 AND status = 'draft'
         RETURNING id`,
        [userId, id, companyId]
      );
      if (!r.rowCount) {
        throw new Error(`Failed to confirm transfer ${id}`);
      }
      return;
    }

    if (status === 'cancelled') {
      const r = await client.query(
        `UPDATE stock_transfers
         SET status = 'cancelled',
             cancelled_by = $1,
             cancelled_at = NOW(),
             cancel_reason = $2
         WHERE id = $3 AND company_id = $4 AND status IN ('draft', 'confirmed')
         RETURNING id`,
        [userId, reason || null, id, companyId]
      );
      if (!r.rowCount) {
        throw new Error(`Failed to cancel transfer ${id}`);
      }
      return;
    }

    throw new Error(`Invalid status: ${status}`);
  }

  /**
   * ✅ getTransferMovements — **جديد** — يجلب كل حركات التحويل
   */
  static async getTransferMovements(client, companyId, transferId) {
    const r = await client.query(
      `SELECT * FROM stock_movements
       WHERE company_id = $1
         AND reference_type = 'stock_transfer'
         AND reference_id = $2
       ORDER BY created_at ASC
       FOR UPDATE`,
      [companyId, transferId]
    );
    return r.rows;
  }

  /**
   * ✅ reverseTransferMovements — **جديد** — يعكس كل حركة حسب batch_id
   */
  static async reverseTransferMovements(client, { companyId, transfer, movements, userId }) {
    for (const movement of movements) {
      const originalQty = Number(movement.quantity);
      const reverseQty = -originalQty;

      if (originalQty > 0) {
        // كان transfer_in → اخصم
        const deducted = await this.deductBatch(client, {
          companyId,
          batchId: movement.batch_id,
          quantity: originalQty,
        });
        if (!deducted) {
          throw new Error(
            `Cannot reverse: insufficient quantity in batch ${movement.batch_id}`
          );
        }
      } else {
        // كان transfer_out → أضف
        await this.updateBatchQuantity(client, {
          companyId,
          batchId: movement.batch_id,
          quantity: Math.abs(originalQty),
        });
      }

      // سجل الحركة العكسية
      await this.createMovement(client, {
        companyId,
        warehouseId: movement.warehouse_id,
        batchId: movement.batch_id,
        movementType: 'transfer_cancel',
        quantity: reverseQty,
        unitCost: movement.unit_cost,
        referenceType: 'stock_transfer_cancel',
        referenceId: transfer.id,
        userId,
      });
    }
  }

}

module.exports =  StockTransfer;


