const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const PurchaseOrder = require('../models/PurchaseOrder');
/**
 * إنشاء فاتورة من Sales Order
 */
const createFromOrder = async (companyId, userId, orderId, { due_date } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) جلب الطلب
    const orderRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Sales order not found');
    if (order.status !== 'confirmed') {
      throw new ApiError(400, 'Only confirmed orders can be invoiced');
    }

    // 2) فحص عدم وجود فاتورة سابقة
    const existing = await Invoice.findByOrder(companyId, orderId);
    if (existing) throw new ApiError(409, 'Invoice already exists for this order');

    // 3) إنشاء الفاتورة (بدون قيد جديد — القيد موجود من confirm)
    const invoice = await Invoice.create(client, companyId, {
      invoice_type: 'sale',
      reference_type: 'sales_order',
      reference_id: orderId,
      customer_id: order.customer_id,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: due_date || null,
      currency_id: order.currency_id,
      total: order.total,
      journal_entry_id: order.journal_entry_id,
       exchange_rate: order.exchange_rate,
    });

    // 4) تحديث الطلب
    await client.query(
      `UPDATE sales_orders SET status = 'invoiced' WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');
    return invoice;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * إلغاء فاتورة
 */
const cancel = async (companyId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');
    if (inv.status === 'cancelled') throw new ApiError(400, 'Already cancelled');
    if (Number(inv.paid_amount) > 0) {
      throw new ApiError(400, 'Cannot cancel paid invoice');
    }

    // إنشاء قيد عكسي (لا نحذف الأصلي — مبدأ المحاسبة)
    if (inv.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, inv.journal_entry_id);
      if (original) {
        const reversedLines = original.lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `عكس: ${l.description || ''}`,
        }));

        const reverse = await JournalEntry.create(client, companyId, {
          entry_date: new Date().toISOString().slice(0, 10),
          description: `إلغاء فاتورة ${inv.invoice_number}`,
          source_type: 'adjustment',
          source_id: inv.id,
          created_by: null,
          lines: reversedLines,
        });
        await JournalEntry.post(client, companyId, reverse.id, null);
      }
    }

    await Invoice.cancel(client, companyId, id);
    await client.query('COMMIT');
    return { id, status: 'cancelled' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


/**
 * إنشاء فاتورة شراء من أمر شراء مؤكد
 */
const createFromPurchaseOrder = async (companyId, userId, orderId, { due_date } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new ApiError(404, 'Purchase order not found');
    if (order.status !== 'confirmed') {
      throw new ApiError(400, 'Only confirmed orders can be invoiced');
    }

    // فحص عدم وجود فاتورة سابقة
    const existing = await client.query(
      `SELECT id FROM invoices
       WHERE company_id = $1 AND reference_type = 'purchase_order' AND reference_id = $2`,
      [companyId, orderId]
    );
    if (existing.rowCount) throw new ApiError(409, 'Invoice already exists for this order');

    const invoice = await Invoice.create(client, companyId, {
      invoice_type: 'purchase',
      reference_type: 'purchase_order',
      reference_id: orderId,
      supplier_id: order.supplier_id,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: due_date || null,
      currency_id: order.currency_id,
      total: order.total,
      journal_entry_id: order.journal_entry_id,
    });

    await client.query(
      `UPDATE purchase_orders SET status = 'invoiced' WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');
    return invoice;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { createFromOrder, createFromPurchaseOrder, cancel };
