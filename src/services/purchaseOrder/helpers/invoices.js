// services/purchaseOrder/helpers/invoices.js
const ApiError = require('../../../errors/ApiError');
const NumberingService = require('../../numberingService');
const { ensureCustomer } = require('./customers');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function createSalesInvoiceForSupplier(client, { order, userId }) {
  if (!order.supplier_company_id) {
    throw new ApiError(500, 'createSalesInvoiceForSupplier requires a network supplier_company_id');
  }

  const totalNum = Number(order.total);
  if (!Number.isFinite(totalNum) || totalNum < 0) throw new ApiError(500, `Invalid order.total: ${order.total}`);

  const currencyCheck = await client.query(`SELECT id FROM currencies WHERE id = $1`, [order.currency_id]);
  if (!currencyCheck.rowCount) throw new ApiError(400, `Currency ${order.currency_id} not found`);

  const customerId = await ensureCustomer(client, {
    supplierCompanyId: order.supplier_company_id,
    buyerCompanyId: order.company_id,
  });

  const invoiceNumber = await NumberingService.next(client, order.supplier_company_id, 'sales_invoice', { prefix: 'SI', pad: 5 });

  const inv = await client.query(
    `INSERT INTO invoices
       (company_id, invoice_number, invoice_type, reference_type, reference_id, customer_id,
        invoice_date, due_date, currency_id, exchange_rate, total, paid_amount, status, journal_entry_id)
     VALUES ($1, $2, 'sales', 'purchase_order', $3, $4, $5, $6, $7, $8, $9, 0, 'unpaid', NULL)
     RETURNING id, invoice_number`,
    [order.supplier_company_id, invoiceNumber, order.id, customerId, order.order_date, order.due_date || order.order_date, order.currency_id, Number(order.exchange_rate) || 1, totalNum]
  );
  const invoiceId = inv.rows[0].id;

  const items = await client.query(`SELECT * FROM purchase_order_items WHERE order_id = $1 ORDER BY id`, [order.id]);

  for (const it of items.rows) {
    const supplierProductId = it.supplier_product_id;
    if (!supplierProductId) throw new ApiError(500, `supplier_product_id is required for network supplier invoice (item ${it.id})`);

    const paidQty = Number(it.paid_quantity);
    const bonusQty = Number(it.bonus_quantity) || 0;
    if (!Number.isFinite(paidQty) || paidQty <= 0) throw new ApiError(500, `Invalid paid_quantity for item ${it.id}`);

    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, description, quantity, bonus_quantity,
          unit_price, net_unit_price, discount_rate, discount_amount, tax_rate, tax_amount, line_total,
          batch_id, batch_number, expiry_date, unit_id, conversion_factor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [invoiceId, supplierProductId, it.description || null, paidQty, bonusQty,
       round2(it.unit_price), round2(it.net_unit_price || it.unit_price),
       Number(it.discount_rate) || 0, round2(it.discount_amount || 0),
       Number(it.tax_rate) || 0, round2(it.tax_amount || 0), round2(it.line_total),
       it.batch_id || null, it.batch_number || null, it.expiry_date || null,
       it.unit_id || null, Number(it.conversion_factor) || 1]
    );
  }

  return { id: invoiceId, invoice_number: inv.rows[0].invoice_number };
}

async function createPurchaseInvoiceForBuyer(client, { order, userId }) {
  const totalNum = Number(order.total);
  if (!Number.isFinite(totalNum) || totalNum < 0) throw new ApiError(500, `Invalid order.total: ${order.total}`);

  const currencyCheck = await client.query(`SELECT id FROM currencies WHERE id = $1`, [order.currency_id]);
  if (!currencyCheck.rowCount) throw new ApiError(400, `Currency ${order.currency_id} not found`);

  const invoiceNumber = await NumberingService.next(client, order.company_id, 'purchase_invoice', { prefix: 'PI', pad: 5 });

  const inv = await client.query(
    `INSERT INTO invoices
       (company_id, invoice_number, invoice_type, reference_type, reference_id, supplier_id,
        invoice_date, due_date, currency_id, exchange_rate, total, paid_amount, status, journal_entry_id)
     VALUES ($1, $2, 'purchase', 'purchase_order', $3, $4, $5, $6, $7, $8, $9, 0, 'unpaid', NULL)
     RETURNING id, invoice_number`,
    [order.company_id, invoiceNumber, order.id, order.supplier_id, order.order_date, order.due_date || order.order_date, order.currency_id, Number(order.exchange_rate) || 1, totalNum]
  );
  const invoiceId = inv.rows[0].id;

  const items = await client.query(`SELECT * FROM purchase_order_items WHERE order_id = $1 ORDER BY id`, [order.id]);

  for (const it of items.rows) {
    const productId = it.product_id;
    if (!productId) throw new ApiError(500, `product_id is required for purchase invoice (item ${it.id})`);

    const paidQty = Number(it.paid_quantity);
    const bonusQty = Number(it.bonus_quantity) || 0;
    if (!Number.isFinite(paidQty) || paidQty <= 0) throw new ApiError(500, `Invalid paid_quantity for item ${it.id}`);

    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, description, quantity, bonus_quantity,
          unit_price, net_unit_price, discount_rate, discount_amount, tax_rate, tax_amount, line_total,
          batch_id, batch_number, expiry_date, unit_id, conversion_factor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [invoiceId, productId, it.description || null, paidQty, bonusQty,
       round2(it.unit_price), round2(it.net_unit_price || it.unit_price),
       Number(it.discount_rate) || 0, round2(it.discount_amount || 0),
       Number(it.tax_rate) || 0, round2(it.tax_amount || 0), round2(it.line_total),
       it.batch_id || null, it.batch_number || null, it.expiry_date || null,
       it.unit_id || null, Number(it.conversion_factor) || 1]
    );
  }

  return { id: invoiceId, invoice_number: inv.rows[0].invoice_number };
}

module.exports = { createSalesInvoiceForSupplier, createPurchaseInvoiceForBuyer };