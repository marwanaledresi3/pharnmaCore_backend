// services/purchaseOrder/helpers/journal.js
const JournalEntry = require('../../../models/JournalEntry');
const ApiError = require('../../../errors/ApiError');
const { getBuyerAccounts, getSupplierAccounts } = require('./accounts');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function assertBalanced(lines, context) {
  const totalDebit = round2(lines.reduce((sum, l) => sum + Number(l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + Number(l.credit || 0), 0));

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new ApiError(500, `Journal entry is not balanced (${context}): debit=${totalDebit}, credit=${totalCredit}`);
  }
  if (lines.length < 2) {
    throw new ApiError(500, `Journal entry must have at least 2 lines (${context})`);
  }
  for (const l of lines) {
    const d = Number(l.debit || 0);
    const c = Number(l.credit || 0);
    if (d < 0 || c < 0) throw new ApiError(500, `Debit/credit must be >= 0 (${context})`);
    if (d > 0 && c > 0) throw new ApiError(500, `Line cannot have both debit and credit (${context})`);
    if (d === 0 && c === 0) throw new ApiError(500, `Line must have debit OR credit > 0 (${context})`);
  }
}

function extractOrderAmounts(order) {
  const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
  const total = Number(order.total);
  const taxTotal = Number(order.tax_total);

  if (!Number.isFinite(total) || total < 0) throw new ApiError(500, `Invalid order.total: ${order.total}`);
  if (!Number.isFinite(taxTotal) || taxTotal < 0) throw new ApiError(500, `Invalid order.tax_total: ${order.tax_total}`);

  const totalBase = round2(total * rate);
  const taxBase = round2(taxTotal * rate);
  const netBase = round2(totalBase - taxBase);

  if (netBase < 0) {
    throw new ApiError(500, `Invalid order amounts: netBase=${netBase} (total=${total}, tax=${taxTotal})`);
  }
  return { rate, totalBase, taxBase, netBase };
}

async function createBuyerJournalEntry(client, { order, companyId, userId }) {
  const accounts = await getBuyerAccounts(client, companyId);
  const { rate, totalBase, taxBase, netBase } = extractOrderAmounts(order);

  const lines = [
    { account_id: accounts.inventory, debit: netBase, credit: 0, description: 'استلام مخزون' },
  ];
  if (taxBase > 0) {
    lines.push({ account_id: accounts.vat_input, debit: taxBase, credit: 0, description: 'ضريبة مدخلات' });
  }
  lines.push({ account_id: accounts.payable, debit: 0, credit: totalBase, description: `أمر شراء ${order.order_number} [rate=${rate}]` });

  assertBalanced(lines, `buyer:${order.order_number}`);

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

async function createSupplierJournalEntries(client, { order, salesInvoice, inventory, userId }) {
  const accounts = await getSupplierAccounts(client, order.supplier_company_id);
  const { rate, totalBase, taxBase, netBase } = extractOrderAmounts(order);

  const salesLines = [
    { account_id: accounts.receivable, debit: totalBase, credit: 0, description: `ذمم مدينة — فاتورة ${salesInvoice.invoice_number}` },
    { account_id: accounts.sales_revenue, debit: 0, credit: netBase, description: 'إيرادات مبيعات' },
  ];
  if (taxBase > 0) {
    salesLines.push({ account_id: accounts.vat_output, debit: 0, credit: taxBase, description: 'ضريبة مخرجات' });
  }

  assertBalanced(salesLines, `supplier-sales:${order.order_number}`);

  const salesEntry = await JournalEntry.create(client, order.supplier_company_id, {
    entry_date: order.order_date,
    description: `فاتورة مبيعات ${salesInvoice.invoice_number} (أمر شراء ${order.order_number})`,
    source_type: 'sales_invoice',
    source_id: salesInvoice.id,
    created_by: userId,
    lines: salesLines,
  });

  await JournalEntry.post(client, order.supplier_company_id, salesEntry.id, userId);

  await client.query(`UPDATE invoices SET journal_entry_id = $1 WHERE id = $2`, [salesEntry.id, salesInvoice.id]);

  const cogsBase = round2(Number(inventory.totalCost) * rate);
  let cogsEntryId = null;

  if (cogsBase > 0) {
    const cogsLines = [
      { account_id: accounts.cogs, debit: cogsBase, credit: 0, description: 'تكلفة مبيعات' },
      { account_id: accounts.inventory, debit: 0, credit: cogsBase, description: 'خروج مخزون' },
    ];

    assertBalanced(cogsLines, `supplier-cogs:${order.order_number}`);

    const cogsEntry = await JournalEntry.create(client, order.supplier_company_id, {
      entry_date: order.order_date,
      description: `تكلفة مبيعات ${salesInvoice.invoice_number}`,
      source_type: 'sale_cogs',
      source_id: salesInvoice.id,
      created_by: userId,
      lines: cogsLines,
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

module.exports = { createBuyerJournalEntry, createSupplierJournalEntries, extractOrderAmounts, assertBalanced };