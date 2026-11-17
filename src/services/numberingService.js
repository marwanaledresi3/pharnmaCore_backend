const ApiError = require('../errors/ApiError');
const settingsService = require('./settingsService');

/**
 * ═══════════════════════════════════════════════════════════
 * NUMBERING SERVICE
 * ═══════════════════════════════════════════════════════════
 * خدمة الترقيم الآمن لكل الكيانات.
 * تعتمد على:
 *  - company_sequences (لتوليد الأرقام الذرّية)
 *  - settings (لبادئة/حشو/إعادة تعيين — قابلة للتخصيص)
 *
 * الاستخدام الأساسي:
 *   const po = await numberingService.next(client, companyId, 'purchase_order');
 *   // → "PO-0001" (يقرأ البادئة والحشو من settings)
 *
 * تجاوز الإعدادات (اختياري):
 *   const po = await numberingService.next(client, companyId, 'purchase_order', {
 *     prefix: 'CUSTOM-', pad: 6
 *   });
 *   // → "CUSTOM-000001"
 *
 * ملاحظة: seqName يجب أن يطابق أسماء المفاتيح في settings:
 *   purchase_order   → numbering_purchase_order_prefix
 *   sales_order      → numbering_sales_order_prefix
 *   invoice          → invoice_prefix         (استثناء: قسم الفواتير)
 *   payment_receipt  → numbering_payment_receipt_prefix
 *   payment_voucher  → numbering_payment_voucher_prefix
 *   expense          → numbering_expense_prefix
 *   return           → numbering_return_prefix
 *   journal_entry    → numbering_journal_prefix
 * ═══════════════════════════════════════════════════════════
 */

/**
 * خريطة: seqName → مفتاح البادئة في settings
 * استثناء `invoice` لأنه يستخدم `invoice_prefix` (قسم الفواتير)
 */
const PREFIX_KEY_MAP = {
  invoice:           'invoice_prefix',
  purchase_order:    'numbering_purchase_order_prefix',
  sales_order:       'numbering_sales_order_prefix',
  payment_receipt:   'numbering_payment_receipt_prefix',
  payment_voucher:   'numbering_payment_voucher_prefix',
  expense:           'numbering_expense_prefix',
  return:            'numbering_return_prefix',
  journal_entry:     'numbering_journal_prefix',
};

class NumberingService {
  /**
   * يقرأ الإعدادات الافتراضية للترقيم من settings
   * @param {object} client
   * @param {string} companyId
   * @param {string} seqName
   * @returns {Promise<{ prefix: string, pad: number, resetYearly: boolean }>}
   */
  static async _getDefaults(client, companyId, seqName) {
    const prefixKey = PREFIX_KEY_MAP[seqName] || `numbering_${seqName}_prefix`;

    const settings = await settingsService.getMany(
      companyId,
      [prefixKey, 'numbering_padding', 'numbering_reset_yearly'],
      client
    );

    return {
      prefix: settings[prefixKey] ?? '',
      pad: settings.numbering_padding ?? 4,
      resetYearly: settings.numbering_reset_yearly ?? false,
    };
  }

  /**
   * يولّد الرقم التالي (الأساس)
   * @param {object} client - pg client داخل معاملة
   * @param {string} companyId - UUID الشركة
   * @param {string} seqName - اسم التسلسل
   * @param {object} opts - { prefix, pad, start, resetYearly } — اختياري (يتجاوز settings)
   * @returns {Promise<string>} الرقم التالي (مثل "PO-0001")
   */
  static async next(client, companyId, seqName, opts = {}) {
    // 1) اقرأ الافتراضيات من settings (لو opts لم تمرر)
    let defaults;
    if (
      opts.prefix === undefined ||
      opts.pad === undefined ||
      opts.resetYearly === undefined
    ) {
      defaults = await this._getDefaults(client, companyId, seqName);
    }

    const {
      prefix = defaults?.prefix ?? '',
      pad = defaults?.pad ?? 4,
      start = 1,
      resetYearly = defaults?.resetYearly ?? false,
    } = opts;

    // 2) اسم التسلسل الفعلي (مع السنة إن لزم)
    const effectiveSeqName = resetYearly
      ? `${seqName}_${new Date().getFullYear()}`
      : seqName;

    // 3) أنشئ صف العدّاد إن لم يوجد
    await client.query(
      `INSERT INTO company_sequences (company_id, seq_name, next_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, seq_name) DO NOTHING`,
      [companyId, effectiveSeqName, start]
    );

    // 4) احصل على القيمة التالية بشكل ذرّي
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
    return prefix ? `${prefix}${padded}` : padded;
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
  static async peek(client, companyId, seqName, resetYearly = false) {
    const effectiveSeqName = resetYearly
      ? `${seqName}_${new Date().getFullYear()}`
      : seqName;

    const r = await client.query(
      `SELECT next_value FROM company_sequences
       WHERE company_id = $1 AND seq_name = $2`,
      [companyId, effectiveSeqName]
    );
    return r.rowCount ? Number(r.rows[0].next_value) : null;
  }

  /**
   * يعيد معاينة الرقم القادم (بدون استهلاكه) — مفيد للعرض في الواجهة
   * @returns {Promise<string>}
   */
  static async preview(client, companyId, seqName, opts = {}) {
    let defaults;
    if (
      opts.prefix === undefined ||
      opts.pad === undefined ||
      opts.resetYearly === undefined
    ) {
      defaults = await this._getDefaults(client, companyId, seqName);
    }

    const {
      prefix = defaults?.prefix ?? '',
      pad = defaults?.pad ?? 4,
      start = 1,
      resetYearly = defaults?.resetYearly ?? false,
    } = opts;

    const effectiveSeqName = resetYearly
      ? `${seqName}_${new Date().getFullYear()}`
      : seqName;

    const current = await this.peek(client, companyId, seqName, resetYearly);
    const nextVal = current === null ? start : current;
    const padded = String(nextVal).padStart(pad, '0');
    return prefix ? `${prefix}${padded}` : padded;
  }
   /**
 * يولّد الرقم التالي ويرجّع القيمة الرقمية + المعروضة معاً (ذرّي).
 * @returns {Promise<{ value: number, display: string }>}
 */
static async nextRaw(client, companyId, seqName, opts = {}) {
  let defaults;
  if (opts.prefix === undefined || opts.pad === undefined || opts.resetYearly === undefined) {
    defaults = await this._getDefaults(client, companyId, seqName);
  }

  const {
    prefix = defaults?.prefix ?? '',
    pad = defaults?.pad ?? 4,
    start = 1,
    resetYearly = defaults?.resetYearly ?? false,
  } = opts;

  const effectiveSeqName = resetYearly
    ? `${seqName}_${new Date().getFullYear()}`
    : seqName;

  await client.query(
    `INSERT INTO company_sequences (company_id, seq_name, next_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, seq_name) DO NOTHING`,
    [companyId, effectiveSeqName, start]
  );

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

  const value = Number(upd.rows[0].current);
  const padded = String(value).padStart(pad, '0');
  const display = prefix ? `${prefix}${padded}` : padded;

  return { value, display };
}
}

module.exports = NumberingService;