// services/purchaseOrder/cancel.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const JournalEntry = require('../../models/JournalEntry');
const QRService = require('../qrService');
const NotificationService = require('../notificationService');
const ReservationService = require('../reservationService');

/**
 * إلغاء أمر شراء.
 *
 * الحالات المسموح إلغاؤها:
 * - draft
 * - pending_approval
 * - approved (محلي أو شبكي)
 *
 * التدفق:
 * 1) قفل الطلب + تحقق من الحالة
 * 2) تحرير الحجوزات (إن وُجدت)
 * 3) عكس/حذف القيد (إن وُجد)
 *    - posted  → إنشاء قيد عكسي + ترحيله
 *    - draft   → حذف القيد الأصلي
 * 4) تحديث الحالة → cancelled
 * 5) إلغاء QR
 * 6) COMMIT
 * 7) إشعار المورد (best effort)
 */
async function cancel(companyId, userId, orderId) {
  const client = await pool.connect();
  let orderRef = null;
  let supplierCompanyId = null;
  let cancelled = null;

  try {
    await client.query('BEGIN');

    // ═══ 1) قفل الطلب ═══
    const r = await client.query(
      `SELECT * FROM purchase_orders
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [orderId, companyId]
    );
    const order = r.rows[0];
    if (!order) throw new ApiError(404, 'Purchase order not found');
    orderRef = order;
    supplierCompanyId = order.supplier_company_id;

    // ═══ 2) الحالات المسموح إلغاؤها ═══
    const cancellable = ['draft', 'pending_approval', 'approved'].includes(order.status);

    if (!cancellable) {
      throw new ApiError(400, `Order with status '${order.status}' cannot be cancelled`);
    }

    // ═══ 3) تحرير الحجوزات (إن وُجدت) ═══
    if (order.supplier_company_id) {
      await ReservationService.releaseForOrder(client, {
        orderId,
        reason: 'order cancelled',
      });
    }

    // ═══ 4) عكس/حذف القيد ═══
    if (order.journal_entry_id) {
      await reverseOrDeleteJournalEntry(client, {
        companyId,
        userId,
        orderId,
        journalEntryId: order.journal_entry_id,
        orderNumber: order.order_number,
      });
    }

    // ═══ 5) تحديث الحالة ═══
    const upd = await client.query(
      `UPDATE purchase_orders SET
         status = 'cancelled',
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, order_number, status, company_id, supplier_company_id`,
      [orderId]
    );
    cancelled = upd.rows[0];

    // ═══ 6) إلغاء QR ═══
    await QRService.revokeForOrder(client, orderId, {
      userId,
      reason: 'تم إلغاء الطلب',
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ═══ 7) إشعار المورد (best effort) ═══
  if (supplierCompanyId && orderRef) {
    try {
      const notifyClient = await pool.connect();
      try {
        await NotificationService.purchaseOrderCancelled(notifyClient, {
          order: orderRef,
          targetCompanyId: supplierCompanyId,
          cancelledBy: userId,
        });
      } finally {
        notifyClient.release();
      }
    } catch (e) {
      console.error('[cancel] notification failed:', e.message);
    }
  }

  return { id: orderId, status: 'cancelled' };
}

/* ============================================================
 * عكس أو حذف القيد
 *
 * - posted  → قيد عكسي (adjustment) + ترحيله
 * - draft   → حذف القيد الأصلي (لأنه لم يؤثر على الأرصدة)
 * - غير موجود → تجاهل
 * ============================================================ */
async function reverseOrDeleteJournalEntry(client, {
  companyId,
  userId,
  orderId,
  journalEntryId,
  orderNumber,
}) {
  const original = await JournalEntry.findById(companyId, journalEntryId);
  if (!original) {
    console.warn(
      `[cancel] journal entry ${journalEntryId} not found — skipping reversal`
    );
    return { reversed: false, deleted: false };
  }

  // ═══ draft → حذف ═══
  if (original.status === 'draft') {
    await client.query(
      `DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [original.id]
    );
    await client.query(
      `DELETE FROM journal_entries WHERE id = $1`,
      [original.id]
    );
    return { reversed: false, deleted: true };
  }

  // ═══ posted → عكس ═══
  if (original.status === 'posted') {
    if (!original.lines || original.lines.length === 0) {
      throw new ApiError(500, `Journal entry ${journalEntryId} has no lines`);
    }

    const reversedLines = original.lines.map((l) => ({
      account_id: l.account_id,
      debit: Number(l.credit || 0),
      credit: Number(l.debit || 0),
      description: `إلغاء: ${l.description || ''}`,
    }));

    const reverse = await JournalEntry.create(client, companyId, {
      entry_date: new Date().toISOString().slice(0, 10),
      description: `إلغاء أمر شراء ${orderNumber}`,
      source_type: 'adjustment',
      source_id: orderId,
      created_by: userId,
      lines: reversedLines,
    });

    await JournalEntry.post(client, companyId, reverse.id, userId);
    return { reversed: true, deleted: false, reverse_entry_id: reverse.id };
  }

  // ═══ حالة أخرى (cancelled مثلاً) → تجاهل ═══
  return { reversed: false, deleted: false };
}

module.exports = { cancel };