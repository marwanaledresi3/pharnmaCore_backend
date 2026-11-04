const ApiError = require('../errors/ApiError');

/**
 * خدمة الترقيم الآمن لكل الكيانات.
 * تعتمد على جدول company_sequences (موجود في المخطط).
 *
 * الاستخدام:
 *   const po = await numberingService.next(client, companyId, 'purchase_order', { prefix: 'PO', pad: 5 });
 *   // → "PO-00005"
 */
class NumberingService {
  /**
   * @param {object} client - pg client داخل معاملة
   * @param {string} companyId - UUID الشركة
   * @param {string} seqName - اسم التسلسل (purchase_order, invoice, payment, return, ...)
   * @param {object} opts - { prefix, pad, start, resetYearly }
   * @returns {Promise<string>} الرقم التالي
   */
  static async next(client, companyId, seqName, opts = {}) {
    const { prefix = '', pad = 5, start = 1, resetYearly = false } = opts;

    const effectiveSeqName = resetYearly
      ? `${seqName}_${new Date().getFullYear()}`
      : seqName;

    // أنشئ صف العدّاد إن لم يوجد
    await client.query(
      `INSERT INTO company_sequences (company_id, seq_name, next_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, seq_name) DO NOTHING`,
      [companyId, effectiveSeqName, start]
    );

    // احصل على القيمة التالية بشكل ذرّي
    const upd = await client.query(
      `UPDATE company_sequences
       SET next_value = next_value + 1
       WHERE company_id = $1 AND seq_name = $2
       RETURNING next_value - 1 AS current`,
      [companyId, effectiveSeqName]
    );

    if (!upd.rowCount) {
      throw new ApiError(500, `Failed to allocate sequence ${effectiveSeqName}`);
    }

    const n = Number(upd.rows[0].current);
    const padded = String(n).padStart(pad, '0');
    return prefix ? `${prefix}-${padded}` : padded;
  }

  /**
   * يعيد تعيين تسلسل (استخدمه بحذر — عادةً في الاختبارات فقط).
   */
  static async reset(client, companyId, seqName, value = 1) {
    await client.query(
      `INSERT INTO company_sequences (company_id, seq_name, next_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, seq_name)
       DO UPDATE SET next_value = EXCLUDED.next_value`,
      [companyId, seqName, value]
    );
  }

  /**
   * يقرأ القيمة الحالية دون زيادة (للتشخيص).
   */
  static async peek(client, companyId, seqName) {
    const r = await client.query(
      `SELECT next_value FROM company_sequences
       WHERE company_id = $1 AND seq_name = $2`,
      [companyId, seqName]
    );
    return r.rowCount ? Number(r.rows[0].next_value) : null;
  }
}

module.exports = NumberingService;