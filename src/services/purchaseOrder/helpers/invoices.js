const NumberingService = require('../../numberingService');

/**
 * إنشاء فاتورة مبيعات في شركة المورد + customer + invoice_items.
 */
async function createSalesInvoiceForSupplier(client, { order, userId }) {
  const customerId = await ensureCustomer(client, {
    supplierCompanyId: order.supplier_company_id,
    buyerCompanyId: order.company_id,
  });

  const invoiceNumber = await NumberingService.next(
    client,
    order.supplier_company_id,
    'sales_invoice',
    { prefix: 'SI', pad: 5 }
  );

  const inv = await client.query(
    `INSERT INTO invoices
       (company_id, invoice_number, invoice_type, reference_type, reference_id,
        customer_id, invoice_date, due_date, currency_id, exchange_rate,
        total, paid_amount, status, journal_entry_id)
     VALUES ($1,$2,'sales','purchase_order',$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)
     RETURNING id, invoice_number`,
    [
      order.supplier_company_id,
      invoiceNumber,
      order.id,
      customerId,
      order.order_date,
      order.due_date || null,
      order.currency_id,
      order.exchange_rate,
      order.total,
      0,
      'unpaid',
    ]
  );
  const invoiceId = inv.rows[0].id;

  const items = await client.query(
    `SELECT * FROM purchase_order_items WHERE order_id = $1`,
    [order.id]
  );

  for (const it of items.rows) {
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, description, quantity, bonus_quantity,
          unit_price, net_unit_price, discount_rate, discount_amount,
          tax_rate, tax_amount, line_total, batch_id, batch_number, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$14)`,
      [
        invoiceId,
        it.supplier_product_id || it.product_id,
        null,
        it.quantity,
        it.bonus_quantity,
        it.unit_price,
        it.net_unit_price,
        it.discount_rate,
        it.discount_amount,
        it.tax_rate,
        it.tax_amount,
        it.line_total,
        it.batch_number,
        it.expiry_date,
      ]
    );
  }

  return { id: invoiceId, invoice_number: inv.rows[0].invoice_number };
}

async function ensureCustomer(client, { supplierCompanyId, buyerCompanyId }) {
  const existing = await client.query(
    `SELECT id FROM customers WHERE company_id = $1 AND source_company_id = $2`,
    [supplierCompanyId, buyerCompanyId]
  );
  if (existing.rowCount) return existing.rows[0].id;

  const buyer = await client.query(
    `SELECT name, phone, email, address, tax_number FROM companies WHERE id = $1`,
    [buyerCompanyId]
  );
  const b = buyer.rows[0];

  const ins = await client.query(
    `INSERT INTO customers
       (company_id, source_company_id, name, phone, email, address, tax_number, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
     RETURNING id`,
    [
      supplierCompanyId,
      buyerCompanyId,
      b?.name || 'عميل شبكي',
      b?.phone || null,
      b?.email || null,
      b?.address || null,
      b?.tax_number || null,
    ]
  );
  return ins.rows[0].id;
}



/**
 * إنشاء فاتورة مشتريات في شركة المشتري.
 * - invoice_type = 'purchase'
 * - supplier_id = المورد
 * - company_id = المشتري
 */
async function createPurchaseInvoiceForBuyer(client, { order, userId }) {
  const invoiceNumber = await NumberingService.next(
    client,
    order.company_id,
    'purchase_invoice',
    { prefix: 'PI', pad: 5 }
  );

  const inv = await client.query(
    `INSERT INTO invoices
       (company_id, invoice_number, invoice_type, reference_type, reference_id,
        supplier_id, invoice_date, due_date, currency_id, exchange_rate,
        total, paid_amount, status, journal_entry_id)
     VALUES ($1,$2,'purchase','purchase_order',$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)
     RETURNING id, invoice_number`,
    [
      order.company_id,
      invoiceNumber,
      order.id,
      order.supplier_id,
      order.order_date,
      order.due_date || null,
      order.currency_id,
      order.exchange_rate,
      order.total,
      0,
      'unpaid',
    ]
  );
  const invoiceId = inv.rows[0].id;

  const items = await client.query(
    `SELECT * FROM purchase_order_items WHERE order_id = $1`,
    [order.id]
  );

  for (const it of items.rows) {
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, description, quantity, bonus_quantity,
          unit_price, net_unit_price, discount_rate, discount_amount,
          tax_rate, tax_amount, line_total, batch_id, batch_number, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$14)`,
      [
        invoiceId,
        it.product_id,
        null,
        it.quantity,
        it.bonus_quantity,
        it.unit_price,
        it.net_unit_price,
        it.discount_rate,
        it.discount_amount,
        it.tax_rate,
        it.tax_amount,
        it.line_total,
        it.batch_number,
        it.expiry_date,
      ]
    );
  }

  return { id: invoiceId, invoice_number: inv.rows[0].invoice_number };
}

// حدّث module.exports
module.exports = {
  createSalesInvoiceForSupplier,
  createPurchaseInvoiceForBuyer,   // ← أضف
};