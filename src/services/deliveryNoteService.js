
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('./numberingService');
const settingsService = require('./settingsService');
const DeliveryNote = require('../models/DeliveryNote');

const round3 = (n) =>
  Math.round((Number(n) || 0) * 1000) / 1000;

async function withTransaction(callback) {
  const client = await pool.connect();
  let started = false;

  try {
    await client.query('BEGIN');
    started = true;

    const result = await callback(client);

    await client.query('COMMIT');
    started = false;

    return result;
  } catch (err) {
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          '[deliveryNoteService] Rollback failed:',
          rollbackError.message
        );
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

async function generateNumber(client, companyId) {
  return NumberingService.next(client, companyId, 'delivery_note');
}

/**
 * التحقق من البنود
 */
async function validateItems(client, companyId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required');
  }

  for (const item of items) {
    if (!item.product_id) {
      throw new ApiError(400, 'product_id is required on every item');
    }

    const qty = Number(item.quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ApiError(
        400,
        `Invalid quantity for product ${item.product_id}`
      );
    }

    if (
      item.unit_price !== undefined &&
      (!Number.isFinite(Number(item.unit_price)) ||
        Number(item.unit_price) < 0)
    ) {
      throw new ApiError(
        400,
        `Invalid unit price for product ${item.product_id}`
      );
    }

    const exists = await DeliveryNote.findProduct(
      client,
      companyId,
      item.product_id
    );

    if (!exists) {
      throw new ApiError(
        400,
        `Product ${item.product_id} not found or inactive`
      );
    }
  }
}

/**
 * جلب مذكرة واحدة
 */
async function getById(companyId, id) {
  const client = await pool.connect();

  try {
    return await DeliveryNote.getById(client, companyId, id);
  } finally {
    client.release();
  }
}

/**
 * إنشاء مذكرة تسليم
 */
async function create(companyId, userId, payload) {
  const {
    delivery_date,
    customer_id,
    sales_order_id,
    warehouse_id,
    driver_name,
    driver_phone,
    vehicle_number,
    delivery_address,
    notes,
    items,
  } = payload;

  if (!customer_id) {
    throw new ApiError(400, 'customer_id is required');
  }

  if (!warehouse_id) {
    throw new ApiError(400, 'warehouse_id is required');
  }

  return withTransaction(async (client) => {
    const customerExists = await DeliveryNote.findCustomer(
      client,
      companyId,
      customer_id
    );

    if (!customerExists) {
      throw new ApiError(400, 'Customer not found or inactive');
    }

    const warehouseExists = await DeliveryNote.findWarehouse(
      client,
      companyId,
      warehouse_id
    );

    if (!warehouseExists) {
      throw new ApiError(400, 'Warehouse not found or inactive');
    }

    await validateItems(client, companyId, items);

    const deliveryNumber = await generateNumber(client, companyId);

    const dn = await DeliveryNote.insertHead(client, {
      companyId,
      deliveryNumber,
      deliveryDate:
        delivery_date || new Date().toISOString().slice(0, 10),
      customerId: customer_id,
      salesOrderId: sales_order_id || null,
      warehouseId: warehouse_id,
      driverName: driver_name || null,
      driverPhone: driver_phone || null,
      vehicleNumber: vehicle_number || null,
      deliveryAddress: delivery_address || null,
      notes: notes || null,
      userId,
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      await DeliveryNote.insertItem(
        client,
        dn.id,
        {
          ...item,
          quantity: round3(item.quantity),
        },
        i
      );
    }

    return DeliveryNote.getById(client, companyId, dn.id);
  });
}

/**
 * خصم كمية من دفعة محددة
 */
async function deductSpecificBatch(
  client,
  companyId,
  warehouseId,
  productId,
  batchId,
  quantity,
  deliveryNoteId,
  userId
) {
  const batch = await DeliveryNote.lockBatch(
    client,
    companyId,
    warehouseId,
    productId,
    batchId
  );

  if (!batch) {
    throw new ApiError(400, `Batch ${batchId} not found`);
  }

  const deducted = await DeliveryNote.deductBatch(
    client,
    batch.id,
    quantity
  );

  if (!deducted) {
    throw new ApiError(
      400,
      `Insufficient quantity in batch ${batchId}`
    );
  }

  await DeliveryNote.insertStockMovement(client, {
    companyId,
    warehouseId,
    batchId: batch.id,
    movementType: 'delivery_out',
    quantity: -quantity,
    unitCost: deducted.cost_price,
    referenceType: 'delivery_note',
    referenceId: deliveryNoteId,
    userId,
  });
}

/**
 * خصم FIFO من أقدم الدفعات
 */
async function deductFifo(
  client,
  companyId,
  warehouseId,
  productId,
  quantity,
  deliveryNoteId,
  userId
) {
  let remaining = quantity;

  const batches = await DeliveryNote.getFifoBatches(
    client,
    companyId,
    warehouseId,
    productId
  );

  for (const batch of batches) {
    if (remaining <= 0.001) break;

    const available = Number(batch.quantity);
    const take = Math.min(remaining, available);

    if (take <= 0) continue;

    const deducted = await DeliveryNote.deductBatch(
      client,
      batch.id,
      take
    );

    if (!deducted) {
      throw new ApiError(
        409,
        `Stock changed while deducting batch ${batch.id}`
      );
    }

    await DeliveryNote.insertStockMovement(client, {
      companyId,
      warehouseId,
      batchId: batch.id,
      movementType: 'delivery_out',
      quantity: -take,
      unitCost: deducted.cost_price,
      referenceType: 'delivery_note',
      referenceId: deliveryNoteId,
      userId,
    });

    remaining = round3(remaining - take);
  }

  if (remaining > 0.001) {
    throw new ApiError(
      400,
      `Insufficient stock for product ${productId}. Missing: ${remaining}`
    );
  }
}

/**
 * إخراج المذكرة للشحن
 */
async function dispatch(companyId, userId, id) {
  return withTransaction(async (client) => {
    const dn = await DeliveryNote.lockById(client, companyId, id);

    if (!dn) {
      throw new ApiError(404, 'Delivery note not found');
    }

    if (dn.status !== 'draft') {
      throw new ApiError(
        400,
        `Cannot dispatch delivery note in status: ${dn.status}`
      );
    }

    const autoDeduct = await settingsService.get(
      companyId,
      'delivery_note_auto_deduct_stock',
      true,
      client
    );

    if (autoDeduct) {
      const items = await DeliveryNote.getItems(client, id);

      for (const item of items) {
        const qty = Number(item.quantity);

        if (item.batch_id) {
          await deductSpecificBatch(
            client,
            companyId,
            dn.warehouse_id,
            item.product_id,
            item.batch_id,
            qty,
            id,
            userId
          );
        } else {
          await deductFifo(
            client,
            companyId,
            dn.warehouse_id,
            item.product_id,
            qty,
            id,
            userId
          );
        }
      }
    }

    await DeliveryNote.markDispatched(client, id);

    return DeliveryNote.getById(client, companyId, id);
  });
}

/**
 * تأكيد التسليم
 */
async function markDelivered(
  companyId,
  userId,
  id,
  { delivered_to_name, signature_url } = {}
) {
  return withTransaction(async (client) => {
    const dn = await DeliveryNote.lockById(client, companyId, id);

    if (!dn) {
      throw new ApiError(404, 'Delivery note not found');
    }

    if (dn.status !== 'dispatched') {
      throw new ApiError(
        400,
        `Cannot mark delivered in status: ${dn.status}`
      );
    }

    await DeliveryNote.markDelivered(
      client,
      id,
      delivered_to_name || null,
      signature_url || null
    );

    return DeliveryNote.getById(client, companyId, id);
  });
}

/**
 * التحويل إلى فاتورة
 */
async function convertToInvoice(
  companyId,
  userId,
  id,
  { due_date } = {}
) {
  const invoiceService = require('./invoiceService');

  // الفحص النهائي وقفل المذكرة يتمان داخل
  // createFromDeliveryNote نفسها.
  const invoice = await invoiceService.createFromDeliveryNote(
    companyId,
    userId,
    id,
    { due_date }
  );

  const updatedDn = await getById(companyId, id);

  return {
    delivery_note: updatedDn,
    invoice,
  };
}

/**
 * إلغاء مذكرة التسليم وعكس حركات المخزون الأصلية
 */
async function cancel(companyId, userId, id, reason) {
  return withTransaction(async (client) => {
    const dn = await DeliveryNote.lockById(client, companyId, id);

    if (!dn) {
      throw new ApiError(404, 'Delivery note not found');
    }

    if (dn.status === 'cancelled') {
      throw new ApiError(400, 'Already cancelled');
    }

    if (dn.status === 'invoiced') {
      throw new ApiError(
        400,
        'Cannot cancel invoiced delivery note. Cancel the invoice instead.'
      );
    }

    if (dn.status === 'dispatched' || dn.status === 'delivered') {
      const movements = await DeliveryNote.getDispatchMovements(
        client,
        companyId,
        id
      );

      for (const movement of movements) {
        const quantity = Math.abs(Number(movement.quantity));

        if (!movement.batch_id) {
          throw new ApiError(
            500,
            `Cannot restore stock movement ${movement.id}: batch_id is missing`
          );
        }

        await DeliveryNote.restoreBatch(
          client,
          companyId,
          movement.batch_id,
          quantity
        );

        await DeliveryNote.insertStockMovement(client, {
          companyId,
          warehouseId: dn.warehouse_id,
          batchId: movement.batch_id,
          movementType: 'delivery_cancel',
          quantity,
          unitCost: movement.unit_cost || 0,
          referenceType: 'delivery_note_cancel',
          referenceId: id,
          userId,
        });
      }
    }

    await DeliveryNote.cancelNote(
      client,
      id,
      reason || 'no reason'
    );

    const full = await DeliveryNote.getById(
      client,
      companyId,
      id
    );

    return {
      id,
      cancelled: true,
      delivery_note: full,
    };
  });
}

/**
 * قائمة مذكرات التسليم
 */
async function list(companyId, filters = {}) {
  return DeliveryNote.list(companyId, filters);
}

module.exports = {
  list,
  getById,
  create,
  dispatch,
  markDelivered,
  convertToInvoice,
  cancel,
};
