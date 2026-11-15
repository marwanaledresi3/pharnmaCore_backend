
const { pool } = require('../config/pool');

class DeliveryNote {
  static async query(client, sql, params = []) {
    return (client || pool).query(sql, params);
  }

  static async getById(client, companyId, id) {
    const headRes = await this.query(
      client,
      `SELECT
         dn.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         c.address AS customer_address,
         w.name AS warehouse_name,
         i.invoice_number,
         so.order_number AS sales_order_number,
         u.name AS created_by_name
       FROM delivery_notes dn
       LEFT JOIN customers c ON c.id = dn.customer_id
       LEFT JOIN warehouses w ON w.id = dn.warehouse_id
       LEFT JOIN invoices i ON i.id = dn.invoice_id
       LEFT JOIN sales_orders so ON so.id = dn.sales_order_id
       LEFT JOIN users u ON u.id = dn.created_by
       WHERE dn.id = $1 AND dn.company_id = $2`,
      [id, companyId]
    );

    const head = headRes.rows[0];
    if (!head) return null;

    const itemsRes = await this.query(
      client,
      `SELECT
         dni.*,
         p.name AS product_name,
         p.sku AS product_sku,
         p.unit AS product_unit,
         pb.batch_number,
         pb.expiry_date AS batch_expiry
       FROM delivery_note_items dni
       JOIN products p ON p.id = dni.product_id
       LEFT JOIN product_batches pb ON pb.id = dni.batch_id
       WHERE dni.delivery_note_id = $1
       ORDER BY dni.sort_order ASC, dni.created_at ASC`,
      [id]
    );

    head.items = itemsRes.rows;
    return head;
  }

  static async findCustomer(client, companyId, customerId) {
    const { rows } = await this.query(
      client,
      `SELECT 1
       FROM customers
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [customerId, companyId]
    );
    return rows.length > 0;
  }

  static async findWarehouse(client, companyId, warehouseId) {
    const { rows } = await this.query(
      client,
      `SELECT 1
       FROM warehouses
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [warehouseId, companyId]
    );
    return rows.length > 0;
  }

  static async findProduct(client, companyId, productId) {
    const { rows } = await this.query(
      client,
      `SELECT 1
       FROM products
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [productId, companyId]
    );
    return rows.length > 0;
  }

  static async insertHead(client, data) {
    const {
      companyId,
      deliveryNumber,
      deliveryDate,
      customerId,
      salesOrderId,
      warehouseId,
      driverName,
      driverPhone,
      vehicleNumber,
      deliveryAddress,
      notes,
      userId,
    } = data;

    const { rows } = await this.query(
      client,
      `INSERT INTO delivery_notes
        (company_id, delivery_number, delivery_date, customer_id,
         sales_order_id, warehouse_id, driver_name, driver_phone,
         vehicle_number, delivery_address, notes, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12)
       RETURNING id, delivery_number, delivery_date, status`,
      [
        companyId,
        deliveryNumber,
        deliveryDate,
        customerId,
        salesOrderId,
        warehouseId,
        driverName,
        driverPhone,
        vehicleNumber,
        deliveryAddress,
        notes,
        userId,
      ]
    );

    return rows[0];
  }

  static async insertItem(client, deliveryNoteId, item, sortOrder) {
    return this.query(
      client,
      `INSERT INTO delivery_note_items
        (delivery_note_id, product_id, batch_id, description,
         quantity, unit_price, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        deliveryNoteId,
        item.product_id,
        item.batch_id || null,
        item.description || null,
        item.quantity,
        Number(item.unit_price) || 0,
        sortOrder,
      ]
    );
  }

  static async lockById(client, companyId, id) {
    const { rows } = await this.query(
      client,
      `SELECT *
       FROM delivery_notes
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    return rows[0] || null;
  }

  static async getItems(client, deliveryNoteId) {
    const { rows } = await this.query(
      client,
      `SELECT *
       FROM delivery_note_items
       WHERE delivery_note_id = $1
       ORDER BY sort_order ASC`,
      [deliveryNoteId]
    );
    return rows;
  }

  static async lockBatch(client, companyId, warehouseId, productId, batchId) {
    const { rows } = await this.query(
      client,
      `SELECT id, quantity, cost_price
       FROM product_batches
       WHERE id = $1
         AND company_id = $2
         AND warehouse_id = $3
         AND product_id = $4
       FOR UPDATE`,
      [batchId, companyId, warehouseId, productId]
    );
    return rows[0] || null;
  }

  static async getFifoBatches(client, companyId, warehouseId, productId) {
    const { rows } = await this.query(
      client,
      `SELECT id, quantity, cost_price
       FROM product_batches
       WHERE company_id = $1
         AND warehouse_id = $2
         AND product_id = $3
         AND quantity > 0
       ORDER BY expiry_date ASC NULLS LAST, created_at ASC, id ASC
       FOR UPDATE`,
      [companyId, warehouseId, productId]
    );
    return rows;
  }

  static async deductBatch(client, batchId, quantity) {
    const { rows } = await this.query(
      client,
      `UPDATE product_batches
       SET quantity = quantity - $1
       WHERE id = $2 AND quantity >= $1
       RETURNING id, cost_price`,
      [quantity, batchId]
    );
    return rows[0] || null;
  }

  static async restoreBatch(client, companyId, batchId, quantity) {
    return this.query(
      client,
      `UPDATE product_batches
       SET quantity = quantity + $1
       WHERE id = $2 AND company_id = $3`,
      [quantity, batchId, companyId]
    );
  }

  static async insertStockMovement(client, data) {
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

    return this.query(
      client,
      `INSERT INTO stock_movements
        (company_id, warehouse_id, batch_id, movement_type, quantity,
         unit_cost, reference_type, reference_id, created_by)
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

  static async getDispatchMovements(client, companyId, deliveryNoteId) {
    const { rows } = await this.query(
      client,
      `SELECT id, batch_id, quantity, unit_cost
       FROM stock_movements
       WHERE company_id = $1
         AND reference_type = 'delivery_note'
         AND reference_id = $2
         AND movement_type = 'delivery_out'
         AND quantity < 0
       ORDER BY id ASC
       FOR UPDATE`,
      [companyId, deliveryNoteId]
    );
    return rows;
  }

  static async markDispatched(client, id) {
    return this.query(
      client,
      `UPDATE delivery_notes
       SET status = 'dispatched', dispatched_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  static async markDelivered(
    client,
    id,
    deliveredToName,
    signatureUrl
  ) {
    return this.query(
      client,
      `UPDATE delivery_notes
       SET status = 'delivered',
           delivered_at = NOW(),
           delivered_to_name = $1,
           signature_url = $2
       WHERE id = $3`,
      [deliveredToName, signatureUrl, id]
    );
  }

  static async markInvoiced(client, companyId, id, invoiceId) {
    return this.query(
      client,
      `UPDATE delivery_notes
       SET status = 'invoiced', invoice_id = $1
       WHERE id = $2 AND company_id = $3`,
      [invoiceId, id, companyId]
    );
  }

  static async cancelNote(client, id, reason) {
    return this.query(
      client,
      `UPDATE delivery_notes
       SET status = 'cancelled',
           notes = COALESCE(notes, '') || ' | Cancelled: ' || $1
       WHERE id = $2`,
      [reason, id]
    );
  }

  static async list(companyId, filters = {}) {
    const {
      status,
      customer_id,
      warehouse_id,
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
    const conditions = ['dn.company_id = $1'];

    if (status) {
      params.push(status);
      conditions.push(`dn.status = $${params.length}`);
    }

    if (customer_id) {
      params.push(customer_id);
      conditions.push(`dn.customer_id = $${params.length}`);
    }

    if (warehouse_id) {
      params.push(warehouse_id);
      conditions.push(`dn.warehouse_id = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conditions.push(`dn.delivery_date >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(`dn.delivery_date <= $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const index = params.length;
      conditions.push(
        `(dn.delivery_number ILIKE $${index} OR c.name ILIKE $${index})`
      );
    }

    const where = conditions.join(' AND ');
    const listParams = [...params, safeLimit, offset];

    const [listResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           dn.id, dn.delivery_number, dn.delivery_date, dn.status,
           dn.customer_id, c.name AS customer_name,
           dn.warehouse_id, w.name AS warehouse_name,
           dn.invoice_id, i.invoice_number,
           dn.driver_name, dn.delivery_address,
           dn.created_at,
           u.name AS created_by_name,
           (
             SELECT COUNT(*)::int
             FROM delivery_note_items
             WHERE delivery_note_id = dn.id
           ) AS items_count
         FROM delivery_notes dn
         LEFT JOIN customers c ON c.id = dn.customer_id
         LEFT JOIN warehouses w ON w.id = dn.warehouse_id
         LEFT JOIN invoices i ON i.id = dn.invoice_id
         LEFT JOIN users u ON u.id = dn.created_by
         WHERE ${where}
         ORDER BY dn.delivery_date DESC, dn.created_at DESC
         LIMIT $${listParams.length - 1}
         OFFSET $${listParams.length}`,
        listParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM delivery_notes dn
         LEFT JOIN customers c ON c.id = dn.customer_id
         WHERE ${where}`,
        params
      ),
    ]);

    const total = countResult.rows[0].total;

    return {
      items: listResult.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }
}

module.exports = DeliveryNote;
