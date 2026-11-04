const JournalEntry = require('../../../models/JournalEntry');
const { getBuyerAccounts, getSupplierAccounts } = require('./accounts');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * قيد المشتري: مدين مخزون + ضريبة مدخلات / دائن مورد.
 * يعيد journal_entry_id.
 */
async function createBuyerJournalEntry(client, { order, companyId, userId }) {
  const accounts = await getBuyerAccounts(client, companyId);
  const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
  const totalBase = round2(Number(order.total) * rate);
  const subtotalBase = round2(Number(order.subtotal) * rate);
  const taxBase = round2(Number(order.tax_total) * rate);

  const lines = [
    {
      account_id: accounts.inventory,
      debit: subtotalBase,
      credit: 0,
      description: 'استلام مخزون',
    },
  ];

  if (taxBase > 0) {
    lines.push({
      account_id: accounts.vat_input,
      debit: taxBase,
      credit: 0,
      description: 'ضريبة مدخلات',
    });
  }

  lines.push({
    account_id: accounts.payable,
    credit: totalBase,
    debit: 0,
    description: `أمر شراء ${order.order_number} [${order.exchange_rate}]`,
  });

  const entry = await JournalEntry.create(client, companyId, {
    entry_date: order.order_date,
    description: `قيد أمر شراء ${order.order_number}`,
    source_type: 'purchase',
    source_id: order.id,
    created_by: userId,
    lines,
  });
  await JournalEntry.post(client, companyId, entry.id, userId);
  return entry.id;
}

/**
 * قيود المورد:
 * 1) إيراد: مدين ذمم / دائن إيرادات + ضريبة مخرجات
 * 2) COGS: مدين تكلفة مبيعات / دائن مخزون
 */
async function createSupplierJournalEntries(client, {
  order,
  salesInvoice,
  inventory,
  userId,
}) {
  const accounts = await getSupplierAccounts(client, order.supplier_company_id);
  const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
  const totalBase = round2(Number(order.total) * rate);
  const subtotalBase = round2(Number(order.subtotal) * rate);
  const taxBase = round2(Number(order.tax_total) * rate);

  // ═══ 1) قيد الإيراد ═══
  const salesLines = [
    {
      account_id: accounts.receivable,
      debit: totalBase,
      credit: 0,
      description: `ذمم مدينة — فاتورة ${salesInvoice.invoice_number}`,
    },
    {
      account_id: accounts.sales_revenue,
      debit: 0,
      credit: subtotalBase,
      description: 'إيرادات مبيعات',
    },
  ];
  if (taxBase > 0) {
    salesLines.push({
      account_id: accounts.vat_output,
      debit: 0,
      credit: taxBase,
      description: 'ضريبة مخرجات',
    });
  }

  const salesEntry = await JournalEntry.create(client, order.supplier_company_id, {
    entry_date: order.order_date,
    description: `فاتورة مبيعات ${salesInvoice.invoice_number} (أمر شراء ${order.order_number})`,
    source_type: 'sales_invoice',
    source_id: salesInvoice.id,
    created_by: userId,
    lines: salesLines,
  });
  await JournalEntry.post(client, order.supplier_company_id, salesEntry.id, userId);

  await client.query(
    `UPDATE invoices SET journal_entry_id = $1 WHERE id = $2`,
    [salesEntry.id, salesInvoice.id]
  );

  // ═══ 2) قيد COGS ═══
  const cogsBase = round2(Number(inventory.totalCost) * rate);
  let cogsEntryId = null;

  if (cogsBase > 0) {
    const cogsEntry = await JournalEntry.create(client, order.supplier_company_id, {
      entry_date: order.order_date,
      description: `تكلفة مبيعات ${salesInvoice.invoice_number}`,
      source_type: 'sale_cogs',
      source_id: salesInvoice.id,
      created_by: userId,
      lines: [
        {
          account_id: accounts.cogs,
          debit: cogsBase,
          credit: 0,
          description: 'تكلفة مبيعات',
        },
        {
          account_id: accounts.inventory,
          debit: 0,
          credit: cogsBase,
          description: 'خروج مخزون',
        },
      ],
    });
    await JournalEntry.post(client, order.supplier_company_id, cogsEntry.id, userId);
    cogsEntryId = cogsEntry.id;
  }

  return {
    sales_entry_id: salesEntry.id,
    cogs_entry_id: cogsEntryId,
    cogs_total_base: cogsBase,
  };
}

module.exports = {
  createBuyerJournalEntry,
  createSupplierJournalEntries,
};