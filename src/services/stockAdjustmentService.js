const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('./numberingService');
const settingsService = require('./settingsService');
const JournalEntry = require('../models/JournalEntry');
const StockAdjustment = require('../models/stockAdjustment');

const round3 = (n) =>
  Math.round((Number(n) || 0) * 1000) / 1000;

const round2 = (n) =>
  Math.round((Number(n) || 0) * 100) / 100;

class StockAdjustmentService {
  static async generateAdjustmentNumber(client, companyId) {
    return NumberingService.next(
      client,
      companyId,
      'stock_adjustment'
    );
  }

  static async getById(client, companyId, id) {
    const adjustment = await StockAdjustment.getById(
      client,
      companyId,
      id
    );

    if (!adjustment) {
      throw new ApiError(404, 'Adjustment not found');
    }

    return adjustment;
  }

  static async validateItems(client, companyId, warehouseId, items) {
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

      const actualQty = Number(item.actual_quantity);

      if (!Number.isFinite(actualQty) || actualQty < 0) {
        throw new ApiError(
          400,
          `Invalid actual_quantity for product ${item.product_id}`
        );
      }

      const productExists =
        await StockAdjustment.checkProduct(
          client,
          companyId,
          item.product_id
        );

      if (!productExists) {
        throw new ApiError(
          400,
          `Product ${item.product_id} not found or inactive`
        );
      }

      if (item.batch_id) {
        const batchExists =
          await StockAdjustment.checkBatch(
            client,
            companyId,
            warehouseId,
            item.batch_id
          );

        if (!batchExists) {
          throw new ApiError(
            400,
            `Batch ${item.batch_id} not found in warehouse`
          );
        }
      }
    }
  }

  static async create(companyId, userId, payload) {
    const {
      adjustment_date,
      warehouse_id,
      reason,
      notes,
      items,
    } = payload;

    if (!warehouse_id) {
      throw new ApiError(400, 'warehouse_id is required');
    }

    if (!reason) {
      throw new ApiError(400, 'reason is required');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const warehouseExists =
        await StockAdjustment.checkWarehouse(
          client,
          companyId,
          warehouse_id
        );

      if (!warehouseExists) {
        throw new ApiError(400, 'Warehouse not found or inactive');
      }

      await this.validateItems(
        client,
        companyId,
        warehouse_id,
        items
      );

      const adjustmentNumber =
        await this.generateAdjustmentNumber(client, companyId);

      const adjustment =
        await StockAdjustment.createAdjustment(client, {
          company_id: companyId,
          adjustment_number: adjustmentNumber,
          adjustment_date:
            adjustment_date ||
            new Date().toISOString().slice(0, 10),
          warehouse_id,
          reason,
          notes: notes || null,
          created_by: userId,
        });

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        const systemQty =
          await StockAdjustment.getSystemQuantity(
            client,
            companyId,
            warehouse_id,
            item.product_id,
            item.batch_id || null
          );

        const actualQty = round3(item.actual_quantity);
        const difference = round3(actualQty - systemQty);

        const unitCost =
          item.unit_cost == null
            ? await StockAdjustment.getUnitCost(
                client,
                item.product_id,
                item.batch_id || null
              )
            : Number(item.unit_cost);

        await StockAdjustment.createItem(client, {
          adjustment_id: adjustment.id,
          product_id: item.product_id,
          batch_id: item.batch_id || null,
          system_quantity: systemQty,
          actual_quantity: actualQty,
          difference,
          unit_cost: unitCost,
          notes: item.notes || null,
          sort_order: i,
        });
      }

      const result = await this.getById(
        client,
        companyId,
        adjustment.id
      );

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async applyBatchDifference(
    client,
    companyId,
    adjustment,
    item,
    batchId,
    difference,
    unitCost,
    userId
  ) {
    if (difference > 0) {
      await StockAdjustment.increaseBatch(
        client,
        batchId,
        difference
      );
    } else {
      const deducted = await StockAdjustment.decreaseBatch(
        client,
        batchId,
        Math.abs(difference)
      );

      if (!deducted) {
        throw new ApiError(
          400,
          `Insufficient quantity in batch ${batchId}`
        );
      }
    }

    await StockAdjustment.createMovement(client, {
      company_id: companyId,
      warehouse_id: adjustment.warehouse_id,
      batch_id: batchId,
      movement_type: 'adjustment',
      quantity: difference,
      unit_cost: unitCost,
      reference_type: 'stock_adjustment',
      reference_id: adjustment.id,
      created_by: userId,
    });
  }

  static async applyDifferenceWithoutBatch(
    client,
    companyId,
    adjustment,
    item,
    difference,
    unitCost,
    userId
  ) {
    if (difference > 0) {
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 2);

      const newBatch = await StockAdjustment.createBatch(
        client,
        {
          company_id: companyId,
          product_id: item.product_id,
          warehouse_id: adjustment.warehouse_id,
          batch_number:
            `ADJ-${adjustment.id.slice(0, 8)}-${item.product_id.slice(0, 8)}`,
          expiry_date: expiryDate.toISOString().slice(0, 10),
          cost_price: unitCost,
          quantity: difference,
        }
      );

      await StockAdjustment.createMovement(client, {
        company_id: companyId,
        warehouse_id: adjustment.warehouse_id,
        batch_id: newBatch.id,
        movement_type: 'adjustment',
        quantity: difference,
        unit_cost: unitCost,
        reference_type: 'stock_adjustment',
        reference_id: adjustment.id,
        created_by: userId,
      });

      return;
    }

    let remaining = Math.abs(difference);

    const batches = await StockAdjustment.getFifoBatches(
      client,
      item.product_id,
      adjustment.warehouse_id
    );

    for (const batch of batches) {
      if (remaining <= 0.001) break;

      const take = round3(
        Math.min(remaining, Number(batch.quantity))
      );

      if (take <= 0) continue;

      const deducted = await StockAdjustment.decreaseBatch(
        client,
        batch.id,
        take
      );

      if (!deducted) {
        throw new ApiError(
          400,
          `Unable to deduct quantity from batch ${batch.id}`
        );
      }

      await StockAdjustment.createMovement(client, {
        company_id: companyId,
        warehouse_id: adjustment.warehouse_id,
        batch_id: batch.id,
        movement_type: 'adjustment',
        quantity: -take,
        unit_cost: unitCost,
        reference_type: 'stock_adjustment',
        reference_id: adjustment.id,
        created_by: userId,
      });

      remaining = round3(remaining - take);
    }

    if (remaining > 0.001) {
      throw new ApiError(
        400,
        `Insufficient stock for product ${item.product_id}. Missing: ${remaining}`
      );
    }
  }

  static async createJournalEntry(
    client,
    companyId,
    adjustment,
    totalValue,
    userId
  ) {
    const autoJournal = await settingsService.get(
      companyId,
      'stock_adjustment_auto_journal',
      true,
      client
    );

    if (!autoJournal || Math.abs(totalValue) <= 0.01) {
      return null;
    }

    const accounts = await StockAdjustment.getAccounts(
      client,
      companyId
    );

    const inventoryAccount = accounts.find(
      (account) => account.code === '113'
    );

    const varianceAccount = accounts.find(
      (account) => account.code === '518'
    );

    if (!inventoryAccount || !varianceAccount) {
      throw new ApiError(
        500,
        'Required accounts (113 inventory, 518 variance) not found'
      );
    }

    const amount = round2(Math.abs(totalValue));

    const lines = totalValue > 0
      ? [
          {
            account_id: inventoryAccount.id,
            debit: amount,
            credit: 0,
            description: 'فائض جرد',
          },
          {
            account_id: varianceAccount.id,
            debit: 0,
            credit: amount,
            description: 'فائض جرد',
          },
        ]
      : [
          {
            account_id: varianceAccount.id,
            debit: amount,
            credit: 0,
            description: 'عجز جرد',
          },
          {
            account_id: inventoryAccount.id,
            debit: 0,
            credit: amount,
            description: 'عجز جرد',
          },
        ];

    const entry = await JournalEntry.create(
      client,
      companyId,
      {
        entry_date: adjustment.adjustment_date,
        description: `تسوية جرد ${adjustment.adjustment_number}`,
        source_type: 'adjustment',
        source_id: adjustment.id,
        created_by: userId,
        lines,
      }
    );

    await JournalEntry.post(
      client,
      companyId,
      entry.id,
      userId
    );

    return entry.id;
  }

  static async confirm(companyId, userId, id) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const adjustment =
        await StockAdjustment.lockAdjustment(
          client,
          companyId,
          id
        );

      if (!adjustment) {
        throw new ApiError(404, 'Adjustment not found');
      }

      if (adjustment.status === 'confirmed') {
        throw new ApiError(400, 'Adjustment is already confirmed');
      }

      if (adjustment.status === 'cancelled') {
        throw new ApiError(400, 'Adjustment is cancelled');
      }

      const items = await StockAdjustment.getItems(
        client,
        id
      );

      if (!items.length) {
        throw new ApiError(400, 'Adjustment has no items');
      }

      const hasDifference = items.some(
        (item) => Math.abs(Number(item.difference)) > 0.001
      );

      if (!hasDifference) {
        throw new ApiError(400, 'No differences to adjust');
      }

      let totalValue = 0;

      for (const item of items) {
        const difference = Number(item.difference);

        if (Math.abs(difference) < 0.001) continue;

        const unitCost = Number(item.unit_cost) || 0;
        const value = round2(
          Math.abs(difference) * unitCost
        );

        totalValue += difference > 0 ? value : -value;

        if (item.batch_id) {
          await this.applyBatchDifference(
            client,
            companyId,
            adjustment,
            item,
            item.batch_id,
            difference,
            unitCost,
            userId
          );
        } else {
          await this.applyDifferenceWithoutBatch(
            client,
            companyId,
            adjustment,
            item,
            difference,
            unitCost,
            userId
          );
        }
      }

      const journalEntryId = await this.createJournalEntry(
        client,
        companyId,
        adjustment,
        totalValue,
        userId
      );

      await StockAdjustment.updateStatus(
        client,
        id,
        'confirmed',
        userId,
        { journalEntryId }
      );

      const result = await this.getById(
        client,
        companyId,
        id
      );

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async reverseStockMovements(
    client,
    companyId,
    adjustment,
    movements,
    userId
  ) {
    for (const movement of movements) {
      const originalQuantity = Number(movement.quantity);
      const reverseQuantity = -originalQuantity;

      if (originalQuantity > 0) {
        const deducted = await StockAdjustment.decreaseBatch(
          client,
          movement.batch_id,
          originalQuantity
        );

        if (!deducted) {
          throw new ApiError(
            400,
            `Cannot reverse: insufficient quantity in batch ${movement.batch_id}`
          );
        }
      } else if (originalQuantity < 0) {
        await StockAdjustment.increaseBatch(
          client,
          movement.batch_id,
          Math.abs(originalQuantity)
        );
      }

      await StockAdjustment.createMovement(client, {
        company_id: companyId,
        warehouse_id: movement.warehouse_id,
        batch_id: movement.batch_id,
        movement_type: 'adjustment',
        quantity: reverseQuantity,
        unit_cost: movement.unit_cost,
        reference_type: 'stock_adjustment_cancel',
        reference_id: adjustment.id,
        created_by: userId,
      });
    }
  }

  static async reverseJournalEntry(
    client,
    companyId,
    adjustment,
    userId
  ) {
    if (!adjustment.journal_entry_id) return;

    const original = await JournalEntry.findById(
      companyId,
      adjustment.journal_entry_id
    );

    if (!original?.lines) return;

    const reversedLines = original.lines.map((line) => ({
      account_id: line.account_id,
      debit: Number(line.credit),
      credit: Number(line.debit),
      description: `عكس تسوية جرد — ${line.description || ''}`,
    }));

    const reverse = await JournalEntry.create(
      client,
      companyId,
      {
        entry_date: new Date().toISOString().slice(0, 10),
        description: `عكس تسوية جرد ${adjustment.adjustment_number}`,
        source_type: 'adjustment',
        source_id: adjustment.id,
        created_by: userId,
        lines: reversedLines,
      }
    );

    await JournalEntry.post(
      client,
      companyId,
      reverse.id,
      userId
    );
  }

  static async cancel(companyId, userId, id, reason) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const adjustment =
        await StockAdjustment.lockAdjustment(
          client,
          companyId,
          id
        );

      if (!adjustment) {
        throw new ApiError(404, 'Adjustment not found');
      }

      if (adjustment.status === 'cancelled') {
        throw new ApiError(400, 'Adjustment is already cancelled');
      }

      if (adjustment.status === 'draft') {
        await StockAdjustment.updateStatus(
          client,
          id,
          'cancelled',
          userId,
          { reason }
        );

        await client.query('COMMIT');

        return {
          id,
          cancelled: true,
          reversed: false,
        };
      }

      if (adjustment.status !== 'confirmed') {
        throw new ApiError(
          400,
          'Only draft or confirmed adjustments can be cancelled'
        );
      }

      const movements =
        await StockAdjustment.getAdjustmentMovements(
          client,
          companyId,
          id
        );

      if (!movements.length) {
        throw new ApiError(
          400,
          'Cannot reverse adjustment: original stock movements not found'
        );
      }

      await this.reverseStockMovements(
        client,
        companyId,
        adjustment,
        movements,
        userId
      );

      await this.reverseJournalEntry(
        client,
        companyId,
        adjustment,
        userId
      );

      await StockAdjustment.updateStatus(
        client,
        id,
        'cancelled',
        userId,
        { reason }
      );

      await client.query('COMMIT');

      return {
        id,
        cancelled: true,
        reversed: true,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async list(companyId, filters = {}) {
    return StockAdjustment.list(companyId, filters);
  }
}

module.exports = StockAdjustmentService;