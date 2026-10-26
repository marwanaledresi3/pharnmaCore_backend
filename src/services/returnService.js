const {pool} = require('../config/pool');
const ApiError = require('../errors/ApiError');
const Return = require('../models/Return');
const JournalEntry = require('../models/JournalEntry');
const Notification = require('../models/Notification');

/**
 * إنشاء مرتجع بيع
 */
const createSaleReturn = async (companyId, userId, payload) => {
  return createReturn(companyId, userId, 'sale', payload);
};

/**
 * إنشاء مرتجع شراء
 */
const createPurchaseReturn = async (companyId, userId, payload) => {
  return createReturn(companyId, userId, 'purchase', payload);
};

/**
 * إنشاء مرتجع (بيع أو شراء)
 */
const createReturn = async (companyId, userId, returnType, payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) تحقق من الفاتورة
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type = $3 AND status <> 'cancelled'`,
      [payload.invoice_id, companyId, returnType]
    );
    const invoice = invRes.rows[0];
    if (!invoice) throw new ApiError(400, 'Invoice not found or invalid type');

    // 2) تحقق أن الطرف صحيح
    if (returnType === 'sale' && !invoice.customer_id) {
      throw new ApiError(400, 'Sale invoice must have customer');
    }
    if (returnType === 'purchase' && !invoice.supplier_id) {
      throw new ApiError(400, 'Purchase invoice must have supplier');
    }

    // 3) تحقق من السطور والكميات
    const enrichedItems = [];
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of payload.items) {
      // ابحث عن السطر الأصلي في الفاتورة
      const origItemRes = await client.query(
        `SELECT * FROM ${returnType === 'sale' ? 'sales_order_items' : 'purchase_order_items'} 
         WHERE order_id = (SELECT reference_id FROM invoices WHERE id = $1) AND product_id = $2 LIMIT 1`,
        [payload.invoice_id, item.product_id]
      );
      const orig = origItemRes.rows[0];
      
      // نعتمد net_unit_price بدلاً من unit_price الخام لضمان عدالة المرتجعات بعد الخصم والبونص
      const netUnitPrice = Number(orig.net_unit_price || orig.unit_price);
      const qty = Number(item.quantity);
      
      const taxRate = Number(item.tax_rate ?? orig.tax_rate);
      const lineSubtotal = qty * netUnitPrice;
      const taxAmount = lineSubtotal * (taxRate / 100);
      const lineTotal = lineSubtotal + taxAmount;

      if (!originalItem.rowCount) {
        throw new ApiError(400, `Product ${item.product_id} not found in original invoice`);
      }

      
      if (qty <= 0) throw new ApiError(400, 'Quantity must be > 0');
      if (qty > Number(orig.quantity)) {
        throw new ApiError(400, `Quantity cannot exceed original (${orig.quantity}) for ${orig.product_name}`);
      }

      // تحقق من إجمالي المرتجع من هذا المنتج عبر كل المرتجعات السابقة لهذه الفاتورة
      const prevReturns = await client.query(
        `SELECT COALESCE(SUM(ri.quantity), 0)::numeric AS total_returned
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE r.invoice_id = $1 AND ri.product_id = $2 AND r.status <> 'cancelled'`,
        [payload.invoice_id, item.product_id]
      );

      const alreadyReturned = Number(prevReturns.rows[0].total_returned);
      if (alreadyReturned + qty > Number(orig.quantity)) {
        throw new ApiError(400,
          `Total returned (${alreadyReturned + qty}) exceeds original (${orig.quantity}) for ${orig.product_name}`
        );
      }

      // احسب المبالغ
      const unitPrice = Number(item.unit_price || orig.unit_price);
      

      subtotal += lineSubtotal;
      taxTotal += taxAmount;

      // التكلفة (لإرجاع المخزون)
      const costPrice = Number(orig.cost_price || orig.unit_price || 0);

      enrichedItems.push({
        original_item_id: orig.id,
        product_id: item.product_id,
        batch_id: item.batch_id || null,
        quantity: qty,
        unit_price: unitPrice,
        tax_rate: taxRate,
        tax_amount: round2(taxAmount),
        line_total: round2(lineTotal),
        cost_price: costPrice,
      });
    }

    // 4) إنشاء المرتجع
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
      subtotal: round2(subtotal),
      tax_total: round2(taxTotal),
      total: round2(subtotal + taxTotal),
      reason: payload.reason,
      created_by: userId,
      items: enrichedItems,
    });

    await client.query('COMMIT');

    // إرجاع المرتجع الكامل
    return Return.findById(companyId, ret.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * تأكيد مرتجع → تعديل المخزون + القيد العكسي
 */
const confirm = async (companyId, userId, returnId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const retRes = await client.query(
      `SELECT * FROM returns WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [returnId, companyId]
    );
    const ret = retRes.rows[0];
    if (!ret) throw new ApiError(404, 'Return not found');
    if (ret.status !== 'draft') throw new ApiError(400, 'Only draft returns can be confirmed');

    const itemsRes = await client.query(
      `SELECT ri.*, p.name AS product_name
       FROM return_items ri
       JOIN products p ON p.id = ri.product_id
       WHERE ri.return_id = $1`,
      [returnId]
    );

    // ─── تعديل المخزون ───
    let totalInventoryChange = 0;
    for (const item of itemsRes.rows) {
      if (ret.return_type === 'sale') {
        // مرتجع بيع → إرجاع للـ batch
        if (item.batch_id) {
          await client.query(
            `UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`,
            [item.quantity, item.batch_id]
          );
          // سجل حركة
          await client.query(
            `INSERT INTO stock_movements
               (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
                reference_type, reference_id, movement_date, created_by)
             SELECT $1, b.warehouse_id, b.id, 'in', $2, b.cost_price,
                    'sale_return', $3, $4, $5
             FROM product_batches b WHERE b.id = $6`,
            [companyId, item.quantity, returnId, ret.return_date, userId, item.batch_id]
          );
        } else {
          // أنشئ batch جديد (أو ابحث عن الأصلي)
          const warehouseRes = await client.query(
            `SELECT id FROM warehouses WHERE company_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`,
            [companyId]
          );
          const warehouseId = warehouseRes.rows[0].id;
          const newBatch = await client.query(
            `INSERT INTO product_batches
               (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
             VALUES ($1, $2, $3, $4, '2099-12-31', $5, $6)
             RETURNING id`,
            [companyId, item.product_id, warehouseId,
             `RTN-${returnId.slice(0, 8)}`, item.cost_price, item.quantity]
          );
          await client.query(
            `INSERT INTO stock_movements
               (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
                reference_type, reference_id, movement_date, created_by)
             VALUES ($1, $2, $3, 'in', $4, $5, 'sale_return', $6, $7, $8)`,
            [companyId, warehouseId, newBatch.rows[0].id, item.quantity,
             item.cost_price, returnId, ret.return_date, userId]
          );
        }
        totalInventoryChange += Number(item.quantity) * Number(item.cost_price);
      } else {
        // مرتجع شراء → خصم من المخزون
        if (!item.batch_id) {
          throw new ApiError(400, 'Purchase return requires batch_id for stock out');
        }
        const batch = await client.query(
          `SELECT quantity, cost_price, warehouse_id FROM product_batches WHERE id = $1 FOR UPDATE`,
          [item.batch_id]
        );
        if (!batch.rowCount || Number(batch.rows[0].quantity) < Number(item.quantity)) {
          throw new ApiError(400, `Insufficient stock in batch for ${item.product_name}`);
        }
        await client.query(
          `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`,
          [item.quantity, item.batch_id]
        );
        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           VALUES ($1, $2, $3, 'out', $4, $5, 'purchase_return', $6, $7, $8)`,
          [companyId, batch.rows[0].warehouse_id, item.batch_id, item.quantity,
           batch.rows[0].cost_price, returnId, ret.return_date, userId]
        );
        totalInventoryChange += Number(item.quantity) * Number(batch.rows[0].cost_price);
      }
    }

    // ─── القيد العكسي ───
    const accounts = await getDefaultAccounts(client, companyId);
    const rate = Number(ret.exchange_rate) || 1;
    const totalBase = round2(Number(ret.total) * rate);
    const subtotalBase = round2(Number(ret.subtotal) * rate);
    const taxBase = round2(Number(ret.tax_total) * rate);

    const lines = [];

    if (ret.return_type === 'sale') {
      // عكس قيد البيع:
      //   مدين: إيراد (subtotal)
      //   مدين: ضريبة (tax)
      //     دائن: ذمم مدينة (total)
      // + إرجاع المخزون:
      //   مدين: مخزون
      //     دائن: COGS
      lines.push(
        { account_id: accounts.revenue, debit: subtotalBase, credit: 0, description: 'مرتجع مبيعات' },
      );
      if (taxBase > 0) {
        lines.push({ account_id: accounts.vat, debit: taxBase, credit: 0, description: 'ضريبة مرتجعة' });
      }
      lines.push({ account_id: accounts.receivable, credit: totalBase, debit: 0, description: `مرتجع فاتورة ${ret.return_number}` });

      // إرجاع المخزون
      if (totalInventoryChange > 0) {
        lines.push(
          { account_id: accounts.inventory, debit: totalInventoryChange, credit: 0, description: 'إرجاع مخزون' },
          { account_id: accounts.cogs, credit: totalInventoryChange, debit: 0, description: 'عكس تكلفة' },
        );
      }
    } else {
      // عكس قيد الشراء:
      //   مدين: ذمم دائنة (total)
      //     دائن: مخزون (subtotal)
      //     دائن: ضريبة (tax)
      // + خصم المخزون:
      //   مدين: ... (نستخدم COGS كحساب مؤقت، أو نستخدم نفس منطق الشراء)
      lines.push(
        { account_id: accounts.payable, debit: totalBase, credit: 0, description: `مرتجع شراء ${ret.return_number}` },
      );
      lines.push({ account_id: accounts.inventory, credit: subtotalBase, debit: 0, description: 'مرتجع مخزون' });
      if (taxBase > 0) {
        lines.push({ account_id: accounts.vat, credit: taxBase, debit: 0, description: 'ضريبة مدخلات مرتجعة' });
      }
    }

    const entry = await JournalEntry.create(client, companyId, {
      entry_date: ret.return_date,
      description: `قيد مرتجع ${ret.return_type === 'sale' ? 'بيع' : 'شراء'} ${ret.return_number}`,
      source_type: ret.return_type === 'sale' ? 'sale_return' : 'purchase_return',
      source_id: returnId,
      created_by: userId,
      lines,
    });
    await JournalEntry.post(client, companyId, entry.id, userId);

    // ─── تحديث المرتجع ───
    await Return.updateStatus(companyId, returnId, 'confirmed');
    await Return.linkJournalEntry(companyId, returnId, entry.id);

    await client.query('COMMIT');
    const client2 = await pool.connect();
        try {
            await Notification.create(client2, {
                companyId,
                type: 'general',
                title: `مرتجع ${ret.return_type === 'sale' ? 'بيع' : 'شراء'}`,
                message: `تم تأكيد المرتجع ${ret.return_number} بمبلغ ${ret.total}.`,
                metadata: { return_id: returnId, return_type: ret.return_type, total: Number(ret.total) },
                referenceType: 'return',
                referenceId: returnId,
                uniqueKey: `return_confirmed:${returnId}`,
            });
        } finally {
        client2.release();
        }
    return { id: returnId, status: 'confirmed', journal_entry_id: entry.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * إلغاء مرتجع (فقط draft)
 */
const cancel = async (companyId, returnId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ret = await client.query(
      `SELECT status FROM returns WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [returnId, companyId]
    );
    if (!ret.rowCount) throw new ApiError(404, 'Return not found');
    if (ret.rows[0].status !== 'draft') {
      throw new ApiError(400, 'Only draft returns can be cancelled');
    }

    await Return.updateStatus(companyId, returnId, 'cancelled');
    await client.query('COMMIT');
    return { id: returnId, status: 'cancelled' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ============ Helpers ============

async function getDefaultAccounts(client, companyId) {
  const codes = {
    receivable: '1120',
    payable: '2110',
    revenue: '4100',
    vat: '2120',
    cogs: '5100',
    inventory: '1130',
  };
  const r = await client.query(
    `SELECT code, id FROM chart_of_accounts
     WHERE company_id = $1 AND code = ANY($2::text[])`,
    [companyId, Object.values(codes)]
  );
  const map = {};
  for (const row of r.rows) {
    const key = Object.keys(codes).find((k) => codes[k] === row.code);
    if (key) map[key] = row.id;
  }
  for (const [key, code] of Object.entries(codes)) {
    if (!map[key]) throw new ApiError(500, `Required account ${code} not found`);
  }
  return map;
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

module.exports = { createSaleReturn, createPurchaseReturn, confirm, cancel };