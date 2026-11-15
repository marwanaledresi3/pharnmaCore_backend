
const { pool } = require('../config/pool');
const ApiError = require('../errors/ApiError');

class Note {
  /**
   * البحث عن حساب محاسبي حسب الكود
   */
  static async findAccountId(client, companyId, code) {
    const result = await client.query(
      `SELECT id
       FROM chart_of_accounts
       WHERE company_id = $1
         AND code = $2
         AND is_active = TRUE`,
      [companyId, code]
    );

    if (!result.rowCount) {
      throw new ApiError(
        500,
        `Required account ${code} not found or inactive`
      );
    }

    return result.rows[0].id;
  }

  /**
   * التحقق من وجود العميل
   */
  static async customerExists(client, companyId, customerId) {
    const result = await client.query(
      `SELECT 1
       FROM customers
       WHERE id = $1
         AND company_id = $2
         AND is_active = TRUE`,
      [customerId, companyId]
    );

    return result.rowCount > 0;
  }

  /**
   * التحقق من وجود المورد
   */
  static async supplierExists(client, companyId, supplierId) {
    const result = await client.query(
      `SELECT 1
       FROM suppliers
       WHERE id = $1
         AND company_id = $2
         AND is_active = TRUE`,
      [supplierId, companyId]
    );

    return result.rowCount > 0;
  }

  /**
   * التحقق من وجود الفاتورة
   */
  static async invoiceExists(client, companyId, invoiceId) {
    const result = await client.query(
      `SELECT 1
       FROM invoices
       WHERE id = $1 AND company_id = $2`,
      [invoiceId, companyId]
    );

    return result.rowCount > 0;
  }

  /**
   * جلب العملة الافتراضية للشركة
   */
  static async getCompanyCurrency(client, companyId) {
    const result = await client.query(
      `SELECT currency_id
       FROM companies
       WHERE id = $1`,
      [companyId]
    );

    return result.rows[0]?.currency_id || null;
  }

  /**
   * إنشاء رأس الإشعار
   */
  static async insertNote(client, data) {
    const {
      companyId,
      noteNumber,
      noteType,
      partyType,
      customerId,
      supplierId,
      invoiceId,
      noteDate,
      currencyId,
      exchangeRate,
      subtotal,
      taxTotal,
      total,
      reason,
      description,
      userId,
    } = data;

    const result = await client.query(
      `INSERT INTO notes
        (
          company_id,
          note_number,
          note_type,
          party_type,
          customer_id,
          supplier_id,
          invoice_id,
          note_date,
          currency_id,
          exchange_rate,
          subtotal,
          tax_total,
          total,
          reason,
          description,
          status,
          created_by
        )
       VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, 'draft', $16
       )
       RETURNING id, note_number, note_date, status`,
      [
        companyId,
        noteNumber,
        noteType,
        partyType,
        customerId || null,
        supplierId || null,
        invoiceId || null,
        noteDate,
        currencyId,
        exchangeRate,
        subtotal,
        taxTotal,
        total,
        reason,
        description || null,
        userId,
      ]
    );

    return result.rows[0];
  }

  /**
   * إضافة بند للإشعار
   */
  static async insertNoteItem(client, noteId, item, sortOrder) {
    const result = await client.query(
      `INSERT INTO note_items
        (
          note_id,
          product_id,
          description,
          quantity,
          unit_price,
          discount_rate,
          discount_amount,
          tax_rate,
          tax_amount,
          line_total,
          sort_order
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        noteId,
        item.product_id || null,
        item.description,
        Number(item.quantity),
        Number(item.unit_price),
        Number(item.discount_rate) || 0,
        item._discountAmount,
        Number(item.tax_rate) || 0,
        item._taxAmount,
        item._lineTotal,
        sortOrder,
      ]
    );

    return result.rows[0];
  }

  /**
   * جلب إشعار واحد مع بنوده
   */
  static async getById(client, companyId, id) {
    const headResult = await client.query(
      `SELECT
         n.*,
         c.name AS customer_name,
         s.name AS supplier_name,
         i.invoice_number,
         u.name AS created_by_name,
         cu.name AS confirmed_by_name,
         x.name AS cancelled_by_name,
         cur.code AS currency_code,
         cur.symbol AS currency_symbol
       FROM notes n
       LEFT JOIN customers c ON c.id = n.customer_id
       LEFT JOIN suppliers s ON s.id = n.supplier_id
       LEFT JOIN invoices i ON i.id = n.invoice_id
       LEFT JOIN users u ON u.id = n.created_by
       LEFT JOIN users cu ON cu.id = n.confirmed_by
       LEFT JOIN users x ON x.id = n.cancelled_by
       LEFT JOIN currencies cur ON cur.id = n.currency_id
       WHERE n.id = $1 AND n.company_id = $2`,
      [id, companyId]
    );

    const head = headResult.rows[0];
    if (!head) return null;

    const itemsResult = await client.query(
      `SELECT
         ni.*,
         p.name AS product_name,
         p.sku AS product_sku,
         p.unit AS product_unit
       FROM note_items ni
       LEFT JOIN products p ON p.id = ni.product_id
       WHERE ni.note_id = $1
       ORDER BY ni.sort_order ASC, ni.created_at ASC`,
      [id]
    );

    head.items = itemsResult.rows;

    return head;
  }

  /**
   * قفل الإشعار أثناء التأكيد أو الإلغاء
   */
  static async lockById(client, companyId, id) {
    const result = await client.query(
      `SELECT *
       FROM notes
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [id, companyId]
    );

    return result.rows[0] || null;
  }

  /**
   * تحديث حالة الإشعار إلى confirmed
   */
 /**
   * ✅ تحديث حالة الإشعار إلى confirmed — مع company_id + status + RETURNING
   */
  static async confirmNote(client, companyId, id, userId, journalEntryId) {
    const result = await client.query(
      `UPDATE notes
       SET status = 'confirmed',
           confirmed_by = $1,
           confirmed_at = NOW(),
           journal_entry_id = $2
       WHERE id = $3 AND company_id = $4 AND status = 'draft'
       RETURNING id`,
      [userId, journalEntryId, id, companyId]
    );

    if (!result.rowCount) {
      throw new ApiError(
        409,
        'فشل تأكيد الإشعار — قد يكون معدّلاً من عملية أخرى. أعد المحاولة.'
      );
    }
  }

  /**
   * ✅ إلغاء الإشعار — مع company_id + status + RETURNING
   */
  static async cancelNote(client, companyId, id, userId, reason, expectedStatus = null) {
    const params = [userId, reason || null, id, companyId];
    let statusCond = '';
    if (expectedStatus) {
      params.push(expectedStatus);
      statusCond = ` AND status = $${params.length}`;
    }

    const result = await client.query(
      `UPDATE notes
       SET status = 'cancelled',
           cancelled_by = $1,
           cancelled_at = NOW(),
           cancel_reason = $2
       WHERE id = $3 AND company_id = $4${statusCond}
       RETURNING id`,
      params
    );

    if (!result.rowCount) {
      throw new ApiError(
        409,
        'فشل إلغاء الإشعار — قد يكون معدّلاً من عملية أخرى'
      );
    }
  }


  /**
   * قائمة الإشعارات مع البحث والفلاتر
   */
  static async list(companyId, filters = {}) {
    const {
      note_type,
      party_type,
      status,
      customer_id,
      supplier_id,
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
    const conditions = ['n.company_id = $1'];

    if (note_type) {
      params.push(note_type);
      conditions.push(`n.note_type = $${params.length}`);
    }

    if (party_type) {
      params.push(party_type);
      conditions.push(`n.party_type = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`n.status = $${params.length}`);
    }

    if (customer_id) {
      params.push(customer_id);
      conditions.push(`n.customer_id = $${params.length}`);
    }

    if (supplier_id) {
      params.push(supplier_id);
      conditions.push(`n.supplier_id = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conditions.push(`n.note_date >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(`n.note_date <= $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = params.length;

      conditions.push(
        `(n.note_number ILIKE $${p} OR n.description ILIKE $${p})`
      );
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM notes n
       WHERE ${where}`,
      params
    );

    const total = countResult.rows[0].total;

    const listParams = [...params, safeLimit, offset];

    const result = await pool.query(
      `SELECT
         n.id,
         n.note_number,
         n.note_type,
         n.party_type,
         n.note_date,
         n.total,
         n.status,
         n.reason,
         n.customer_id,
         c.name AS customer_name,
         n.supplier_id,
         s.name AS supplier_name,
         n.invoice_id,
         i.invoice_number,
         n.created_at,
         u.name AS created_by_name,
         (
           SELECT COUNT(*)::int
           FROM note_items
           WHERE note_id = n.id
         ) AS items_count
       FROM notes n
       LEFT JOIN customers c ON c.id = n.customer_id
       LEFT JOIN suppliers s ON s.id = n.supplier_id
       LEFT JOIN invoices i ON i.id = n.invoice_id
       LEFT JOIN users u ON u.id = n.created_by
       WHERE ${where}
       ORDER BY n.note_date DESC, n.created_at DESC
       LIMIT $${listParams.length - 1}
       OFFSET $${listParams.length}`,
      listParams
    );

    return {
      items: result.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }
}

module.exports =  Note;
