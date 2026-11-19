// controllers/PdfController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { resolveLogoAsync } = require('../services/pdf/helpers/logoResolver');
const { formatDate } = require('../utils/dateUtils');
const { numToArabicWords } = require('../utils/numberToArabicWords');
const { pool } = require('../config/pool');

// ═══ Models ═══
const InvoiceModel = require('../models/Invoice');
const SalesOrderModel = require('../models/SalesOrder');
const NoteModel = require('../models/Note');  // 🆕

// ═══ Services ═══
const GoodsReceiptService = require('../services/goodsReceiptService');  // 🆕
const StockTransferService = require('../services/stockTransferService');  // 🆕
const StockAdjustmentService = require('../services/stockAdjustmentService');  // 🆕

// ═══ PDF ═══
const {
  generateInvoice,
  generateVoucher,
  generateExpense,
  generateStatement,
  generateReturn,
  generateTrialBalance,
  generateDeliveryNote,
  generatePurchaseOrder,
  generateSalesOrder,
  // 🆕
  creditNote: generateCreditNote,
  debitNote: generateDebitNote,
  goodsReceipt: generateGoodsReceipt,
  stockTransfer: generateStockTransfer,
  stockAdjustment: generateStockAdjustment,
  
  hrReport: generateHrReport,  
  payslip: generatePayslip,
  payrollReport: generatePayrollReport,
} = require('../services/pdf');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

async function companyPdfData(company) {
  const logoBuffer = await resolveLogoAsync(company.logo_url);
  return {
    name: company.name,
    name_en: company.name_en,
    nameAr: company.name,
    nameEn: company.name_en,
    tax_number: company.tax_number,
    address: company.address,
    addressAr: company.address,
    addressEn: company.address_en || '',
    phone: company.phone,
    phoneAr: company.phone,
    phoneEn: company.phone_en || '',
    email: company.email,
    logo_url: company.logo_url,
    _logoBuffer: logoBuffer,
  };
}

async function getCompany(client, companyId) {
  const r = await client.query(
    `SELECT name, name_en, tax_number, address, phone, email, logo_url,
            currency_id
     FROM companies WHERE id = $1`,
    [companyId]
  );
  return r.rows[0] || {};
}

async function getParty(client, companyId, partyType, partyId) {
  const table = partyType === 'customer' ? 'customers' : 'suppliers';
  const r = await client.query(
    `SELECT name, phone, email, address, tax_number
     FROM ${table} WHERE id = $1 AND company_id = $2`,
    [partyId, companyId]
  );
  return r.rows[0] || {};
}
/* ============================================================
 * 1) فاتورة
 * ============================================================ */
const invoice = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    // 1) الفاتورة كاملة عبر الموديل (يجلب البنود من sales_order_items / purchase_order_items)
    const inv = await InvoiceModel.findById(companyId, id);
    if (!inv) throw new ApiError(404, 'Invoice not found');

    // 2) الشركة
    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // 3) الطرف
    const isSale = inv.invoice_type === 'sales';
    const party = {
      name: inv.party_name,
      phone: inv.party_phone,
      email: inv.party_email,
      address: inv.party_address,
      tax_number: inv.party_tax_number,
    };

    // 4) البنود — من items التي أرجعها findById
    const items = (inv.items || []).map((it) => {
      const qty = Number(it.quantity || 0);
      const bonus = Number(it.bonus_quantity || 0);
      const paid = Math.max(0, qty - bonus);

      return {
        name: it.product_name || '—',
        sku: it.sku || '—',
        quantity: qty,
        paid_quantity: paid,
        bonus_quantity: bonus,
        unit_price: Number(it.unit_price || 0),
        tax: it.tax_rate > 0 ? `${it.tax_rate}%` : '—',
        total: Number(it.line_total || 0),
        batch_number: it.batch_number || null,
        expiry_date: formatDate(it.expiry_date) || null,
      };
    });

    // 5) المجاميع (محسوبة في findById)
    const summary = [
      { label: 'المجموع الفرعي', value: Number(inv.subtotal || 0) },
      { label: 'الضريبة', value: Number(inv.tax_amount || 0) },
      { label: 'الإجمالي', value: Number(inv.total || 0), isTotal: true },
    ];

    // 6) المبلغ بالحروف
    const amountInWords = `${numToArabicWords(inv.total)} ${
      inv.currency_code === 'YER' ? 'ريال يمني' : inv.currency_code
    } فقط لا غير`;

    // 7) PDF
    const buffer = await generateInvoice({
      company: companyData,
      docType: isSale ? 'sale_invoice' : 'purchase_invoice',
      docNumber: inv.invoice_number,
      docDate: formatDate(inv.invoice_date),
      partyTitle: isSale ? 'العميل' : 'المورد',
      party,
      items,
      summary,
      amountInWords,
      currencyCode: inv.currency_code,
      extraInfo: {
        'حالة السداد':
          inv.status === 'paid'
            ? 'مدفوعة'
            : inv.status === 'partial'
            ? 'مدفوعة جزئياً'
            : 'غير مدفوعة',
        'تاريخ الاستحقاق': inv.due_date ? String(inv.due_date).slice(0, 10) : '—',
      },
      notes: inv.notes || null,
    });

    sendPdf(res, buffer, `invoice-${inv.invoice_number}`);
  } catch (err) {
    console.error('[pdf:invoice] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});

/* ============================================================
 * 2) مرتجع
 * ============================================================ */
const returnDoc = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const retRes = await client.query(
      `SELECT r.*, cu.code AS currency_code, i.invoice_number AS original_invoice
       FROM returns r
       JOIN currencies cu ON cu.id = r.currency_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [id, companyId]
    );
    const ret = retRes.rows[0];
    if (!ret) throw new ApiError(404, 'Return not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const isSale = ret.return_type === 'sale';
    const party = isSale
      ? await getParty(client, companyId, 'customer', ret.customer_id)
      : await getParty(client, companyId, 'supplier', ret.supplier_id);

    const itemsRes = await client.query(
      `SELECT ri.quantity, ri.unit_price, ri.tax_rate, ri.tax_amount, ri.line_total,
              ri.bonus_quantity, ri.conversion_factor,
              p.name AS product_name, p.sku
       FROM return_items ri
       JOIN products p ON p.id = ri.product_id
       WHERE ri.return_id = $1`,
      [id]
    );

    const items = itemsRes.rows.map((it) => ({
      name: it.product_name,
      sku: it.sku,
      quantity: Number(it.quantity || 0),
      paid_quantity: Number(it.quantity || 0),
      bonus_quantity: Number(it.bonus_quantity || 0),
      unit_price: Number(it.unit_price || 0),
      tax: it.tax_rate > 0 ? `${it.tax_rate}%` : '—',
      total: Number(it.line_total || 0),
    }));

    const summary = [
      { label: 'المجموع الفرعي', value: Number(ret.subtotal) },
      { label: 'الضريبة', value: Number(ret.tax_total) },
      { label: 'الإجمالي المسترجع', value: Number(ret.total), isTotal: true },
    ];

    const amountInWords = `${numToArabicWords(ret.total)} ${
      ret.currency_code === 'YER' ? 'ريال يمني' : ret.currency_code
    } فقط لا غير`;

    const buffer = await generateReturn({
      company: companyData,
      returnType: isSale ? 'sale_return' : 'purchase_return',
      returnNumber: ret.return_number,
      returnDate: formatDate(ret.return_date),
      originalInvoiceNumber: ret.original_invoice || null,
      originalInvoiceDate: null,
      partyTitle: isSale ? 'العميل' : 'المورد',
      party,
      items,
      summary: {
        subtotal: Number(ret.subtotal),
        tax: Number(ret.tax_total),
        total: Number(ret.total),
      },
      amountInWords,
      currencyCode: ret.currency_code,
      reason: ret.reason || null,
      extraInfo: [],
    });

    sendPdf(res, buffer, `return-${ret.return_number}`);
  } finally {
    client.release();
  }
});

/* ============================================================
 * 3) سند قبض/صرف
 * ============================================================ */
const payment = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const payRes = await client.query(
      `SELECT p.*, cu.code AS currency_code,
              i.invoice_number,
              COALESCE(c.name, s.name, c2.name, s2.name) AS party_name
       FROM payments p
       LEFT JOIN currencies cu ON cu.id = p.currency_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN customers c2 ON c2.id = p.customer_id
       LEFT JOIN suppliers s2 ON s2.id = p.supplier_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [id, companyId]
    );
    const pay = payRes.rows[0];
    if (!pay) throw new ApiError(404, 'Payment not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);
    const isReceive = pay.payment_type === 'receive';

    const amountInWords = `${numToArabicWords(pay.amount)} ${
      pay.currency_code === 'YER' ? 'ريال يمني' : pay.currency_code
    } فقط لا غير`;

    const buffer = await generateVoucher({
      company: companyData,
      voucherType: isReceive ? 'receipt' : 'payment',
      voucherNumber: pay.voucher_number || `PAY-${id.slice(0, 8)}`,
      voucherDate: formatDate(pay.payment_date),
      amount: Number(pay.amount),
      amountInWords,
      partyName: pay.party_name || '—',
      settlementOf:
        pay.description ||
        (pay.invoice_number ? `سداد فاتورة #${pay.invoice_number}` : '—'),
      method: pay.method || 'cash',
      chequeNumber: pay.cheque_number || null,
      chequeDate: formatDate(pay.cheque_date) || null,
      bankName: pay.bank_name || null,
      currencyCode: pay.currency_code || 'YER',
      externalReference: pay.external_reference || null,
    });

    sendPdf(res, buffer, `voucher-${pay.voucher_number || id.slice(0, 8)}`);
  } catch (err) {
    console.error('[pdf:payment] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});

/* ============================================================
 * 4) أمر شراء
 * ============================================================ */
const purchaseOrder = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const poRes = await client.query(
      `SELECT po.*, cu.code AS currency_code, s.name AS supplier_name,
              s.phone AS supplier_phone, s.email AS supplier_email,
              s.address AS supplier_address, s.tax_number AS supplier_tax_number
       FROM purchase_orders po
       JOIN currencies cu ON cu.id = po.currency_id
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.company_id = $2`,
      [id, companyId]
    );
    const po = poRes.rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const itemsRes = await client.query(
      `SELECT poi.quantity, poi.unit_price, poi.tax_rate, poi.line_total,
              poi.bonus_quantity, poi.batch_number, poi.expiry_date,
              p.name AS product_name, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1
       ORDER BY poi.id`,
      [id]
    );

    const items = itemsRes.rows.map((it) => ({
      name: it.product_name,
      sku: it.sku,
      quantity: Number(it.quantity || 0),
      bonus_quantity: Number(it.bonus_quantity || 0),
      unit_price: Number(it.unit_price || 0),
      tax: it.tax_rate > 0 ? `${it.tax_rate}%` : '—',
      total: Number(it.line_total || 0),
      expiry_date: formatDate(it.expiry_date) || null,
    }));

    const amountInWords = `${numToArabicWords(po.total)} ${
      po.currency_code === 'YER' ? 'ريال يمني' : po.currency_code
    } فقط لا غير`;

    const buffer = await generatePurchaseOrder({
      company: companyData,
      orderNumber: po.order_number,
      orderDate: formatDate(po.order_date),
      supplier: {
        name: po.supplier_name,
        phone: po.supplier_phone,
        email: po.supplier_email,
        address: po.supplier_address,
        tax_number: po.supplier_tax_number,
      },
      items,
      summary: {
        subtotal: Number(po.subtotal),
        tax: Number(po.tax_total),
        total: Number(po.total),
      },
      amountInWords,
      currencyCode: po.currency_code,
      extraInfo: [
        { label: 'الحالة', value: po.status },
        { label: 'نوع الدفع', value: po.payment_type || '—' },
      ],
    });

    sendPdf(res, buffer, `po-${po.order_number}`);
  } finally {
    client.release();
  }
});

/* ============================================================
 * 5) بوليصة تسليم
 * ============================================================ */
const deliveryNote = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const poRes = await client.query(
      `SELECT po.*, cu.code AS currency_code, s.name AS supplier_name,
              s.phone AS supplier_phone, s.address AS supplier_address
       FROM purchase_orders po
       JOIN currencies cu ON cu.id = po.currency_id
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.company_id = $2`,
      [id, companyId]
    );
    const po = poRes.rows[0];
    if (!po) throw new ApiError(404, 'Purchase order not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const itemsRes = await client.query(
      `SELECT poi.quantity, poi.bonus_quantity, poi.batch_number, poi.expiry_date,
              p.name AS product_name, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1
       ORDER BY poi.id`,
      [id]
    );

    const items = itemsRes.rows.map((it) => ({
      name: it.product_name,
      sku: it.sku,
      quantity: Number(it.quantity || 0),
      paid_quantity: Number(it.quantity || 0),
      bonus_quantity: Number(it.bonus_quantity || 0),
      batch_number: it.batch_number || '—',
      expiry_date: formatDate(it.expiry_date) || '—',
    }));

    // QR (نص)
    const qrRes = await client.query(
      `SELECT 1 FROM delivery_tokens WHERE order_id = $1 AND used_at IS NULL LIMIT 1`,
      [id]
    );
    const qrData = qrRes.rowCount > 0
      ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/deliveries/confirm?order=${po.id}`
      : null;

    const buffer = await generateDeliveryNote({
      company: companyData,
      deliveryNumber: po.order_number,
      deliveryDate: formatDate(new Date()),
      orderNumber: po.order_number,
      partyTitle: 'المورد',
      party: {
        name: po.supplier_name,
        phone: po.supplier_phone,
        address: po.supplier_address,
      },
      warehouseName: null,
      driverName: null,
      vehicleNumber: null,
      items,
      notes: null,
      extraInfo: [
        { label: 'تاريخ أمر الشراء', value: formatDate(po.order_date) },
      ],
    });

    sendPdf(res, buffer, `delivery-${po.order_number}`);
  } finally {
    client.release();
  }
});

/* ============================================================
 * 6) كشف حساب
 * ============================================================ */
const statement = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { partyType, id } = req.params;
    const companyId = req.user.company_id;
    const { date_from, date_to } = req.query;

    const party = await getParty(client, companyId, partyType, id);
    if (!party.name) throw new ApiError(404, 'Party not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // الفواتير
    const invParams = [id, companyId];
    const invConds = [
      partyType === 'customer' ? 'i.customer_id = $1' : 'i.supplier_id = $1',
      'i.company_id = $2',
      `i.status <> 'cancelled'`,
    ];
    if (date_from) { invParams.push(date_from); invConds.push(`i.invoice_date >= $${invParams.length}`); }
    if (date_to)   { invParams.push(date_to);   invConds.push(`i.invoice_date <= $${invParams.length}`); }

    const invRes = await client.query(
      `SELECT i.id, i.invoice_number, i.status, i.invoice_date, i.total, i.paid_amount,
              i.invoice_type, i.due_date
       FROM invoices i
       WHERE ${invConds.join(' AND ')}
       ORDER BY i.invoice_date, i.created_at`,
      invParams
    );

    // الدفعات
    const payParams = [companyId];
    const payConds = ['p.company_id = $1'];
    if (partyType === 'customer') {
      payParams.push(id);
      payConds.push(`(
        (p.invoice_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM invoices i2 WHERE i2.id = p.invoice_id AND i2.customer_id = $${payParams.length}
        ))
        OR p.customer_id = $${payParams.length}
      )`);
      payConds.push(`p.payment_type = 'receive'`);
    } else {
      payParams.push(id);
      payConds.push(`(
        (p.invoice_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM invoices i2 WHERE i2.id = p.invoice_id AND i2.supplier_id = $${payParams.length}
        ))
        OR p.supplier_id = $${payParams.length}
      )`);
      payConds.push(`p.payment_type = 'pay'`);
    }
    if (date_from) { payParams.push(date_from); payConds.push(`p.payment_date >= $${payParams.length}`); }
    if (date_to)   { payParams.push(date_to);   payConds.push(`p.payment_date <= $${payParams.length}`); }

    let payRes = { rows: [], rowCount: 0 };
    try {
      payRes = await client.query(
        `SELECT p.id, p.amount, p.payment_date, p.method, p.reference,
                p.voucher_number, p.external_reference, p.description,
                i.invoice_number
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE ${payConds.join(' AND ')}
         ORDER BY p.payment_date`,
        payParams
      );
    } catch (pErr) {
      console.warn('[pdf:statement] payments query failed (non-fatal):', pErr.message);
    }

    const transactions = [];

    for (const inv of invRes.rows) {
      const total = Number(inv.total);
      const isSale = inv.invoice_type === 'sales';
      const isPaid = inv.status === 'paid';

      if (partyType === 'customer' && isSale) {
        transactions.push({
          date: formatDate(inv.invoice_date) || '—',
          doc_number: inv.invoice_number,
          description: 'عليكم فاتورة مبيعات',
          debit: total, credit: 0, balance: 0,
        });
      } else if (partyType === 'supplier' && !isSale && !isPaid) {
        transactions.push({
          date: formatDate(inv.invoice_date) || '—',
          doc_number: inv.invoice_number,
          description: 'لديكم فاتورة مشتريات',
          debit: 0, credit: total, balance: 0,
        });
      }
    }

    for (const p of payRes.rows) {
      const amt = Number(p.amount);
      if (partyType === 'customer') {
        transactions.push({
          date: formatDate(p.payment_date) || '—',
          doc_number: p.voucher_number || p.reference || '—',
          description: `لكم سند قبض ${p.description?.trim() || ''}`,
          debit: 0, credit: amt, balance: 0,
        });
      } else {
        transactions.push({
          date: formatDate(p.payment_date) || '—',
          doc_number: p.voucher_number || p.reference || '—',
          description: `عليكم سند صرف ${p.description?.trim() || ''}`,
          debit: amt, credit: 0, balance: 0,
        });
      }
    }

    transactions.sort((a, b) => a.date.localeCompare(b.date));

    let bal = 0;
    for (const t of transactions) {
      bal += Number(t.debit) - Number(t.credit);
      t.balance = bal;
    }

    const buffer = await generateStatement({
      company: companyData,
      partyType,
      partyTitle: partyType === 'customer' ? 'العميل' : 'المورد',
      party,
      docNumber: `STMT-${id.slice(0, 8)}`,
      docDate: formatDate(new Date()),
      dateFrom: date_from || null,
      dateTo: date_to || null,
      openingBalance: 0,
      items: transactions,
      summary: {
        totalDebit: transactions.reduce((s, t) => s + Number(t.debit), 0),
        totalCredit: transactions.reduce((s, t) => s + Number(t.credit), 0),
        closingBalance: Math.abs(bal),
      },
      currencyCode: company.currency_code || 'YER',
    });

    sendPdf(res, buffer, `statement-${partyType}-${id.slice(0, 8)}`);
  } catch (err) {
    console.error('[pdf:statement] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});

/* ============================================================
 * 7) مصروف
 * ============================================================ */
const expense = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const expRes = await client.query(
      `SELECT e.*, cu.code AS currency_code,
              a.code AS account_code, a.name AS account_name,
              s.name AS supplier_name,
              je.entry_number AS journal_entry_number
       FROM expenses e
       JOIN currencies cu ON cu.id = e.currency_id
       JOIN chart_of_accounts a ON a.id = e.expense_account_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN journal_entries je ON je.id = e.journal_entry_id
       WHERE e.id = $1 AND e.company_id = $2`,
      [id, companyId]
    );
    const exp = expRes.rows[0];
    if (!exp) throw new ApiError(404, 'Expense not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const amountInWords = `${numToArabicWords(exp.amount)} ${
      exp.currency_code === 'YER' ? 'ريال يمني' : exp.currency_code
    } فقط لا غير`;

    const buffer = await generateExpense({
      company: companyData,
      expenseNumber: exp.expense_number,
      expenseDate: exp.expense_date,
      expenseCategory: exp.expense_category,
      accountCode: exp.account_code,
      accountName: exp.account_name,
      description: exp.description,
      amount: exp.amount,
      amountInWords,
      supplierName: exp.supplier_name,
      method: exp.payment_method || 'cash',
      paidAmount: exp.paid_amount,
      status: exp.status,
      currencyCode: exp.currency_code,
      externalReference: exp.external_reference,
      journalEntryNumber: exp.journal_entry_number,
    });

    sendPdf(res, buffer, `expense-${exp.expense_number}`);
  } catch (err) {
    console.error('[pdf:expense] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});

/* ============================================================
 * 8) ميزان مراجعة
 * ============================================================ */
const trialBalance = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const companyId = req.user.company_id;
    const { date_from, date_to } = req.query;

    const Report = require('../models/Report');
    const data = await Report.trialBalance(companyId, { date_from, date_to });

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const items = data.accounts.map((a) => ({
      code: a.code,
      name: a.name,
      debit: a.total_debit,
      credit: a.total_credit,
      balance: a.balance,
    }));

    const buffer = await generateTrialBalance({
      company: companyData,
      reportNumber: `TB-${Date.now().toString().slice(-6)}`,
      dateFrom: date_from || null,
      dateTo: date_to || new Date().toISOString().slice(0, 10),
      reportDate: formatDate(new Date()),
      items,
      summary: {
        total_debit: data.totals.debit,
        total_credit: data.totals.credit,
      },
      currencyCode: company.currency_code || 'YER',
    });

    sendPdf(res, buffer, `trial-balance-${date_to || 'all'}`);
  } finally {
    client.release();
  }
});

/* ============================================================
 * 9) أمر بيع
 * ============================================================ */
const salesOrder = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const order = await SalesOrderModel.findById(companyId, id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'أمر البيع غير موجود',
      });
    }

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // تنسيق التواريخ قبل إرسالها إلى دالة PDF
    const formattedOrder = {
      ...order,
      order_date: formatDate(order.order_date),
      created_at: formatDate(order.created_at),
    };

    const buffer = await generateSalesOrder({
      company: companyData,
      order: formattedOrder,
    });

    sendPdf(res, buffer, `sales-order-${order.order_number}`);

  } catch (err) {
    console.error('[pdf:sales-order] ERROR:', err);
    console.error('[pdf:sales-order] STACK:', err.stack);
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// 10) إشعار دائن / مدين
// ═══════════════════════════════════════════════════════════════

const creditNote = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const note = await NoteModel.getById(client, companyId, id);
    if (!note) throw new ApiError(404, 'Note not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

     const formattedNote = {
      ...note,
      note_date: formatDate(note.note_date),
      created_at: formatDate(note.created_at),
    };
    const currencyCode = note.currency_code || company.currency_code || 'YER';

    const amountInWords = `${numToArabicWords(note.total)} ${
      currencyCode === 'YER' ? 'ريال يمني' : currencyCode
    } فقط لا غير`;

    const isCredit = note.note_type === 'credit';
    const generator = isCredit ? generateCreditNote : generateDebitNote;

    const buffer = await generator({
      company: companyData,
      note:formattedNote,
      currencyCode,
      amountInWords,
    });

    sendPdf(res, buffer, `${isCredit ? 'credit-note' : 'debit-note'}-${note.note_number}`);
  } catch (err) {
    console.error('[pdf:creditNote] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// 11) إذن استلام
// ═══════════════════════════════════════════════════════════════

const goodsReceipt = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const gr = await GoodsReceiptService.getById(client, companyId, id);
    if (!gr) throw new ApiError(404, 'Goods receipt not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const currencyCode = gr.currency_code || company.currency_code || 'YER';

    const amountInWords = `${numToArabicWords(gr.total)} ${
      currencyCode === 'YER' ? 'ريال يمني' : currencyCode
    } فقط لا غير`;

    // تنسيق التواريخ قبل إرسالها
    const formattedReceipt = {
      ...gr,
      receipt_date: gr.receipt_date ? formatDate(gr.receipt_date) : '',
      created_at: gr.created_at ? formatDate(gr.created_at) : '',
    };

    const buffer = await generateGoodsReceipt({
      company: companyData,
      receipt: formattedReceipt,
      currencyCode,
      amountInWords,
    });

    sendPdf(res, buffer, `goods-receipt-${gr.receipt_number}`);
  } catch (err) {
    console.error('[pdf:goodsReceipt] ERROR:', err);
    console.error('[pdf:goodsReceipt] STACK:', err.stack);
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// 12) إذن تحويل
// ═══════════════════════════════════════════════════════════════

const stockTransfer = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const transfer = await StockTransferService.getById(companyId, id, client);
    if (!transfer) throw new ApiError(404, 'Stock transfer not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // تنسيق التواريخ قبل إرسالها
    const formattedTransfer = {
      ...transfer,
      transfer_date: transfer.transfer_date
        ? formatDate(transfer.transfer_date)
        : '',
      created_at: transfer.created_at
        ? formatDate(transfer.created_at)
        : '',
    };

    const buffer = await generateStockTransfer({
      company: companyData,
      transfer: formattedTransfer,
    });

    sendPdf(res, buffer, `stock-transfer-${transfer.transfer_number}`);
  } catch (err) {
    console.error('[pdf:stockTransfer] ERROR:', err);
    console.error('[pdf:stockTransfer] STACK:', err.stack);
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// 13) تسوية جرد
// ═══════════════════════════════════════════════════════════════

const stockAdjustment = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const adjustment = await StockAdjustmentService.getById(client, companyId, id);
    if (!adjustment) throw new ApiError(404, 'Stock adjustment not found');

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // تنسيق التواريخ قبل إرسالها
    const formattedAdjustment = {
      ...adjustment,
      adjustment_date: adjustment.adjustment_date
        ? formatDate(adjustment.adjustment_date)
        : '',
      created_at: adjustment.created_at
        ? formatDate(adjustment.created_at)
        : '',
    };

    const buffer = await generateStockAdjustment({
      company: companyData,
      adjustment: formattedAdjustment,
    });

    sendPdf(res, buffer, `stock-adjustment-${adjustment.adjustment_number}`);
  } catch (err) {
    console.error('[pdf:stockAdjustment] ERROR:', err);
    console.error('[pdf:stockAdjustment] STACK:', err.stack);
    throw err;
  } finally {
    client.release();
  }
});
// ═══════════════════════════════════════════════════════════════
// 🆕 14) تقرير HR (PDF)
// ═══════════════════════════════════════════════════════════════
/**
 * POST /pdf/hr/report
 * Body: { title, titleEn, subtitle, headers, rows, summary, notes, currencyCode, landscape, columnTypes, showSignature }
 */
const hrReport = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const companyId = req.user.company_id;

    const {
      title,
      titleEn,
      subtitle,
      headers,
      rows,
      summary,
      notes,
      currencyCode,
      landscape,
      columnTypes,
      showSignature,
      signatureLeft,
      signatureRight,
      filename,
    } = req.body;

    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      throw new ApiError(400, 'headers and rows are required arrays');
    }

    // 1) جلب الشركة
    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // 2) توليد PDF (Buffer)
    const buffer = await generateHrReport({
      company: companyData,
      title: title || 'تقرير',
      titleEn: titleEn || 'HR Report',
      subtitle,
      headers,
      rows,
      summary: summary || [],
      notes,
      currencyCode: currencyCode || 'YER',
      landscape: landscape !== false,
      columnTypes: columnTypes || {},
      showSignature: showSignature === true,
      signatureLeft,
      signatureRight,
    });

    // 3) إرسال الملف
    const safeFilename = String(filename || `hr-report-${Date.now()}`)
      .replace(/[^\w\-_\u0600-\u06FF]/g, '_')
      .slice(0, 100);

    sendPdf(res, buffer, safeFilename);
  } catch (err) {
    console.error('[pdf:hrReport] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});


// ═══════════════════════════════════════════════════════════════
// 🆕 15) قسيمة راتب موظف (payslip)
// ═══════════════════════════════════════════════════════════════
/**
 * GET /pdf/payslips/:itemId
 * - يجلب بند المسير + بيانات الموظف + الشركة.
 * - يولّد قسيمة راتب PDF.
 */
const payslip = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { itemId } = req.params;
    const companyId = req.user.company_id;

    // 1) جلب بند المسير + الموظف + المسير
    const { rows } = await client.query(
      `SELECT pi.*,
              e.employee_number, e.full_name, e.iban, e.bank_name,
              d.name AS department_name,
              j.name AS job_title_name,
              pr.run_number, pr.period_year, pr.period_month, pr.payment_date, pr.status
         FROM payroll_items pi
         JOIN employees e ON e.id = pi.employee_id
         JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN job_titles  j ON j.id = e.job_title_id
        WHERE pi.id = $1
          AND pi.company_id = $2`,
      [itemId, companyId]
    );
    const row = rows[0];
    if (!row) throw new ApiError(404, 'Payslip not found');

    // 2) جلب الشركة
    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const currencyCode = company.currency_code || 'YER';

    // 3) بناء earnings/deductions
    const earnings = [];
    if (Number(row.basic_salary) > 0) earnings.push({ label: 'الراتب الأساسي', value: Number(row.basic_salary) });
    if (Number(row.housing_allowance) > 0) earnings.push({ label: 'بدل السكن', value: Number(row.housing_allowance) });
    if (Number(row.transport_allowance) > 0) earnings.push({ label: 'بدل النقل', value: Number(row.transport_allowance) });
    if (Number(row.other_allowances) > 0) earnings.push({ label: 'بدلات أخرى', value: Number(row.other_allowances) });
    if (Number(row.overtime_amount) > 0) earnings.push({ label: 'العمل الإضافي', value: Number(row.overtime_amount) });
    if (Number(row.bonus_amount) > 0) earnings.push({ label: 'مكافآت', value: Number(row.bonus_amount) });

    const deductions = [];
    if (Number(row.absence_deduction) > 0) deductions.push({ label: 'خصم الغياب', value: Number(row.absence_deduction) });
    if (Number(row.tax_deduction) > 0) deductions.push({ label: 'ضريبة الدخل', value: Number(row.tax_deduction) });
    if (Number(row.social_insurance) > 0) deductions.push({ label: 'التأمينات الاجتماعية', value: Number(row.social_insurance) });
    if (Number(row.loan_deduction) > 0) deductions.push({ label: 'خصم السلف', value: Number(row.loan_deduction) });
    if (Number(row.other_deductions) > 0) deductions.push({ label: 'خصومات أخرى', value: Number(row.other_deductions) });

    // 4) المبلغ بالحروف
    const amountInWords = `${numToArabicWords(row.net_salary)} ${
      currencyCode === 'YER' ? 'ريال يمني' : currencyCode
    } فقط لا غير`;

    // 5) توليد PDF
    const buffer = await generatePayslip({
      company: companyData,
      currencyCode,
      payslip: {
        run_number: row.run_number,
        period_year: row.period_year,
        period_month: row.period_month,
        payment_date: row.payment_date ? formatDate(row.payment_date) : '—',
        amountInWords,
        employee: {
          employee_number: row.employee_number,
          full_name: row.full_name,
          department_name: row.department_name,
          job_title_name: row.job_title_name,
          bank_name: row.bank_name,
          iban: row.iban,
        },
        earnings,
        deductions,
        gross_salary: Number(row.gross_salary),
        total_deductions: Number(row.total_deductions),
        net_salary: Number(row.net_salary),
      },
    });

    sendPdf(res, buffer, `payslip-${row.employee_number}-${row.period_year}-${row.period_month}`);
  } catch (err) {
    console.error('[pdf:payslip] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// 🆕 16) تقرير مسير رواتب كامل
// ═══════════════════════════════════════════════════════════════
/**
 * GET /pdf/payroll/:runId?includeDetails=true
 */
const payrollReport = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { runId } = req.params;
    const companyId = req.user.company_id;
    const includeDetails = req.query.includeDetails === 'true';

    // 1) جلب المسير
    const { rows: runRows } = await client.query(
      `SELECT * FROM payroll_runs WHERE id = $1 AND company_id = $2`,
      [runId, companyId]
    );
    const run = runRows[0];
    if (!run) throw new ApiError(404, 'Payroll run not found');

    // 2) جلب البنود + الموظفين
    const { rows: items } = await client.query(
      `SELECT pi.*, e.employee_number, e.full_name
         FROM payroll_items pi
         JOIN employees e ON e.id = pi.employee_id
        WHERE pi.payroll_run_id = $1
        ORDER BY e.employee_number`,
      [runId]
    );

    // 3) الشركة
    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const currencyCode = company.currency_code || 'YER';

    // 4) توليد PDF
    const buffer = await generatePayrollReport({
      company: companyData,
      currencyCode,
      includeDetails,
      payrollRun: {
        run_number: run.run_number,
        period_year: run.period_year,
        period_month: run.period_month,
        payment_date: run.payment_date ? formatDate(run.payment_date) : '—',
        status: run.status,
        journal_entry_id: run.journal_entry_id,
        total_gross: Number(run.total_gross),
        total_deductions: Number(run.total_deductions),
        total_net: Number(run.total_net),
        items,
      },
    });

    sendPdf(res, buffer, `payroll-${run.run_number}`);
  } catch (err) {
    console.error('[pdf:payrollReport] ERROR:', err);
    throw err;
  } finally {
    client.release();
  }
});


module.exports = {
  invoice,
  returnDoc,
  payment,
  purchaseOrder,
  deliveryNote,
  statement,
  trialBalance,
  expense,
  salesOrder,
  // 🆕
  creditNote,
  goodsReceipt,
  stockTransfer,
  stockAdjustment,
  
  hrReport,
  payslip,
  payrollReport,
};
