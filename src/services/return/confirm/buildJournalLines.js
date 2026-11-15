// services/return/confirm/buildJournalLines.js
const { round2 } = require('../helpers/rounding');

/**
 * يبني سطور القيد المحاسبي للمرتجع.
 *
 * ⚠️ totalInventoryChange يجب أن يكون بالعملة الأساسية.
 *    applyInventory يُرجعه بالعملة الأساسية.
 *
 * المنطق:
 * - مرتجع بيع: عكس قيد البيع + إرجاع المخزون
 * - مرتجع شراء: عكس قيد الشراء
 *
 * ✅ يستخدم return_type === 'sale' (بدون s) — متوافق مع CHECK
 */
function buildJournalLines(ret, accounts, totalInventoryChange) {
  const rate = Number(ret.exchange_rate) || 1;
  const totalBase = round2(Number(ret.total) * rate);
  const subtotalBase = round2(Number(ret.subtotal) * rate);
  const taxBase = round2(Number(ret.tax_total) * rate);

  const lines = [];

  // ═══ مرتجع بيع ═══════════════════════════════════════════════════
  if (ret.return_type === 'sale') {
    lines.push({
      account_id: accounts.revenue,
      debit: subtotalBase,
      credit: 0,
      description: 'مرتجع مبيعات',
    });

    if (taxBase > 0) {
      lines.push({
        account_id: accounts.vat_output,
        debit: taxBase,
        credit: 0,
        description: 'ضريبة مرتجعة',
      });
    }

    lines.push({
      account_id: accounts.receivable,
      credit: totalBase,
      debit: 0,
      description: `مرتجع فاتورة ${ret.return_number}`,
    });

    // إرجاع المخزون → Dr مخزون / Cr COGS
    if (totalInventoryChange > 0) {
      lines.push(
        {
          account_id: accounts.inventory,
          debit: totalInventoryChange,
          credit: 0,
          description: 'إرجاع مخزون',
        },
        {
          account_id: accounts.cogs,
          credit: totalInventoryChange,
          debit: 0,
          description: 'عكس تكلفة',
        }
      );
    }
  } else {
    // ═══ مرتجع شراء ═══════════════════════════════════════════════
    lines.push({
      account_id: accounts.payable,
      debit: totalBase,
      credit: 0,
      description: `مرتجع شراء ${ret.return_number}`,
    });

    // ✅ استخدام totalInventoryChange (القيمة الدفترية) بدلاً من subtotalBase
    const inventoryCredit = totalInventoryChange > 0 ? totalInventoryChange : subtotalBase;

    lines.push({
      account_id: accounts.inventory,
      credit: inventoryCredit,
      debit: 0,
      description: 'مرتجع مخزون',
    });

    if (taxBase > 0) {
      lines.push({
        account_id: accounts.vat_input,
        credit: taxBase,
        debit: 0,
        description: 'ضريبة مدخلات مرتجعة',
      });
    }

    // ✅ إذا كان هناك فرق بين inventoryCredit و subtotalBase، نضيفه لحساب فرق
    const diff = round2(subtotalBase - inventoryCredit);
    if (Math.abs(diff) > 0.01) {
      // نضيف الفرق إلى حساب الفرق (إذا وُجد) أو نتجاهله
      // ⚠️ هنا نفترض أن الفرق يُسجّل في cogs (لأنه فرق تكلفة)
      if (diff > 0) {
        // inventoryCredit < subtotalBase → نحتاج debit إضافي
        lines.push({
          account_id: accounts.cogs,
          debit: diff,
          credit: 0,
          description: 'فرق تكلفة مرتجع',
        });
      } else {
        // inventoryCredit > subtotalBase → نحتاج credit إضافي
        lines.push({
          account_id: accounts.cogs,
          credit: Math.abs(diff),
          debit: 0,
          description: 'فرق تكلفة مرتجع',
        });
      }
    }
  }

  // ═══ تحقق من التوازن ═════════════════════════════════════════════
  const totalDebit = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal entry not balanced: debit=${totalDebit}, credit=${totalCredit} ` +
      `(return ${ret.return_number}, type=${ret.return_type})`
    );
  }

  return lines;
}

module.exports = { buildJournalLines };