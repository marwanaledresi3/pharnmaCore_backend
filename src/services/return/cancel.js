// services/return/cancel.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const JournalEntry = require('../../models/JournalEntry');
const {
  assertBalanced,
  verifyJournalEntry,
} = require('../journalHelper');

/**
 * إلغاء مرتجع — محصّن
 *
 * - draft → تحديث الحالة فقط (بدون عكس)
 * - confirmed → عكس القيد + عكس المخزون + سجل حركة عكسية
 *
 * ✅ يستخدم return_type === 'sale' (بدون s) — متوافق مع CHECK
 */
const cancel = async (companyId, userId, returnId) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // ═══ 1) قفل المرتجع ═══
    const ret = await client.query(
      `SELECT * FROM returns WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [returnId, companyId]
    );
    if (!ret.rowCount) throw new ApiError(404, 'Return not found');

    const returnData = ret.rows[0];

    // ═══ 2) رفض الإلغاء المزدوج ═══
    if (returnData.status === 'cancelled') {
      throw new ApiError(400, 'Already cancelled');
    }

    // ═══ 3) draft: تحديث الحالة فقط ═══
    if (returnData.status === 'draft') {
      const upd = await client.query(
        `UPDATE returns
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status = 'draft'
         RETURNING id`,
        [returnId, companyId]
      );
      if (!upd.rowCount) {
        throw new ApiError(409, 'فشل الإلغاء — قد يكون معدّلاً من عملية أخرى');
      }
      await client.query('COMMIT');
      transactionStarted = false;
      return { id: returnId, status: 'cancelled' };
    }

    // ═══ 4) confirmed: عكس كامل ═══
    if (returnData.status === 'confirmed') {
      // 4a) تحقق من وجود قيد (إذا كان confirmed، يجب أن يكون له قيد)
      if (!returnData.journal_entry_id) {
        throw new ApiError(
          409,
          'Cannot cancel: confirmed return has no journal entry. Data inconsistency.'
        );
      }

      // 4b) عكس قيد المرتجع
      const original = await JournalEntry.findById(companyId, returnData.journal_entry_id);
      if (!original) {
        throw new ApiError(
          409,
          `Cannot cancel: original journal entry ${returnData.journal_entry_id} not found`
        );
      }
      if (!Array.isArray(original.lines) || original.lines.length === 0) {
        throw new ApiError(
          409,
          'Cannot cancel: original journal entry has no lines'
        );
      }

      // ✅ التحقق من حالة القيد الأصلي
      if (original.status !== 'posted') {
        throw new ApiError(
          409,
          `Cannot reverse: journal entry status is '${original.status}', expected 'posted'`
        );
      }

      const reversedLines = original.lines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.credit || 0),
        credit: Number(l.debit || 0),
        description: `إلغاء: ${l.description || ''}`,
      }));

      // ✅ التحقق من التوازن
      assertBalanced(reversedLines, 'في عكس قيد المرتجع');

      const reverse = await JournalEntry.create(client, companyId, {
        entry_date: new Date().toISOString().slice(0, 10),
        description: `إلغاء مرتجع ${returnData.return_number}`,
        source_type: 'adjustment',
        source_id: returnId,
        created_by: userId,
        lines: reversedLines,
      });

      // ✅ verify بعد الإنشاء
      await verifyJournalEntry(client, reverse.id, 'في عكس قيد المرتجع');

      await JournalEntry.post(client, companyId, reverse.id, userId);

      // 4c) عكس حركات المخزون
      const movements = await client.query(
        `SELECT sm.batch_id, sm.movement_type,
                SUM(sm.quantity)::numeric AS total_qty,
                COALESCE(MAX(sm.unit_cost), 0)::numeric AS unit_cost
         FROM stock_movements sm
         WHERE sm.reference_type IN ('sale_return', 'purchase_return')
           AND sm.reference_id = $1
         GROUP BY sm.batch_id, sm.movement_type`,
        [returnId]
      );

      for (const mv of movements.rows) {
        if (!mv.batch_id) continue;

        let reverseType;

        if (mv.movement_type === 'in') {
          // كان in → اخصم (مع company_id)
          const upd = await client.query(
            `UPDATE product_batches
             SET quantity = quantity - $1
             WHERE id = $2 AND company_id = $3 AND quantity >= $1
             RETURNING id`,
            [mv.total_qty, mv.batch_id, companyId]
          );
          if (!upd.rowCount) {
            throw new ApiError(
              400,
              `Cannot reverse: batch ${mv.batch_id} has insufficient quantity ` +
              `(need ${mv.total_qty})`
            );
          }
          reverseType = 'out';
        } else if (mv.movement_type === 'out') {
          // كان out → أضف (مع company_id)
          const upd = await client.query(
            `UPDATE product_batches
             SET quantity = quantity + $1
             WHERE id = $2 AND company_id = $3
             RETURNING id`,
            [mv.total_qty, mv.batch_id, companyId]
          );
          if (!upd.rowCount) {
            throw new ApiError(
              500,
              `Batch ${mv.batch_id} not found during cancel — data inconsistency`
            );
          }
          reverseType = 'in';
        } else {
          continue;
        }

        // سجل الحركة العكسية
        await client.query(
          `INSERT INTO stock_movements
             (company_id, warehouse_id, batch_id, movement_type, quantity, unit_cost,
              reference_type, reference_id, movement_date, created_by)
           SELECT $1, b.warehouse_id, b.id, $2, $3, $4,
                  'adjustment', $5, CURRENT_DATE, $6
           FROM product_batches b
           WHERE b.id = $7 AND b.company_id = $1`,
          [
            companyId,
            reverseType,
            mv.total_qty,
            mv.unit_cost || 0,
            returnId,
            userId,
            mv.batch_id,
          ]
        );
      }

      // 4d) تحديث الحالة
      const upd = await client.query(
        `UPDATE returns
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status = 'confirmed'
         RETURNING id`,
        [returnId, companyId]
      );
      if (!upd.rowCount) {
        throw new ApiError(409, 'فشل الإلغاء — قد يكون معدّلاً من عملية أخرى');
      }

      await client.query('COMMIT');
      transactionStarted = false;
      return { id: returnId, status: 'cancelled' };
    }

    // ═══ 5) حالة غير معروفة ═══
    throw new ApiError(400, `Cannot cancel return with status '${returnData.status}'`);

  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[return.cancel] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { cancel };