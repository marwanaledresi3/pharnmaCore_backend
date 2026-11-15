
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('./numberingService');
const StockTransfer = require('../models/stockTransfer');

const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

class StockTransferService {
  async getById(companyId, id, client = pool) {
    const transfer = await StockTransfer.getById(client, companyId, id);
    if (!transfer) throw new ApiError(404, 'Transfer not found');
    return transfer;
  }

   async validatePayload(payload) {
    const {
      from_warehouse_id,
      to_warehouse_id,
      items,
    } = payload;

    if (!from_warehouse_id || !to_warehouse_id) {
      throw new ApiError(
        400,
        'Source and destination warehouses are required'
      );
    }

    if (from_warehouse_id === to_warehouse_id) {
      throw new ApiError(
        400,
        'Source and destination warehouses must be different'
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'At least one item is required');
    }

    for (const item of items) {
      if (!item.product_id) {
        throw new ApiError(
          400,
          'product_id is required on every item'
        );
      }

      const quantity = Number(item.quantity);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new ApiError(
          400,
          `Invalid quantity for product ${item.product_id}`
        );
      }
    }
  }
  /**
   * ✅ validateItems — يتحقق من المستودعين معاً
   */
  async validateItems(client, companyId, fromWarehouseId, toWarehouseId, items) {
    const warehouses = await StockTransfer.checkWarehouses(
      client, companyId, [fromWarehouseId, toWarehouseId]
    );

    if (warehouses.length !== 2) {
      throw new ApiError(400, 'One or both warehouses not found or inactive');
    }

    const ids = warehouses.map((w) => w.id);
    if (!ids.includes(fromWarehouseId) || !ids.includes(toWarehouseId)) {
      throw new ApiError(400, 'Invalid warehouse IDs');
    }

    for (const item of items) {
      const product = await StockTransfer.checkProduct(client, companyId, item.product_id);
      if (!product) throw new ApiError(400, `Product ${item.product_id} not found or inactive`);

      if (item.from_batch_id) {
        const batch = await StockTransfer.checkBatch(
          client, companyId, fromWarehouseId, item.from_batch_id, round3(item.quantity)
        );
        if (!batch) {
          throw new ApiError(400, `Batch ${item.from_batch_id} not found in source warehouse or insufficient`);
        }
      }
    }
  }

  async create(companyId, userId, payload) {
    await this.validatePayload(payload);

    const { transfer_date, from_warehouse_id, to_warehouse_id, notes, items } = payload;

    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      await this.validateItems(client, companyId, from_warehouse_id, to_warehouse_id, items);

      const transferNumber = await NumberingService.next(client, companyId, 'stock_transfer');

      const transfer = await StockTransfer.createTransfer(client, {
        companyId,
        transferNumber,
        transferDate: transfer_date || new Date().toISOString().slice(0, 10),
        fromWarehouseId: from_warehouse_id,
        toWarehouseId: to_warehouse_id,
        notes: notes || null,
        userId,
      });

      const transferId = transfer.rows[0].id;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await StockTransfer.createItem(client, {
          transferId,
          productId: item.product_id,
          batchId: item.from_batch_id || null,  // ✅ from_batch_id ممرر
          quantity: round3(item.quantity),
          unitCost: item.unit_cost != null ? Number(item.unit_cost) : null,
          notes: item.notes || null,
          sortOrder: i,
        });
      }

      const result = await this.getById(companyId, transferId, client);
      await client.query('COMMIT');
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK'); }
        catch (e) { console.error('[stockTransfer.create] ROLLBACK failed:', e.message); }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async addToDestination(client, companyId, transfer, item, sourceBatch, quantity, userId) {
    const destinationBatch = await StockTransfer.findDestinationBatch(client, {
      companyId,
      productId: item.product_id,
      warehouseId: transfer.to_warehouse_id,
      batchNumber: sourceBatch.batch_number,
    });

    let destinationBatchId;

    if (destinationBatch) {
      destinationBatchId = destinationBatch.id;
      await StockTransfer.updateBatchQuantity(client, {
        companyId, batchId: destinationBatchId, quantity,
      });
    } else {
      const created = await StockTransfer.createDestinationBatchWithSavepoint(client, {
        companyId,
        productId: item.product_id,
        warehouseId: transfer.to_warehouse_id,
        batchNumber: sourceBatch.batch_number,
        expiryDate: sourceBatch.expiry_date,
        costPrice: sourceBatch.cost_price,
        quantity,
      });

      destinationBatchId = created.id;

      if (!created.created) {
        // دفعة أُنشئت بواسطة عملية أخرى → أضف الكمية
        await StockTransfer.updateBatchQuantity(client, {
          companyId, batchId: destinationBatchId, quantity,
        });
      }
    }

    await StockTransfer.createMovement(client, {
      companyId,
      warehouseId: transfer.to_warehouse_id,
      batchId: destinationBatchId,
      movementType: 'transfer_in',
      quantity,
      unitCost: sourceBatch.cost_price,
      referenceType: 'stock_transfer',
      referenceId: transfer.id,
      userId,
    });

    return destinationBatchId;
  }

  async transferBatch(client, companyId, transfer, item, batch, quantity, userId) {
    const deducted = await StockTransfer.deductBatch(client, {
      companyId, batchId: batch.id, quantity,
    });
    if (!deducted) {
      throw new ApiError(400, `Insufficient quantity in batch ${batch.id}`);
    }

    await StockTransfer.createMovement(client, {
      companyId,
      warehouseId: transfer.from_warehouse_id,
      batchId: batch.id,
      movementType: 'transfer_out',
      quantity: -quantity,
      unitCost: batch.cost_price,
      referenceType: 'stock_transfer',
      referenceId: transfer.id,
      userId,
    });

    return await this.addToDestination(client, companyId, transfer, item, batch, quantity, userId);
  }

  async confirm(companyId, userId, id) {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const lockRes = await StockTransfer.lockTransfer(client, companyId, id);
      const transfer = lockRes.rows[0];
      if (!transfer) throw new ApiError(404, 'Transfer not found');
      if (transfer.status === 'confirmed') throw new ApiError(400, 'Already confirmed');
      if (transfer.status === 'cancelled') throw new ApiError(400, 'Cancelled');

      const itemsRes = await StockTransfer.getItems(client, id);
      const items = itemsRes.rows;
      if (!items.length) throw new ApiError(400, 'No items');

      for (const item of items) {
        const quantity = round3(item.quantity);

        if (item.from_batch_id) {
          const batch = await StockTransfer.checkBatch(
            client, companyId, transfer.from_warehouse_id, item.from_batch_id, quantity
          );
          if (!batch) {
            throw new ApiError(400, `Insufficient quantity in batch ${item.from_batch_id}`);
          }

          const destId = await this.transferBatch(client, companyId, transfer, item, batch, quantity, userId);
          await StockTransfer.updateItemDestinationBatch(client, destId, item.id);
          continue;
        }

        // FIFO
        const batchesRes = await StockTransfer.getAvailableBatches(
          client, item.product_id, transfer.from_warehouse_id
        );
        const batches = batchesRes.rows;

        let remaining = quantity;
        let lastDestId = null;

        for (const batch of batches) {
          if (remaining <= 0) break;
          const take = round3(Math.min(remaining, Number(batch.quantity)));
          if (take <= 0) continue;

          const destId = await this.transferBatch(client, companyId, transfer, item, batch, take, userId);
          lastDestId = destId;
          remaining = round3(remaining - take);
        }

        if (remaining > 0.001) {
          throw new ApiError(400, `Insufficient stock for product ${item.product_id}. Missing: ${remaining}`);
        }

        await StockTransfer.updateItemDestinationBatch(client, lastDestId, item.id);
      }

      // ✅ updateTransferStatus مع company_id + status + RETURNING
      await StockTransfer.updateTransferStatus(client, {
        id, companyId, status: 'confirmed', userId,
      });

      const result = await this.getById(companyId, id, client);
      await client.query('COMMIT');
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK'); }
        catch (e) { console.error('[stockTransfer.confirm] ROLLBACK failed:', e.message); }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(companyId, userId, id, reason) {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const lockRes = await StockTransfer.lockTransfer(client, companyId, id);
      const transfer = lockRes.rows[0];
      if (!transfer) throw new ApiError(404, 'Transfer not found');
      if (transfer.status === 'cancelled') throw new ApiError(400, 'Already cancelled');

      if (transfer.status === 'draft') {
        await StockTransfer.updateTransferStatus(client, {
          id, companyId, status: 'cancelled', userId, reason,
        });
        await client.query('COMMIT');
        transactionStarted = false;
        return { id, cancelled: true, reversed: false };
      }

      if (transfer.status !== 'confirmed') {
        throw new ApiError(400, 'Only draft or confirmed can be cancelled');
      }

      const movements = await StockTransfer.getTransferMovements(client, companyId, id);
      if (!movements.length) {
        throw new ApiError(400, 'Original movements not found');
      }

      await StockTransfer.reverseTransferMovements(client, {
        companyId, transfer, movements, userId,
      });

      await StockTransfer.updateTransferStatus(client, {
        id, companyId, status: 'cancelled', userId, reason,
      });

      await client.query('COMMIT');
      transactionStarted = false;
      return { id, cancelled: true, reversed: true };
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK'); }
        catch (e) { console.error('[stockTransfer.cancel] ROLLBACK failed:', e.message); }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async list(companyId, filters = {}) {
    return StockTransfer.list(companyId, filters);
  }
}

module.exports = StockTransferService;