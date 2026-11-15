const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('./numberingService');
const JournalEntry = require('../models/JournalEntry');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
  buildGoodsReceiptLines,
} = require('./journalHelper');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

function defaultExpiry() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().slice(0, 10);
}

/**
 * بحث عن دفعة موجودة (داخل transaction) مع FOR UPDATE
 */
async function findBatchForUpdate(client, { companyId, productId, warehouseId, batchNumber }) {
  const r = await client.query(
    `SELECT id, quantity, cost_price
     FROM product_batches
     WHERE company_id = $1
       AND product_id = $2
       AND warehouse_id = $3
       AND batch_number = $4
     FOR UPDATE`,
    [companyId, productId, warehouseId, batchNumber]
  );
  return r.rows[0] || null;
}

/**
 * إنشاء دفعة جديدة باستخدام SAVEPOINT
 * - عند تعارض UNIQUE (23505): ROLLBACK TO SAVEPOINT + إعادة البحث
 * - يضمن عدم فشل الـ transaction الأم
 */
async function createBatchWithSavepoint(client, {
  companyId, productId, warehouseId, batchNumber, expiryDate, costPrice, quantity,
}) {
  const SAVEPOINT_NAME = `create_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1) إنشاء savepoint
  await client.query(`SAVEPOINT ${SAVEPOINT_NAME}`);

  try {
    // 2) محاولة INSERT
    const ins = await client.query(
      `INSERT INTO product_batches
        (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [companyId, productId, warehouseId, batchNumber, expiryDate, costPrice, quantity]
    );

    // 3) نجح → release savepoint
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT_NAME}`);
    return { id: ins.rows[0].id, created: true };
  } catch (err) {
    // 4) فشل → rollback إلى savepoint
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`);

    // 4.1) لو تعارض UNIQUE → أعد البحث
    if (err.code === '23505') {
      const existing = await findBatchForUpdate(client, {
        companyId, productId, warehouseId, batchNumber,
      });
      if (!existing) {
        // تعارض غريب — لم نجد الدفعة
        throw new ApiError(
          500,
          `تعارض في إنشاء الدفعة ${batchNumber} — لم يتم العثور عليها بعد التعارض`
        );
      }
      return { id: existing.id, created: false, existing };
    }

    // 4.2) خطأ آخر → أعد رفعه (بعد rollback)
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════

async function generateNumber(client, companyId) {
  return NumberingService.next(client, companyId, 'goods_receipt');
}

async function getById(client, companyId, id) {
  const headRes = await client.query(
    `SELECT
       gr.*,
       s.name AS supplier_name,
       s.phone AS supplier_phone,
       w.name AS warehouse_name,
       po.order_number AS purchase_order_number,
       u.name AS created_by_name,
       cu.name AS confirmed_by_name,
       x.name AS cancelled_by_name,
       cur.code AS currency_code,
       cur.symbol AS currency_symbol
     FROM goods_receipts gr
     LEFT JOIN suppliers s ON s.id = gr.supplier_id
     LEFT JOIN warehouses w ON w.id = gr.warehouse_id
     LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id
     LEFT JOIN users u ON u.id = gr.created_by
     LEFT JOIN users cu ON cu.id = gr.confirmed_by
     LEFT JOIN users x ON x.id = gr.cancelled_by
     LEFT JOIN currencies cur ON cur.id = gr.currency_id
     WHERE gr.id = $1 AND gr.company_id = $2`,
    [id, companyId]
  );
  const head = headRes.rows[0];
  if (!head) return null;

  const itemsRes = await client.query(
    `SELECT
       gri.*,
       p.name AS product_name,
       p.sku AS product_sku,
       p.unit AS product_unit
     FROM goods_receipt_items gri
     JOIN products p ON p.id = gri.product_id
     WHERE gri.receipt_id = $1
     ORDER BY gri.sort_order ASC, gri.created_at ASC`,
    [id]
  );

  head.items = itemsRes.rows;
  return head;
}

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
      throw new ApiError(400, `Invalid quantity for product ${item.product_id}`);
    }

    const pCheck = await client.query(
      `SELECT 1 FROM products WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [item.product_id, companyId]
    );
    if (!pCheck.rowCount) {
      throw new ApiError(400, `Product ${item.product_id} not found or inactive`);
    }
  }
}

async function create(companyId, userId, payload) {
  const {
    receipt_date,
    supplier_id,
    purchase_order_id,
    warehouse_id,
    currency_id,
    exchange_rate,
    payment_type,
    notes,
    items,
  } = payload;

  if (!supplier_id) throw new ApiError(400, 'supplier_id is required');
  if (!warehouse_id) throw new ApiError(400, 'warehouse_id is required');

  // ✅ التحقق من payment_type
  const paymentType = payment_type || 'credit';
  if (!['cash', 'credit'].includes(paymentType)) {
    throw new ApiError(400, `payment_type must be 'cash' or 'credit' (got ${paymentType})`);
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // تحقق من المورد
    const s = await client.query(
      `SELECT 1 FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [supplier_id, companyId]
    );
    if (!s.rowCount) throw new ApiError(400, 'Supplier not found or inactive');

    // تحقق من المستودع
    const w = await client.query(
      `SELECT 1 FROM warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [warehouse_id, companyId]
    );
    if (!w.rowCount) throw new ApiError(400, 'Warehouse not found or inactive');

    // تحقق من البنود
    await validateItems(client, companyId, items);

    // حساب الإجماليات
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const discRate = Number(item.discount_rate) || 0;
      const taxRate = Number(item.tax_rate) || 0;

      if (!Number.isFinite(price) || price < 0) {
        throw new ApiError(400, `Invalid unit_price for product ${item.product_id}`);
      }

      const lineGross = qty * price;
      const discAmt = round2((lineGross * discRate) / 100);
      const net = round2(lineGross - discAmt);
      const taxAmt = round2((net * taxRate) / 100);
      const lineTotal = round2(net + taxAmt);

      item._discountAmount = discAmt;
      item._taxAmount = taxAmt;
      item._lineTotal = lineTotal;

      subtotal += net;
      taxTotal += taxAmt;
    }

    subtotal = round2(subtotal);
    taxTotal = round2(taxTotal);
    const total = round2(subtotal + taxTotal);

    if (subtotal <= 0) {
      throw new ApiError(400, 'Subtotal must be > 0');
    }

    // العملة
    let currId = currency_id;
    if (!currId) {
      const r = await client.query(
        `SELECT currency_id FROM companies WHERE id = $1`,
        [companyId]
      );
      currId = r.rows[0].currency_id;
    }

    // رقم الإذن
    const receiptNumber = await generateNumber(client, companyId);

    // الرأس
    const headRes = await client.query(
      `INSERT INTO goods_receipts
        (company_id, receipt_number, receipt_date, supplier_id, purchase_order_id,
         warehouse_id, currency_id, exchange_rate, subtotal, tax_total, total,
         payment_type, notes, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14)
       RETURNING id, receipt_number, receipt_date, status`,
      [
        companyId, receiptNumber,
        receipt_date || new Date().toISOString().slice(0, 10),
        supplier_id, purchase_order_id || null, warehouse_id,
        currId, exchange_rate || 1,
        subtotal, taxTotal, total,
        paymentType, notes || null, userId,
      ]
    );
    const receipt = headRes.rows[0];

    // البنود
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(
        `INSERT INTO goods_receipt_items
          (receipt_id, product_id, batch_number, expiry_date, quantity, unit_price,
           discount_rate, discount_amount, tax_rate, tax_amount, line_total, notes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          receipt.id, item.product_id,
          item.batch_number || null, item.expiry_date || null,
          round3(item.quantity), Number(item.unit_price),
          Number(item.discount_rate) || 0, item._discountAmount,
          Number(item.tax_rate) || 0, item._taxAmount,
          item._lineTotal, item.notes || null, i,
        ]
      );
    }

    const full = await getById(client, companyId, receipt.id);

    await client.query('COMMIT');
    transactionStarted = false;
    return full;
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[goodsReceipt.create] ROLLBACK failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ═══════════════════════════════════════════════════════════════
 * تأكيد إذن الاستلام — محصّن ضد الثغرات
 * ═══════════════════════════════════════════════════════════════
 *
 * التحققات:
 *  1. قفل الإذن (FOR UPDATE) + التحقق من company_id
 *  2. جلب البنود
 *  3. التحقق من الإجماليات (subtotal, taxTotal, total, paymentType)
 *  4. التحقق من الحسابات المحاسبية (موجودة + نشطة)
 *  5. بناء السطور والتحقق من التوازن
 *  6. إضافة المخزون (مع SAVEPOINT للدفعات الجديدة)
 *  7. إنشاء القيد + verify + post
 *  8. تحديث الحالة (مع company_id + status + RETURNING)
 *
 * أي فشل → ROLLBACK (الإذن يبقى draft)
 */
async function confirm(companyId, userId, id) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // ═══ 1) قفل الإذن + التحقق من company_id ═══
    const lockRes = await client.query(
      `SELECT * FROM goods_receipts
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );
    const receipt = lockRes.rows[0];
    if (!receipt) throw new ApiError(404, 'Goods receipt not found');
    if (receipt.status === 'confirmed') {
      throw new ApiError(400, 'Already confirmed');
    }
    if (receipt.status === 'cancelled') {
      throw new ApiError(400, 'Cannot confirm cancelled receipt');
    }

    // ═══ 2) جلب البنود ═══
    const itemsRes = await client.query(
      `SELECT * FROM goods_receipt_items
       WHERE receipt_id = $1
       ORDER BY sort_order ASC`,
      [id]
    );
    if (itemsRes.rowCount === 0) {
      throw new ApiError(400, 'Receipt has no items');
    }

    // ═══ 3) التحقق من الإجماليات ═══
    const subtotal = round2(receipt.subtotal);
    const taxTotal = round2(receipt.tax_total);
    const total = round2(receipt.total);
    const paymentType = receipt.payment_type;

    if (!Number.isFinite(subtotal) || subtotal < 0) {
      throw new ApiError(400, `المجموع غير صالح (${subtotal})`);
    }
    if (!Number.isFinite(taxTotal) || taxTotal < 0) {
      throw new ApiError(400, `الضريبة غير صالحة (${taxTotal})`);
    }
    if (!Number.isFinite(total) || total < 0) {
      throw new ApiError(400, `الإجمالي غير صالح (${total})`);
    }
    if (subtotal <= 0.01) {
      throw new ApiError(400, 'لا يمكن تأكيد إذن بمجموع صفر');
    }
    if (Math.abs(total - (subtotal + taxTotal)) > 0.01) {
      throw new ApiError(
        500,
        `الإجمالي (${total.toFixed(2)}) لا يساوي المجموع (${subtotal.toFixed(2)}) + الضريبة (${taxTotal.toFixed(2)}).`
      );
    }
    if (!['cash', 'credit'].includes(paymentType)) {
      throw new ApiError(
        400,
        `طريقة الدفع غير صالحة (${paymentType}). يجب أن تكون cash أو credit.`
      );
    }

    // ═══ 4) الحسابات المحاسبية ═══
    const requiredAccounts = ['113'];
    if (taxTotal > 0.01) requiredAccounts.push('114');
    if (paymentType === 'cash') requiredAccounts.push('1111');
    else requiredAccounts.push('211');

    const accounts = await requireActiveAccounts(
      client, companyId, requiredAccounts, 'في إذن الاستلام'
    );

    // ═══ 5) بناء السطور والتحقق ═══
    const lines = buildGoodsReceiptLines({
      accounts, subtotal, taxTotal, total, paymentType,
      reference: receipt.receipt_number,
    });

    assertBalanced(lines, 'في إذن الاستلام');

    // ═══ 6) إضافة المخزون ═══
    for (const item of itemsRes.rows) {
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, `كمية غير صالحة للمنتج ${item.product_id} (${item.quantity})`);
      }

      let batchId = item.batch_id;

      // ─── 6.1) دفعة محددة مسبقاً ───
      if (batchId) {
        // ✅ التحقق من الملكية + FOR UPDATE
        const batchCheck = await client.query(
          `SELECT id, quantity, cost_price, batch_number
           FROM product_batches
           WHERE id = $1 AND company_id = $2
             AND product_id = $3 AND warehouse_id = $4
           FOR UPDATE`,
          [batchId, companyId, item.product_id, receipt.warehouse_id]
        );

        if (!batchCheck.rowCount) {
          throw new ApiError(
            400,
            `الدفعة ${batchId} لا تنتمي للشركة/المنتج/المستودع المحدد ` +
            `(المنتج: ${item.product_id}, المستودع: ${receipt.warehouse_id})`
          );
        }

        // ✅ UPDATE مشروط بالملكية أيضاً
        const upd = await client.query(
          `UPDATE product_batches
           SET quantity = quantity + $1
           WHERE id = $2 AND company_id = $3
             AND product_id = $4 AND warehouse_id = $5
           RETURNING id`,
          [qty, batchId, companyId, item.product_id, receipt.warehouse_id]
        );
        if (!upd.rowCount) {
          throw new ApiError(500, `فشل تحديث الدفعة ${batchId}`);
        }
      }
      // ─── 6.2) batch_number (بحث أو إنشاء) ───
      else if (item.batch_number && String(item.batch_number).trim()) {
        const batchNumber = String(item.batch_number).trim();

        // بحث مع FOR UPDATE
        const existing = await findBatchForUpdate(client, {
          companyId,
          productId: item.product_id,
          warehouseId: receipt.warehouse_id,
          batchNumber,
        });

        if (existing) {
          // ✅ UPDATE مشروط
          const upd = await client.query(
            `UPDATE product_batches
             SET quantity = quantity + $1
             WHERE id = $2 AND company_id = $3
               AND product_id = $4 AND warehouse_id = $5
             RETURNING id`,
            [qty, existing.id, companyId, item.product_id, receipt.warehouse_id]
          );
          if (!upd.rowCount) {
            throw new ApiError(500, `فشل تحديث الدفعة ${existing.id}`);
          }
          batchId = existing.id;
        } else {
          // ✅ إنشاء باستخدام SAVEPOINT
          const created = await createBatchWithSavepoint(client, {
            companyId,
            productId: item.product_id,
            warehouseId: receipt.warehouse_id,
            batchNumber,
            expiryDate: item.expiry_date || defaultExpiry(),
            costPrice: Number(item.unit_price) || 0,
            quantity: qty,
          });

          batchId = created.id;

          // لو الدفعة أُنشئت بواسطة عملية أخرى (created=false)
          // → يجب إضافة الكمية (لأن createBatchWithSavepoint لم يفعل)
          if (!created.created) {
            const upd = await client.query(
              `UPDATE product_batches
               SET quantity = quantity + $1
               WHERE id = $2 AND company_id = $3
                 AND product_id = $4 AND warehouse_id = $5
               RETURNING id`,
              [qty, batchId, companyId, item.product_id, receipt.warehouse_id]
            );
            if (!upd.rowCount) {
              throw new ApiError(500, `فشل تحديث الدفعة ${batchId} بعد التعارض`);
            }
          }
        }
      }
      // ─── 6.3) دفعة افتراضية ───
      else {
        const defaultBatch = `GRN-${receipt.receipt_number}-${item.id.slice(0, 8)}`;

        const created = await createBatchWithSavepoint(client, {
          companyId,
          productId: item.product_id,
          warehouseId: receipt.warehouse_id,
          batchNumber: defaultBatch,
          expiryDate: item.expiry_date || defaultExpiry(),
          costPrice: Number(item.unit_price) || 0,
          quantity: qty,
        });

        batchId = created.id;

        if (!created.created) {
          const upd = await client.query(
            `UPDATE product_batches
             SET quantity = quantity + $1
             WHERE id = $2 AND company_id = $3
               AND product_id = $4 AND warehouse_id = $5
             RETURNING id`,
            [qty, batchId, companyId, item.product_id, receipt.warehouse_id]
          );
          if (!upd.rowCount) {
            throw new ApiError(500, `فشل تحديث الدفعة الافتراضية ${batchId}`);
          }
        }
      }

      // ✅ التحقق النهائي
      if (!batchId) {
        throw new ApiError(500, `فشل تحديد دفعة للمنتج ${item.product_id}`);
      }

      // تحديث batch_id في البند
      await client.query(
        `UPDATE goods_receipt_items SET batch_id = $1 WHERE id = $2`,
        [batchId, item.id]
      );

      // حركة مخزون
      await client.query(
        `INSERT INTO stock_movements
          (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
           reference_type, reference_id, created_by)
         VALUES ($1, $2, $3, 'goods_receipt', $4, $5, 'goods_receipt', $6, $7)`,
        [
          companyId, receipt.warehouse_id, batchId,
          qty, Number(item.unit_price) || 0, id, userId,
        ]
      );
    }

    // ═══ 7) إنشاء القيد المحاسبي ═══
    const je = await JournalEntry.create(client, companyId, {
      entry_date: receipt.receipt_date,
      description: `إذن استلام ${receipt.receipt_number}`,
      source_type: 'goods_receipt',  // ✅ نوع صحيح
      source_id: id,
      created_by: userId,
      lines,
    });

    await verifyJournalEntry(client, je.id, 'في إذن الاستلام');
    await JournalEntry.post(client, companyId, je.id, userId);

    // ═══ 8) تحديث الحالة (مع company_id + status + RETURNING) ═══
    const updReceipt = await client.query(
      `UPDATE goods_receipts
       SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), journal_entry_id = $2
       WHERE id = $3 AND company_id = $4 AND status = 'draft'
       RETURNING id`,
      [userId, je.id, id, companyId]
    );
    if (!updReceipt.rowCount) {
      throw new ApiError(
        409,
        'فشل تأكيد الإذن — قد يكون معدّلاً من عملية أخرى. أعد المحاولة.'
      );
    }

    // ═══ 9) الإرجاع ═══
    const full = await getById(client, companyId, id);
    await client.query('COMMIT');
    transactionStarted = false;
    return full;
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[goodsReceipt.confirm] ROLLBACK failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

async function cancel(companyId, userId, id, reason) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const lockRes = await client.query(
      `SELECT * FROM goods_receipts WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const receipt = lockRes.rows[0];
    if (!receipt) throw new ApiError(404, 'Goods receipt not found');
    if (receipt.status === 'cancelled') {
      throw new ApiError(400, 'Already cancelled');
    }

    if (receipt.status === 'draft') {
      const upd = await client.query(
        `UPDATE goods_receipts
         SET status = 'cancelled', cancelled_by = $1, cancelled_at = NOW(), cancel_reason = $2
         WHERE id = $3 AND company_id = $4 AND status = 'draft'
         RETURNING id`,
        [userId, reason || null, id, companyId]
      );
      if (!upd.rowCount) {
        throw new ApiError(409, 'فشل الإلغاء — قد يكون معدّلاً من عملية أخرى');
      }
      await client.query('COMMIT');
      transactionStarted = false;
      return { id, cancelled: true, reversed: false };
    }

    // confirmed → عكس
    const itemsRes = await client.query(
      `SELECT * FROM goods_receipt_items WHERE receipt_id = $1`,
      [id]
    );

    for (const item of itemsRes.rows) {
      const qty = Number(item.quantity);
      if (!item.batch_id) continue;

      const deduct = await client.query(
        `UPDATE product_batches
         SET quantity = quantity - $1
         WHERE id = $2 AND company_id = $3
           AND product_id = $4 AND warehouse_id = $5
           AND quantity >= $1
         RETURNING id`,
        [qty, item.batch_id, companyId, item.product_id, receipt.warehouse_id]
      );
      if (!deduct.rowCount) {
        throw new ApiError(
          400,
          `Cannot reverse: insufficient quantity in batch ${item.batch_id}`
        );
      }

      await client.query(
        `INSERT INTO stock_movements
          (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
           reference_type, reference_id, created_by)
         VALUES ($1, $2, $3, 'goods_receipt_cancel', $4, $5, 'goods_receipt_cancel', $6, $7)`,
        [
          companyId, receipt.warehouse_id, item.batch_id,
          -qty, Number(item.unit_price), id, userId,
        ]
      );
    }

    if (receipt.journal_entry_id) {
      const original = await JournalEntry.findById(companyId, receipt.journal_entry_id);
      if (original?.lines) {
        const reversedLines = original.lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `عكس استلام — ${l.description || ''}`,
        }));

        const reverse = await JournalEntry.create(client, companyId, {
          entry_date: new Date().toISOString().slice(0, 10),
          description: `عكس إذن استلام ${receipt.receipt_number}`,
          source_type: 'adjustment',
          source_id: id,
          created_by: userId,
          lines: reversedLines,
        });
        await JournalEntry.post(client, companyId, reverse.id, userId);
      }
    }

    const upd = await client.query(
      `UPDATE goods_receipts
       SET status = 'cancelled', cancelled_by = $1, cancelled_at = NOW(), cancel_reason = $2
       WHERE id = $3 AND company_id = $4 AND status = 'confirmed'
       RETURNING id`,
      [userId, reason || null, id, companyId]
    );
    if (!upd.rowCount) {
      throw new ApiError(409, 'فشل الإلغاء — قد يكون معدّلاً من عملية أخرى');
    }

    const full = await getById(client, companyId, id);
    await client.query('COMMIT');
    transactionStarted = false;
    return { id, cancelled: true, reversed: true, goods_receipt: full };
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[goodsReceipt.cancel] ROLLBACK failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

async function list(companyId, {
  status, supplier_id, warehouse_id, purchase_order_id,
  date_from, date_to, search, page = 1, limit = 20,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const params = [companyId];
  const conds = ['gr.company_id = $1'];

  if (status) { params.push(status); conds.push(`gr.status = $${params.length}`); }
  if (supplier_id) { params.push(supplier_id); conds.push(`gr.supplier_id = $${params.length}`); }
  if (warehouse_id) { params.push(warehouse_id); conds.push(`gr.warehouse_id = $${params.length}`); }
  if (purchase_order_id) { params.push(purchase_order_id); conds.push(`gr.purchase_order_id = $${params.length}`); }
  if (date_from) { params.push(date_from); conds.push(`gr.receipt_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); conds.push(`gr.receipt_date <= $${params.length}`); }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const p = params.length;
    conds.push(`(gr.receipt_number ILIKE $${p} OR s.name ILIKE $${p})`);
  }

  const where = conds.join(' AND ');
  params.push(safeLimit, offset);
  const lm = params.length - 1;
  const off = params.length;

  const { rows } = await pool.query(
    `SELECT
       gr.id, gr.receipt_number, gr.receipt_date, gr.status,
       gr.total, gr.payment_type,
       gr.supplier_id, s.name AS supplier_name,
       gr.warehouse_id, w.name AS warehouse_name,
       gr.purchase_order_id, po.order_number AS purchase_order_number,
       gr.created_at,
       u.name AS created_by_name,
       (SELECT COUNT(*)::int FROM goods_receipt_items WHERE receipt_id = gr.id) AS items_count
     FROM goods_receipts gr
     LEFT JOIN suppliers s ON s.id = gr.supplier_id
     LEFT JOIN warehouses w ON w.id = gr.warehouse_id
     LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id
     LEFT JOIN users u ON u.id = gr.created_by
     WHERE ${where}
     ORDER BY gr.receipt_date DESC, gr.created_at DESC
     LIMIT $${lm} OFFSET $${off}`,
    params
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM goods_receipts gr
     LEFT JOIN suppliers s ON s.id = gr.supplier_id
     WHERE ${where}`,
    params.slice(0, -2)
  );

  return {
    items: rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: countRes.rows[0].total,
      pages: Math.ceil(countRes.rows[0].total / safeLimit),
    },
  };
}

module.exports = { list, getById, create, confirm, cancel };