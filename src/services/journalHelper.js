// services/journalHelper.js
const ApiError = require('../errors/ApiError');

/**
 * ═══════════════════════════════════════════════════════════════
 * JOURNAL HELPER — أدوات مساعدة لضمان سلامة القيود المحاسبية
 * ═══════════════════════════════════════════════════════════════
 * 
 * المبدأ: "لا قيد بدون توازن مضمون"
 * 
 * الدوال:
 *   - round2(n): تقريب لخانتين عشريتين
 *   - assertBalanced(lines, context): يتحقق من توازن السطور
 *   - requireActiveAccounts(client, companyId, codes, context): يجلب ويتحقق من الحسابات
 *   - verifyJournalEntry(client, journalEntryId, context): يتحقق من قيد موجود
 *   - buildJournalLines(...): يبني السطور (اختياري)
 * ═══════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يتحقق من توازن السطور قبل الإنشاء
 * @param {Array} lines - [{account_id, debit, credit, description}, ...]
 * @param {string} context - للرسالة (مثل "في إذن الاستلام")
 * @throws {ApiError} إذا غير متوازن أو أقل من سطرين
 */
function assertBalanced(lines, context = '') {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new ApiError(
      400,
      `قيد محاسبي غير صالح ${context}: يجب أن يحتوي سطرين على الأقل (المُدخل: ${lines?.length || 0})`
    );
  }

  const sumDebit = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const sumCredit = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));

  if (Math.abs(sumDebit - sumCredit) > 0.01) {
    throw new ApiError(
      400,
      `قيد محاسبي غير متوازن ${context}: مدين=${sumDebit.toFixed(2)}, دائن=${sumCredit.toFixed(2)}، الفرق=${(sumDebit - sumCredit).toFixed(2)}`
    );
  }

  // تحقق إضافي: كل سطر يجب أن يحتوي debit أو credit (وليس الاثنين، وليس صفر)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = Number(l.debit || 0);
    const c = Number(l.credit || 0);

    if (!l.account_id) {
      throw new ApiError(400, `قيد ${context}: السطر ${i + 1} بدون account_id`);
    }

    if (d < 0 || c < 0) {
      throw new ApiError(
        400,
        `قيد ${context}: السطر ${i + 1} يحتوي قيمة سالبة (debit=${d}, credit=${c})`
      );
    }

    if (d > 0 && c > 0) {
      throw new ApiError(
        400,
        `قيد ${context}: السطر ${i + 1} يحتوي debit و credit معاً (${d} و ${c})`
      );
    }

    if (d === 0 && c === 0) {
      throw new ApiError(
        400,
        `قيد ${context}: السطر ${i + 1} بدون debit أو credit`
      );
    }
  }
}

/**
 * يجلب الحسابات المطلوبة ويتحقق من وجودها ونشاطها
 * @param {object} client - pg client
 * @param {string} companyId
 * @param {string[]} codes - أكواد الحسابات (مثل ['113', '114', '211'])
 * @param {string} context - للرسالة
 * @returns {object} map { code: id }
 * @throws {ApiError} إذا كان أي حساب مفقوداً أو غير نشط
 */
async function requireActiveAccounts(client, companyId, codes, context = '') {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new ApiError(400, `لا توجد حسابات مطلوبة ${context}`);
  }

  // إزالة التكرار
  const uniqueCodes = [...new Set(codes)];

  const r = await client.query(
    `SELECT code, id, is_active, name
     FROM chart_of_accounts
     WHERE company_id = $1 AND code = ANY($2::text[])`,
    [companyId, uniqueCodes]
  );

  const found = new Map();
  for (const row of r.rows) found.set(row.code, row);

  const missing = [];
  const inactive = [];

  for (const code of uniqueCodes) {
    const row = found.get(code);
    if (!row) {
      missing.push(code);
    } else if (!row.is_active) {
      inactive.push(code);
    }
  }

  if (missing.length > 0 || inactive.length > 0) {
    const parts = [];
    if (missing.length > 0) {
      parts.push(`مفقودة: ${missing.join(', ')}`);
    }
    if (inactive.length > 0) {
      parts.push(`غير نشطة: ${inactive.join(', ')}`);
    }
    throw new ApiError(
      500,
      `لا يمكن إتمام العملية ${context} — الحسابات المحاسبية التالية ${parts.join(' | ')}. ` +
      `يرجى التحقق من شجرة الحسابات (chart_of_accounts).`
    );
  }

  const accounts = {};
  for (const [code, row] of found.entries()) {
    accounts[code] = row.id;
  }
  return accounts;
}

/**
 * يتحقق من قيد موجود (بعد الإنشاء) — defensive
 * @param {object} client
 * @param {string} journalEntryId
 * @param {string} context
 * @throws {ApiError} إذا كان القيد غير متوازن أو مفقود
 */
async function verifyJournalEntry(client, journalEntryId, context = '') {
  if (!journalEntryId) {
    throw new ApiError(500, `لا يوجد journal_entry_id ${context}`);
  }

  const r = await client.query(
    `SELECT
       COALESCE(SUM(debit), 0) AS total_debit,
       COALESCE(SUM(credit), 0) AS total_credit,
       COUNT(*)::int AS lines_count
     FROM journal_entry_lines
     WHERE journal_entry_id = $1`,
    [journalEntryId]
  );

  const row = r.rows[0];
  const d = round2(row.total_debit);
  const c = round2(row.total_credit);
  const n = row.lines_count;

  if (n < 2) {
    throw new ApiError(
      500,
      `فشل إنشاء القيد ${context}: عدد السطور ${n} أقل من 2`
    );
  }

  if (Math.abs(d - c) > 0.01) {
    throw new ApiError(
      500,
      `فشل إنشاء القيد ${context}: غير متوازن (مدين=${d}, دائن=${c})`
    );
  }

  return { total_debit: d, total_credit: c, lines_count: n };
}

/**
 * يحسب الإجماليات من البنود
 * @param {Array} items - [{quantity, unit_price, discount_rate, tax_rate}, ...]
 * @returns {{subtotal, discount_total, tax_total, total}}
 */
function calculateTotals(items) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const discRate = Number(item.discount_rate) || 0;
    const taxRate = Number(item.tax_rate) || 0;

    const lineGross = qty * price;
    const discAmt = round2((lineGross * discRate) / 100);
    const net = round2(lineGross - discAmt);
    const taxAmt = round2((net * taxRate) / 100);

    subtotal += net;
    discountTotal += discAmt;
    taxTotal += taxAmt;
  }

  subtotal = round2(subtotal);
  discountTotal = round2(discountTotal);
  taxTotal = round2(taxTotal);
  const total = round2(subtotal + taxTotal);

  return { subtotal, discount_total: discountTotal, tax_total: taxTotal, total };
}

/**
 * يبني سطور القيد لاستلام بضاعة
 * @param {object} params
 *   - accounts: { '113': id, '114': id, '211': id, '1111': id }
 *   - subtotal, taxTotal, total
 *   - paymentType: 'cash' | 'credit'
 *   - reference: string (رقم الإذن)
 * @returns {Array} lines
 */
function buildGoodsReceiptLines({
  accounts,
  subtotal,
  taxTotal,
  total,
  paymentType,
  reference,
}) {
  const lines = [];

  // Dr 113 (مخزون)
  lines.push({
    account_id: accounts['113'],
    debit: subtotal,
    credit: 0,
    description: `استلام بضاعة ${reference}`,
  });

  // Dr 114 (ضريبة مدخلات) إن وُجدت
  if (taxTotal > 0.01) {
    lines.push({
      account_id: accounts['114'],
      debit: taxTotal,
      credit: 0,
      description: `ضريبة استلام ${reference}`,
    });
  }

  // Cr (ذمم موردين أو صندوق)
  const creditAccountId =
    paymentType === 'cash' ? accounts['1111'] : accounts['211'];
  lines.push({
    account_id: creditAccountId,
    debit: 0,
    credit: total,
    description:
      paymentType === 'cash'
        ? `دفع نقدي استلام ${reference}`
        : `ذمم مورد استلام ${reference}`,
  });

  return lines;
}

/**
 * يبني سطور قيد إشعار مدين/دائن
 * @param {object} params
 *   - accounts: { '112': id, '211': id, '411': id, '511': id, '518': id }
 *   - noteType: 'credit' | 'debit'
 *   - partyType: 'customer' | 'supplier'
 *   - total
 *   - reference
 * @returns {Array} lines
 */
function buildNoteLines({
  accounts,
  noteType,
  partyType,
  total,
  reference,
}) {
  const isCustomer = partyType === 'customer';
  const isCredit = noteType === 'credit';

  if (isCredit && isCustomer) {
    // Dr مرتجع مبيعات / Cr ذمم عملاء
    return [
      {
        account_id: accounts['411'],
        debit: total,
        credit: 0,
        description: `إشعار دائن ${reference}`,
      },
      {
        account_id: accounts['112'],
        debit: 0,
        credit: total,
        description: `إشعار دائن ${reference}`,
      },
    ];
  }

  if (isCredit && !isCustomer) {
    // Dr ذمم موردين / Cr مرتجع مشتريات
    return [
      {
        account_id: accounts['211'],
        debit: total,
        credit: 0,
        description: `إشعار دائن ${reference}`,
      },
      {
        account_id: accounts['511'],
        debit: 0,
        credit: total,
        description: `إشعار دائن ${reference}`,
      },
    ];
  }

  if (!isCredit && isCustomer) {
    // Dr ذمم عملاء / Cr إيرادات أخرى
    return [
      {
        account_id: accounts['112'],
        debit: total,
        credit: 0,
        description: `إشعار مدين ${reference}`,
      },
      {
        account_id: accounts['411'],
        debit: 0,
        credit: total,
        description: `إشعار مدين ${reference}`,
      },
    ];
  }

  // !isCredit && !isCustomer
  // Dr مصاريف أخرى / Cr ذمم موردين
  return [
    {
      account_id: accounts['518'],
      debit: total,
      credit: 0,
      description: `إشعار مدين ${reference}`,
    },
    {
      account_id: accounts['211'],
      debit: 0,
      credit: total,
      description: `إشعار مدين ${reference}`,
    },
  ];
}

/**
 * يبني سطور قيد دفع/قبض
 * @param {object} params
 *   - accounts: { cashAccountId, partyAccountId }
 *   - amount
 *   - direction: 'receive' | 'pay'
 *     • receive: Dr cash / Cr party (استلام نقد)
 *     • pay:     Dr party / Cr cash (دفع نقد)
 *   - reference
 * @returns {Array} lines
 */
function buildPaymentLines({ accounts, amount, direction, reference, description }) {
  const desc = description || reference || '';

  if (direction === 'receive') {
    return [
      {
        account_id: accounts.cashAccountId,
        debit: amount,
        credit: 0,
        description: `قبض — ${desc}`,
      },
      {
        account_id: accounts.partyAccountId,
        debit: 0,
        credit: amount,
        description: `قبض — ${desc}`,
      },
    ];
  }

  // pay
  return [
    {
      account_id: accounts.partyAccountId,
      debit: amount,
      credit: 0,
      description: `دفع — ${desc}`,
    },
    {
      account_id: accounts.cashAccountId,
      debit: 0,
      credit: amount,
      description: `دفع — ${desc}`,
    },
  ];
}

/**
 * يبني سطور قيد استرداد لعميل
 * Dr ذمم عملاء / Cr صندوق
 */
function buildRefundLines({ accounts, amount, reference }) {
  return [
    {
      account_id: accounts.partyAccountId,  // ذمم عملاء
      debit: amount,
      credit: 0,
      description: `استرداد — ${reference || ''}`,
    },
    {
      account_id: accounts.cashAccountId,   // صندوق
      debit: 0,
      credit: amount,
      description: `استرداد — ${reference || ''}`,
    },
  ];
}

/**
 * يبني سطور قيد تخصيص رصيد (Dr party / Cr party — صافي صفر للتتبع)
 */
function buildCreditApplyLines({ accounts, amount, reference }) {
  return [
    {
      account_id: accounts.partyAccountId,
      debit: amount,
      credit: 0,
      description: `تخصيص رصيد — ${reference || ''}`,
    },
    {
      account_id: accounts.partyAccountId,
      debit: 0,
      credit: amount,
      description: `تخصيص رصيد — ${reference || ''}`,
    },
  ];
}

/**
 * يبني سطور قيد إنشاء مصروف
 * - نقد: Dr expense / Cr cash
 * - آجل: Dr expense / Cr payable
 * - جزئي: Dr expense / Cr cash + Cr payable
 */
function buildExpenseLines({
  accounts,
  amountBase,
  paidBase,
  creditBase,
  description,
}) {
  const lines = [
    {
      account_id: accounts.expenseAccountId,
      debit: amountBase,
      credit: 0,
      description: description || 'مصروف',
    },
  ];

  if (paidBase > 0) {
    lines.push({
      account_id: accounts.cashAccountId,
      debit: 0,
      credit: paidBase,
      description: 'دفع نقدي',
    });
  }

  if (creditBase > 0) {
    lines.push({
      account_id: accounts.payableAccountId,
      debit: 0,
      credit: creditBase,
      description: `ذمة مورد — ${description || ''}`,
    });
  }

  return lines;
}

/**
 * يبني سطور قيد دفع مصروف (Dr payable / Cr cash)
 */
function buildExpensePayLines({
  accounts,
  amountBase,
  reference,
}) {
  return [
    {
      account_id: accounts.payableAccountId,
      debit: amountBase,
      credit: 0,
      description: `دفع ذمة مورد — ${reference || ''}`,
    },
    {
      account_id: accounts.cashAccountId,
      debit: 0,
      credit: amountBase,
      description: `صرف نقدي — ${reference || ''}`,
    },
  ];
}


module.exports = {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
  calculateTotals,
  buildGoodsReceiptLines,
  buildNoteLines,
   buildPaymentLines,
  buildRefundLines,
  buildCreditApplyLines,
 buildExpenseLines,
  buildExpensePayLines,
};