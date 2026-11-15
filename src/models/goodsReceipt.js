// models/goodsReceipt.js
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');
const NumberingService = require('../services/numberingService');
const JournalEntry = require('./JournalEntry');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
  buildGoodsReceiptLines,
} = require('../services/journalHelper');

class GoodsReceipt {
  constructor(data) {
    Object.assign(this, data);
  }

  static round3(n) {
    return Math.round((Number(n) || 0) * 1000) / 1000;
  }

  static defaultExpiry() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    return d.toISOString().slice(0, 10);
  }

  /**
   * بحث عن دفعة موجودة مع قفل للـ Update
   */
  static async findBatchForUpdate(client, { companyId, productId, warehouseId, batchNumber }) {
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
   * إنشاء دفعة جديدة باستخدام SAVEPOINT لمنع فشل المعاملة عند التباين
   */
  static async createBatchWithSavepoint(client, {
    companyId, productId, warehouseId, batchNumber, expiryDate, costPrice, quantity,
  }) {
    const SAVEPOINT_NAME = `create_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await client.query(`SAVEPOINT ${SAVEPOINT_NAME}`);

    try {
      const ins = await client.query(
        `INSERT INTO product_batches
          (company_id, product_id, warehouse_id, batch_number, expiry_date, cost_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [companyId, productId, warehouseId, batchNumber, expiryDate, costPrice, quantity]
      );

      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT_NAME}`);
      return { id: ins.rows[0].id, created: true };
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`);

      if (err.code === '23505') {
        const existing = await GoodsReceipt.findBatchForUpdate(client, {
          companyId, productId, warehouseId, batchNumber,
        });
        if (!existing) {
          throw new ApiError(500, `تعارض في إنشاء الدفعة ${batchNumber} — لم يتم العثور عليها`);
        }
        return { id: existing.id, created: false, existing };
      }
      throw err;
    }
  }

  static async generateNumber(client, companyId) {
    return NumberingService.next(client, companyId, 'goods_receipt');
  }

  /**
   * جلب إذن الاستلام مع بنوده
   */
  static async getById(client, companyId, id) {
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
    return new GoodsReceipt(head);
  }

  static async validateItems(client, companyId, items) {
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

  /**
   * إنشاء إذن استلام جديد
   */
  static async create(companyId, userId, payload) {
    const {
      receipt_date, supplier_id, purchase_order_id, warehouse_id,
      currency_id, exchange_rate, payment_type, notes, items,
    } = payload;

    if (!supplier_id) throw new ApiError(400, 'supplier_id is required');
    if (!warehouse_id) throw new ApiError(400, 'warehouse_id is required');

    const paymentType = payment_type || 'credit';
    if (!['cash', 'credit'].includes(paymentType)) {
      throw new ApiError(400, `payment_type must be 'cash' or 'credit'`);
    }

    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const s = await client.query(
        `SELECT 1 FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
        [supplier_id, companyId]
      );
      if (!s.rowCount) throw new ApiError(400, 'Supplier not found or inactive');

      const w = await client.query(
        `SELECT 1 FROM warehouses WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
        [warehouse_id, companyId]
      );
      if (!w.rowCount) throw new ApiError(400, 'Warehouse not found or inactive');

      await GoodsReceipt.validateItems(client, companyId, items);

      let subtotal = 0;
      let taxTotal = 0;

      for (const item of items) {
        const qty = Number(item.quantity);
        const price = Number(item.unit_price);
        const discRate = Number(item.discount_rate) || 0;
        const taxRate = Number(item.tax_rate) || 0;

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

      if (subtotal <= 0) throw new ApiError(400, 'Subtotal must be > 0');

      let currId = currency_id;
      if (!currId) {
        const r = await client.query(`SELECT currency_id FROM companies WHERE id = $1`, [companyId]);
        currId = r.rows[0].currency_id;
      }

      const receiptNumber = await GoodsReceipt.generateNumber(client, companyId);

      const headRes = await client.query(
        `INSERT INTO goods_receipts
          (company_id, receipt_number, receipt_date, supplier_id, purchase_order_id,
           warehouse_id, currency_id, exchange_rate, subtotal, tax_total, total,
           payment_type, notes, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14)
         RETURNING id, receipt_number, receipt_date, status`,
        [
          companyId, receiptNumber, receipt_date || new Date().toISOString().slice(0, 10),
          supplier_id, purchase_order_id || null, warehouse_id, currId, exchange_rate || 1,
          subtotal, taxTotal, total, paymentType, notes || null, userId,
        ]
      );
      const receipt = headRes.rows[0];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await client.query(
          `INSERT INTO goods_receipt_items
            (receipt_id, product_id, batch_number, expiry_date, quantity, unit_price,
             discount_rate, discount_amount, tax_rate, tax_amount, line_total, notes, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            receipt.id, item.product_id, item.batch_number || null, item.expiry_date || null,
            GoodsReceipt.round3(item.quantity), Number(item.unit_price),
            Number(item.discount_rate) || 0, item._discountAmount,
            Number(item.tax_rate) || 0, item._taxAmount, item._lineTotal, item.notes || null, i,
          ]
        );
      }

      const full = await GoodsReceipt.getById(client, companyId, receipt.id);
      await client.query('COMMIT');
      return full;
    } catch (err) {
      if (transactionStarted) await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * تأكيد إذن الاستلام وتوليد القيود والحركات المخزنية
   */
  static async confirm(companyId, userId, id) {
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
      if (receipt.status === 'confirmed') throw new ApiError(400, 'Already confirmed');
      if (receipt.status === 'cancelled') throw new ApiError(400, 'Cannot confirm cancelled receipt');

      const itemsRes = await client.query(
        `SELECT * FROM goods_receipt_items WHERE receipt_id = $1 ORDER BY sort_order ASC`,
        [id]
      );
      if (itemsRes.rowCount === 0) throw new ApiError(400, 'Receipt has no items');

      const subtotal = round2(receipt.subtotal);
      const taxTotal = round2(receipt.tax_total);
      const total = round2(receipt.total);
      const paymentType = receipt.payment_type;

      const requiredAccounts = ['113'];
      if (taxTotal > 0.01) requiredAccounts.push('114');
      if (paymentType === 'cash') requiredAccounts.push('1111');
      else requiredAccounts.push('211');

      const accounts = await requireActiveAccounts(client, companyId, requiredAccounts, 'في إذن الاستلام');
      const lines = buildGoodsReceiptLines({
        accounts, subtotal, taxTotal, total, paymentType, reference: receipt.receipt_number,
      });

      assertBalanced(lines, 'في إذن الاستلام');

      for (const item of itemsRes.rows) {
        const qty = Number(item.quantity);
        let batchId = item.batch_id;

        if (batchId) {
          const batchCheck = await client.query(
            `SELECT id FROM product_batches WHERE id = $1 AND company_id = $2 AND product_id = $3 AND warehouse_id = $4 FOR UPDATE`,
            [batchId, companyId, item.product_id, receipt.warehouse_id]
          );
          if (!batchCheck.rowCount) throw new ApiError(400, `الدفعة لا تنتمي للشركة أو المستودع المحدد`);

          await client.query(
            `UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`,
            [qty, batchId]
          );
        } else if (item.batch_number && String(item.batch_number).trim()) {
          const batchNumber = String(item.batch_number).trim();
          const existing = await GoodsReceipt.findBatchForUpdate(client, {
            companyId, productId: item.product_id, warehouseId: receipt.warehouse_id, batchNumber,
          });

          if (existing) {
            await client.query(`UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`, [qty, existing.id]);
            batchId = existing.id;
          } else {
            const created = await GoodsReceipt.createBatchWithSavepoint(client, {
              companyId, productId: item.product_id, warehouseId: receipt.warehouse_id,
              batchNumber, expiryDate: item.expiry_date || GoodsReceipt.defaultExpiry(),
              costPrice: Number(item.unit_price) || 0, quantity: qty,
            });
            batchId = created.id;
            if (!created.created) {
              await client.query(`UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`, [qty, batchId]);
            }
          }
        } else {
          const defaultBatch = `GRN-${receipt.receipt_number}-${item.id.slice(0, 8)}`;
          const created = await GoodsReceipt.createBatchWithSavepoint(client, {
            companyId, productId: item.product_id, warehouseId: receipt.warehouse_id,
            batchNumber: defaultBatch, expiryDate: item.expiry_date || GoodsReceipt.defaultExpiry(),
            costPrice: Number(item.unit_price) || 0, quantity: qty,
          });
          batchId = created.id;
          if (!created.created) {
            await client.query(`UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`, [qty, batchId]);
          }
        }

        await client.query(`UPDATE goods_receipt_items SET batch_id = $1 WHERE id = $2`, [batchId, item.id]);
        await client.query(
          `INSERT INTO stock_movements
            (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
           VALUES ($1, $2, $3, 'goods_receipt', $4, $5, 'goods_receipt', $6, $7)`,
          [companyId, receipt.warehouse_id, batchId, qty, Number(item.unit_price) || 0, id, userId]
        );
      }

      const je = await JournalEntry.create(client, companyId, {
        entry_date: receipt.receipt_date,
        description: `إذن استلام ${receipt.receipt_number}`,
        source_type: 'goods_receipt',
        source_id: id,
        created_by: userId,
        lines,
      });

      await verifyJournalEntry(client, je.id, 'في إذن الاستلام');
      await JournalEntry.post(client, companyId, je.id, userId);

      await client.query(
        `UPDATE goods_receipts SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), journal_entry_id = $2 WHERE id = $3 AND company_id = $4`,
        [userId, je.id, id, companyId]
      );

      const full = await GoodsReceipt.getById(client, companyId, id);
      await client.query('COMMIT');
      return full;
    } catch (err) {
      if (transactionStarted) await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * إلغاء إذن الاستلام وعكس الحركات
   */
  static async cancel(companyId, userId, id, reason) {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const lockRes = await client.query(`SELECT * FROM goods_receipts WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, companyId]);
      const receipt = lockRes.rows[0];
      if (!receipt) throw new ApiError(404, 'Goods receipt not found');
      if (receipt.status === 'cancelled') throw new ApiError(400, 'Already cancelled');

      if (receipt.status === 'draft') {
        await client.query(
          `UPDATE goods_receipts SET status = 'cancelled', cancelled_by = $1, cancelled_at = NOW(), cancel_reason = $2 WHERE id = $3 AND company_id = $4`,
          [userId, reason || null, id, companyId]
        );
        await client.query('COMMIT');
        return { id, cancelled: true, reversed: false };
      }

      const itemsRes = await client.query(`SELECT * FROM goods_receipt_items WHERE receipt_id = $1`, [id]);
      for (const item of itemsRes.rows) {
        const qty = Number(item.quantity);
        if (!item.batch_id) continue;

        const deduct = await client.query(
          `UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1 RETURNING id`,
          [qty, item.batch_id]
        );
        if (!deduct.rowCount) throw new ApiError(400, `Cannot reverse: insufficient quantity in batch`);

        await client.query(
          `INSERT INTO stock_movements (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
           VALUES ($1, $2, $3, 'goods_receipt_cancel', $4, $5, 'goods_receipt_cancel', $6, $7)`,
          [companyId, receipt.warehouse_id, item.batch_id, -qty, Number(item.unit_price), id, userId]
        );
      }

      if (receipt.journal_entry_id) {
        const original = await JournalEntry.findById(companyId, receipt.journal_entry_id);
        if (original?.lines) {
          const reversedLines = original.lines.map((l) => ({
            account_id: l.account_id, debit: Number(l.credit), credit: Number(l.debit), description: `عكس استلام`,
          }));
          const reverse = await JournalEntry.create(client, companyId, {
            entry_date: new Date().toISOString().slice(0, 10),
            description: `عكس إذن استلام ${receipt.receipt_number}`,
            source_type: 'adjustment', source_id: id, created_by: userId, lines: reversedLines,
          });
          await JournalEntry.post(client, companyId, reverse.id, userId);
        }
      }

      await client.query(
        `UPDATE goods_receipts SET status = 'cancelled', cancelled_by = $1, cancelled_at = NOW(), cancel_reason = $2 WHERE id = $3 AND company_id = $4`,
        [userId, reason || null, id, companyId]
      );

      const full = await GoodsReceipt.getById(client, companyId, id);
      await client.query('COMMIT');
      return { id, cancelled: true, reversed: true, goods_receipt: full };
    } catch (err) {
      if (transactionStarted) await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * استعراض قائمة أذون الاستلام
   */
  static async list(companyId, filters = {}) {
    const { status, supplier_id, warehouse_id, purchase_order_id, date_from, date_to, search, page = 1, limit = 20 } = filters;
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
      `SELECT gr.id, gr.receipt_number, gr.receipt_date, gr.status, gr.total, gr.payment_type,
              gr.supplier_id, s.name AS supplier_name, gr.warehouse_id, w.name AS warehouse_name,
              gr.purchase_order_id, po.order_number AS purchase_order_number, gr.created_at, u.name AS created_by_name,
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
      `SELECT COUNT(*)::int AS total FROM goods_receipts gr LEFT JOIN suppliers s ON s.id = gr.supplier_id WHERE ${where}`,
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
}

module.exports = GoodsReceipt;