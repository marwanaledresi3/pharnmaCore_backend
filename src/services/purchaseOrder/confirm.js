const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const NotificationService = require('../notificationService');
const QRService = require('../qrService');
const ReservationService = require('../reservationService');
const { confirmInventory } = require('./helpers/stock');
const { createSalesInvoiceForSupplier, createPurchaseInvoiceForBuyer } = require('./helpers/invoices');
const {
  createBuyerJournalEntry,
  createSupplierJournalEntries,
} = require('./helpers/journal');
const { handlePayment } = require('./helpers/payment');
const { updateProductCost } = require('./helpers/products');
const { markQRUsed } = require('./helpers/qr');

/**
 * تأكيد استلام البضاعة من المشتري.
 */
async function confirm(companyId, userId, orderId, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

      // 1) جلب الطلب + قفل
    const order = await loadOrderForConfirm(client, companyId, orderId);

    // 2) استلام المشتري (مخزون + stock_movements)
    const inventory = await confirmInventory(client, {
      order,
      buyerCompanyId: companyId,
      supplierCompanyId: order.supplier_company_id,
      userId,
    });

    // 3) خصم مخزون المورد (من الحجوزات)
    if (order.supplier_company_id) {
      await ReservationService.consumeForOrder(client, {
        orderId: order.id,
        userId,
        orderDate: order.order_date,
      });
    }
    

    // 3) تحديث تكلفة/سعر البيع للمنتجات (المشتري)
    for (const b of inventory.buyerBatches) {
      const item = (await client.query(
        `SELECT net_unit_price, unit_price FROM purchase_order_items
         WHERE order_id = $1 AND product_id = $2 LIMIT 1`,
        [order.id, b.product_id]
      )).rows[0];
      if (item) {
        const unitCost =
          Number(item.net_unit_price) > 0 ? Number(item.net_unit_price) : Number(item.unit_price);
        await updateProductCost(client, {
          companyId,
          productId: b.product_id,
          unitCost,
        });
      }
    }
// 4) فاتورة مشتريات للمشتري (جديد)
const purchaseInvoice = await createPurchaseInvoiceForBuyer(client, { order, userId });

// 5) قيد المشتري (استحقاق)
const buyerEntryId = await createBuyerJournalEntry(client, { order, companyId, userId });

// اربط فاتورة المشتري بقيدها
await client.query(
  `UPDATE invoices SET journal_entry_id = $1 WHERE id = $2`,
  [buyerEntryId, purchaseInvoice.id]
);

// 6) فاتورة مبيعات للمورد + قيوده
let salesInvoice = null;
if (order.supplier_company_id) {
  salesInvoice = await createSalesInvoiceForSupplier(client, { order, userId });
}
   


  

    // 6) قيود المورد
    let supplierEntries = null;
    if (salesInvoice) {
      supplierEntries = await createSupplierJournalEntries(client, {
        order,
        salesInvoice,
        inventory,
        userId,
      });
    }

    // 7) الدفع
    const payment = await handlePayment(client, {
      order,
      companyId,
      userId,
      supplierCompanyId: order.supplier_company_id,
      salesInvoiceId: salesInvoice?.id || null,
 purchaseInvoiceId: purchaseInvoice.id,  
    });

    // 8) تعليم QR
    if (opts.deliveryToken) {
      await markQRUsed(client, {
        token: opts.deliveryToken,
        userId,
        usedMode: opts.usedMode || 'authenticated',
      });
    }

    // 9) تحديث الطلب
    await client.query(
      `UPDATE purchase_orders
      SET status = 'confirmed',
          journal_entry_id = $1,
          paid_amount = $2,
          paid_at = $3
      WHERE id = $4`,
      [buyerEntryId, payment.paid_amount, payment.paid_at, order.id]
    );
    // 9.1) ألغِ كل QR نشط — التأكيد تم عبر الزر لا عبر QR
    if (!opts.deliveryToken) {
      await QRService.revokeForOrder(client, order.id, {
        userId,
        reason: 'تم التأكيد عبر الزر العادي',
      });
    }

    // 10) إشعار المورد
    if (order.supplier_company_id) {
      await NotificationService.purchaseOrderConfirmed(client, {
        order,
        supplierCompanyId: order.supplier_company_id,
      });
    }

    await client.query('COMMIT');

    return {
      id: order.id,
      status: 'confirmed',
      journal_entry_id: buyerEntryId,
      purchase_invoice_id: purchaseInvoice.id,            
      purchase_invoice_number: purchaseInvoice.invoice_number,  
      sales_invoice_id: salesInvoice?.id || null,
      sales_invoice_number: salesInvoice?.invoice_number || null,
      supplier_journal_entries: supplierEntries,
      total_inventory_cost: inventory.totalCost,
      payment: {
        type: payment.type,
        paid_amount: payment.paid_amount,
        paid_at: payment.paid_at,
        payment_id: payment.payment_id || null,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadOrderForConfirm(client, companyId, orderId) {
  const r = await client.query(
    `SELECT po.*, s.name AS supplier_name
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = $1 AND po.company_id = $2
     FOR UPDATE`,
    [orderId, companyId]
  );
  const order = r.rows[0];
  if (!order) throw new ApiError(404, 'Purchase order not found');

  if (order.supplier_company_id) {
    if (order.status !== 'approved') {
      throw new ApiError(400, 'Network purchase orders must be approved by the supplier first');
    }
  } else if (order.status !== 'draft') {
    throw new ApiError(400, 'Only draft local purchase orders can be confirmed');
  }

  return order;
}

async function confirmByToken(companyId, userId, token, opts = {}) {
  const client = await pool.connect();
  try {
    const { payload } = await QRService.verify(client, token, {
      mode: 'authenticated',
      userCompanyId: companyId,
    });

    return await confirm(companyId, userId, payload.order_id, {
      deliveryToken: token,
      usedMode: 'authenticated',
    });
  } finally {
    client.release();
  }
}

module.exports = { confirm, confirmByToken };