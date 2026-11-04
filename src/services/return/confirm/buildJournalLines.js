const { round2 } = require('../helpers/rounding');

/**
 * يبني سطور القيد المحاسبي.
 */
function buildJournalLines(ret, accounts, totalInventoryChange) {
  console.log('[confirm:3] buildJournalLines START');
  console.log('[confirm:3] return_type =', ret.return_type, '| totalInventoryChange =', totalInventoryChange);

  const rate = Number(ret.exchange_rate) || 1;
  const totalBase = round2(Number(ret.total) * rate);
  const subtotalBase = round2(Number(ret.subtotal) * rate);
  const taxBase = round2(Number(ret.tax_total) * rate);

  const lines = [];

  if (ret.return_type === 'sales') {
    // مرتجع بيع → عكس قيد البيع:
    //   مدين: إيراد (subtotal)
    //   مدين: ضريبة (tax)
    //     دائن: ذمم مدينة (total)
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

    // إرجاع المخزون → مدين مخزون / دائن COGS
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
    // مرتجع شراء → عكس قيد الشراء:
    //   مدين: ذمم دائنة (total)
    //     دائن: مخزون (subtotal)
    //     دائن: ضريبة مدخلات (tax)
    lines.push({
      account_id: accounts.payable,
      debit: totalBase,
      credit: 0,
      description: `مرتجع شراء ${ret.return_number}`,
    });
    lines.push({
      account_id: accounts.inventory,
      credit: subtotalBase,
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
  }

  // تحقق من التوازن
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);

  console.log('[confirm:3] debit =', round2(totalDebit), '| credit =', round2(totalCredit));

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal entry not balanced: debit=${totalDebit}, credit=${totalCredit}`
    );
  }

  return lines;
}

module.exports = { buildJournalLines };