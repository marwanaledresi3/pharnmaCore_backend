const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const Return = require('../../models/Return');
const { round2 } = require('./helpers/rounding');

const createSaleReturn = async (companyId, userId, payload) =>
  createReturn(companyId, userId, 'sales', payload);

const createPurchaseReturn = async (companyId, userId, payload) =>
  createReturn(companyId, userId, 'purchase', payload);

const createReturn = async (companyId, userId, returnType, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) تحقق من الفاتورة
    const invoiceType = returnType === 'sales' ? 'sales' : 'purchase';

    console.log('[createReturn] returnType:', returnType, '→ invoiceType:', invoiceType);

    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type = $3 AND status <> 'cancelled'`,
      [payload.invoice_id, companyId, invoiceType]
    );
    const invoice = invRes.rows[0];
    if (!invoice) throw new ApiError(400, 'Invoice not found or invalid type');

    // 2) تحقق من الطرف
    if (returnType === 'sales' && !invoice.customer_id) {
      throw new ApiError(400, 'sales invoice must have customer');
    }
    if (returnType === 'purchase' && !invoice.supplier_id) {
      throw new ApiError(400, 'Purchase invoice must have supplier');
    }

    // 3) اقرأ سطور الفاتورة الأصلية
    const sourceOrderId = invoice.reference_id;
    const sourceItemsTable =
      returnType === 'sales' ? 'sales_order_items' : 'purchase_order_items';

    const enrichedItems = [];
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of payload.items) {
      const origRes = await client.query(
        `SELECT * FROM ${sourceItemsTable}
         WHERE order_id = $1 AND product_id = $2
         LIMIT 1`,
        [sourceOrderId, item.product_id]
      );

      if (!origRes.rowCount) {
        throw new ApiError(400, `Product ${item.product_id} not found in original invoice`);
      }
      const orig = origRes.rows[0];

      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, 'Quantity must be > 0');
      }
      if (qty > Number(orig.quantity)) {
        throw new ApiError(
          400,
          `Quantity cannot exceed original (${orig.quantity})`
        );
      }

      // تحقق من المرتجعات السابقة
      const prevRes = await client.query(
        `SELECT COALESCE(SUM(ri.quantity), 0)::numeric AS total_returned
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE r.invoice_id = $1 AND ri.product_id = $2 AND r.status <> 'cancelled'`,
        [payload.invoice_id, item.product_id]
      );
      const alreadyReturned = Number(prevRes.rows[0].total_returned);
      if (alreadyReturned + qty > Number(orig.quantity)) {
        throw new ApiError(
          400,
          `Total returned (${alreadyReturned + qty}) exceeds original (${orig.quantity})`
        );
      }

      const netUnitPrice =
        Number(item.unit_price || orig.net_unit_price || orig.unit_price);
      const taxRate = Number(item.tax_rate ?? orig.tax_rate ?? 0);
      const lineSubtotal = round2(qty * netUnitPrice);
      const taxAmount = round2(lineSubtotal * (taxRate / 100));
      const lineTotal = round2(lineSubtotal + taxAmount);
      const costPrice = Number(orig.cost_price || netUnitPrice || 0);

      subtotal = round2(subtotal + lineSubtotal);
      taxTotal = round2(taxTotal + taxAmount);

      enrichedItems.push({
        original_item_id: orig.id,
        product_id: item.product_id,
        batch_id: item.batch_id || null,
        quantity: qty,
        unit_price: netUnitPrice,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        line_total: lineTotal,
        cost_price: costPrice,
      });
    }

    // 4) أنشئ المرتجع
    const ret = await Return.create(client, companyId, {
      return_type: returnType,
      invoice_id: invoice.id,
      reference_type: invoice.reference_type,
      reference_id: invoice.reference_id,
      customer_id: invoice.customer_id,
      supplier_id: invoice.supplier_id,
      return_date: payload.return_date || new Date().toISOString().slice(0, 10),
      currency_id: invoice.currency_id,
      exchange_rate: invoice.exchange_rate || 1,
      subtotal,
      tax_total: taxTotal,
      total: round2(subtotal + taxTotal),
      reason: payload.reason,
      created_by: userId,
      items: enrichedItems,
    });

    await client.query('COMMIT');
    return Return.findById(companyId, ret.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { createSaleReturn, createPurchaseReturn };