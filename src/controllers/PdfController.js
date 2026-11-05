const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { resolveLogoAsync } = require('../services/pdf/helpers/logoResolver');
const { formatDate } = require('../utils/dateUtils');
const { numToArabicWords } = require('../utils/numberToArabicWords');
const { pool } = require('../config/pool');
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
} = require('../services/pdf');
/**
 * يُعيد PDF كـ stream مع headers صحيحة.
 */
function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

const companyPdfData = async (company) => {
  // حمّل الشعار (URL → Buffer) مرة واحدة
  const logoBuffer = await resolveLogoAsync(company.logo_url);

  return {
    name: company.name,
    name_en: company.name_en,
    address: company.address,
    phone: company.phone,
    logo_url: company.logo_url,
    _logoBuffer: logoBuffer,       // ← يُستخدمه drawCompanyLogo
  };
};


/**
 * يجلب بيانات الشركة.
 */
async function getCompany(client, companyId) {
  const r = await client.query(
    `SELECT name,  name_en, tax_number, address, phone, email, logo_url
     FROM companies WHERE id = $1`,
    [companyId]
  );
  return r.rows[0] || {};
}

/**
 * يجلب بيانات طرف (عميل أو مورد).
 */
async function getParty(client, companyId, partyType, partyId) {
  const table = partyType === 'customer' ? 'customers' : 'suppliers';
  const r = await client.query(
    `SELECT name, phone, email, address, tax_number
     FROM ${table} WHERE id = $1 AND company_id = $2`,
    [partyId, companyId]
  );
  return r.rows[0] || {};
}

// ═══════════════════════════════════════════
// فاتورة
// ═══════════════════════════════════════════
const invoice = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    // 1) الفاتورة
    const invRes = await client.query(
      `SELECT i.*, cu.code AS currency_code
       FROM invoices i
       JOIN currencies cu ON cu.id = i.currency_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [id, companyId]
    );
    const inv = invRes.rows[0];
    if (!inv) throw new ApiError(404, 'Invoice not found');

    // 2) الشركة
    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // 3) الطرف
    const isSale = inv.invoice_type === 'sales';
    const party = isSale
      ? await getParty(client, companyId, 'customer', inv.customer_id)
      : await getParty(client, companyId, 'supplier', inv.supplier_id);

    // ═══════════════════════════════════════════
    // 4) البنود (بدون paid_quantity — مشتق)
    // ═══════════════════════════════════════════
    const itemsRes = await client.query(
      `SELECT ii.quantity, ii.bonus_quantity,
              ii.unit_price, ii.net_unit_price, ii.tax_rate, ii.tax_amount,
              ii.line_total, ii.batch_number, ii.expiry_date,
              p.name, p.sku
       FROM invoice_items ii
       JOIN products p ON p.id = ii.product_id
       WHERE ii.invoice_id = $1
       ORDER BY ii.id`,
      [id]
    );

    const items = itemsRes.rows.map((it) => {
      const bonus = Number(it.bonus_quantity || 0);
      const qty = Number(it.quantity || 0);        // إجمالي = مدفوع + بونص
      const paid = Math.max(0, qty - bonus);       // مدفوع

      return {
        name: it.name,
        sku: it.sku,
        quantity: qty,
        paid_quantity: paid,
        bonus_quantity: bonus,
        unit_price: it.unit_price,
        tax: it.tax_rate > 0 ? `${it.tax_rate}%` : '—',
        total: it.line_total,
        batch_number: it.batch_number || null,
        expiry_date: formatDate(it.expiry_date)
          ? formatDate(it.expiry_date)
          : null,
      };
    });

    // 5) المجاميع
    const summary = [
      { label: 'المجموع الفرعي', value: Number(inv.subtotal || 0) },
      { label: 'الضريبة', value: Number(inv.tax_total || 0) },
      { label: 'الإجمالي', value: Number(inv.total), isTotal: true },
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
        'تاريخ الاستحقاق': inv.due_date
          ? String(inv.due_date).slice(0, 10)
          : '—',
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

// ═══════════════════════════════════════════
// مرتجع
// ═══════════════════════════════════════════
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
              p.name, p.sku
       FROM return_items ri
       JOIN products p ON p.id = ri.product_id
       WHERE ri.return_id = $1`,
      [id]
    );

    const items = itemsRes.rows.map((it) => ({
      name: it.name,
      sku: it.sku,
      quantity: it.quantity,
      unit_price: it.unit_price,
      tax: it.tax_rate > 0 ? `${it.tax_rate}%` : '—',
      total: it.line_total,
    }));

    const summary = [
      { label: 'المجموع الفرعي', value: Number(ret.subtotal) },
      { label: 'الضريبة', value: Number(ret.tax_total) },
      { label: 'الإجمالي المسترجع', value: Number(ret.total), isTotal: true },
    ];

    const amountInWords = `${numToArabicWords(ret.total)} ${ret.currency_code === 'YER' ? 'ريال يمني' : ret.currency_code} فقط لا غير`;

    const buffer = await generateReturn({
      company: companyData,
      docType: isSale ? 'sale_return' : 'purchase_return',
      docNumber: ret.return_number,
      docDate: formatDate(ret.return_date),
      partyTitle: isSale ? 'العميل' : 'المورد',
      party,
      items,
      summary,
      amountInWords,
      currencyCode: ret.currency_code,
      extraInfo: {
        'الفاتورة الأصلية': ret.original_invoice || '—',
        'سبب الإرجاع': ret.reason || '—',
      },
    });

    sendPdf(res, buffer, `return-${ret.return_number}`);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════
// سند قبض/صرف
// ═══════════════════════════════════════════
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

    const amountInWords = `${numToArabicWords(pay.amount)} ${pay.currency_code === 'YER' ? 'ريال يمني' : pay.currency_code} فقط لا غير`;

    // ✅ استخدم generateVoucher بدل generate
    const buffer = await generateVoucher({
      company: companyData,
      voucherType: isReceive ? 'receipt' : 'payment',
      voucherNumber: pay.voucher_number || `PAY-${id.slice(0, 8)}`,
      voucherDate: formatDate(pay.payment_date),
      amount: pay.amount,
      amountInWords,
      partyName: pay.party_name || '—',
      settlementOf: pay.description || (pay.invoice_number ? `سداد فاتورة #${pay.invoice_number}` : '—'),
      method: pay.method || 'cash',
      chequeNumber: pay.cheque_number || null,
      chequeDate: formatDate(pay.cheque_date) ? formatDate(pay.cheque_date) : null,
      bankName: pay.bank_name || null,
      currencyCode: pay.currency_code || 'YER',
      externalReference: pay.external_reference || null,
    });

    sendPdf(res, buffer, `voucher-${pay.voucher_number || id.slice(0, 8)}`);
  } catch (err) {
    console.error('[pdf:sales-order] ERROR:', err);
    console.error('[pdf:sales-order] STACK:', err.stack);
    throw err;
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════
// أمر شراء
// ═══════════════════════════════════════════
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
              p.name, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1`,
      [id]
    );

    const items = itemsRes.rows.map((it) => ({
      name: it.name,
      sku: it.sku,
      quantity: it.quantity,
      unit_price: it.unit_price,
      tax: it.tax_rate > 0 ? `${it.tax_rate}%` : '—',
      total: it.line_total,
    }));

    const amountInWords = `${numToArabicWords(po.total)} ${po.currency_code === 'YER' ? 'ريال يمني' : po.currency_code} فقط لا غير`;

    const buffer = await generatePurchaseOrder({
      company: companyData,
      docType: 'report',  // سنستخدم نوعاً عاماً
      docNumber: po.order_number,
      docDate: formatDate(po.order_date),
      partyTitle: 'المورد',
      party: {
        name: po.supplier_name,
        phone: po.supplier_phone,
        email: po.supplier_email,
        address: po.supplier_address,
        tax_number: po.supplier_tax_number,
      },
      items,
      summary: [
        { label: 'المجموع الفرعي', value: Number(po.subtotal) },
        { label: 'الضريبة', value: Number(po.tax_total) },
        { label: 'الإجمالي', value: Number(po.total), isTotal: true },
      ],
      amountInWords,
      currencyCode: po.currency_code,
      extraInfo: {
        'الحالة': po.status,
        'نوع الدفع': po.payment_type || '—',
      },
    });

    sendPdf(res, buffer, `po-${po.order_number}`);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════
// بوليصة تسليم
// ═══════════════════════════════════════════
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
      `SELECT poi.quantity, p.name, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1`,
      [id]
    );

    const items = itemsRes.rows.map((it) => ({
      name: it.name,
      sku: it.sku,
      quantity: it.quantity,
      unit_price: 0,
      tax: '—',
      total: 0,
    }));

    // جلب QR إن وجد
    const qrRes = await client.query(
      `SELECT 1 FROM delivery_tokens WHERE order_id = $1 AND used_at IS NULL LIMIT 1`,
      [id]
    );
    const qrData = qrRes.rowCount > 0
      ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/deliveries/confirm?order=${po.id}`
      : null;

    const buffer = await generateDeliveryNote({
      company: companyData,
      docType: 'delivery_note',
      docNumber: po.order_number,
      docDate: formatDate(new Date()),
      partyTitle: 'المورد',
      party: {
        name: po.supplier_name,
        phone: po.supplier_phone,
        address: po.supplier_address,
      },
      items,
      summary: [
        { label: 'عدد البنود', value: items.length, isTotal: false },
      ],
      currencyCode: po.currency_code,
      extraInfo: {
        'تاريخ أمر الشراء': formatDate(po.order_date),
      },
      qrData,
    });

    sendPdf(res, buffer, `delivery-${po.order_number}`);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════
// كشف حساب
// ═══════════════════════════════════════════
/**
 * كشف حساب عميل / مورد — PDF
 * GET /api/v1/pdf/statements/:partyType/:id
 * partyType: 'customer' | 'supplier'
 */
const statement = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    // 1) التعريف أولاً (قبل أي استخدام)
    const { partyType, id } = req.params;
    const companyId = req.user.company_id;
    const { date_from, date_to } = req.query;


    // 2) الطرف (عميل أو مورد)
    const party = await getParty(client, companyId, partyType, id);
    if (!party.name) throw new ApiError(404, 'Party not found');

    // 3) الشركة
    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // ═══════════════════════════════════════════
    // 4) الفواتير (مدفوعة + غير مدفوعة)
    // ═══════════════════════════════════════════
    const invParams = [id, companyId];
    const invConds = [
      partyType === 'customer' ? 'i.customer_id = $1' : 'i.supplier_id = $1',
      'i.company_id = $2',
      `i.status <> 'cancelled'`,
    ];

    if (date_from) {
      invParams.push(date_from);
      invConds.push(`i.invoice_date >= $${invParams.length}`);
    }
    if (date_to) {
      invParams.push(date_to);
      invConds.push(`i.invoice_date <= $${invParams.length}`);
    }

    const invRes = await client.query(
      `SELECT i.id, i.invoice_number,i.status, i.invoice_date, i.total, i.paid_amount,
              i.invoice_type, i.due_date, i.status
       FROM invoices i
       WHERE ${invConds.join(' AND ')}
       ORDER BY i.invoice_date, i.created_at`,
      invParams
    );

    // ═══════════════════════════════════════════
    // 5) سندات القبض / الصرف
    // ═══════════════════════════════════════════
    const payParams = [companyId];
    const payConds = ['p.company_id = $1'];

    if (partyType === 'customer') {
      payParams.push(id);
      payConds.push(`(
        (p.invoice_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM invoices i2
          WHERE i2.id = p.invoice_id AND i2.customer_id = $${payParams.length}
        ))
        OR p.customer_id = $${payParams.length}
      )`);
      payConds.push(`p.payment_type = 'receive'`);
    } else {
      payParams.push(id);
      payConds.push(`(
        (p.invoice_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM invoices i2
          WHERE i2.id = p.invoice_id AND i2.supplier_id = $${payParams.length}
        ))
        OR p.supplier_id = $${payParams.length}
      )`);
      payConds.push(`p.payment_type = 'pay'`);
    }

    if (date_from) {
      payParams.push(date_from);
      payConds.push(`p.payment_date >= $${payParams.length}`);
    }
    if (date_to) {
      payParams.push(date_to);
      payConds.push(`p.payment_date <= $${payParams.length}`);
    }

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

    // ═══════════════════════════════════════════
    // 6) بناء الحركات — تنسيق محاسبي
    // ═══════════════════════════════════════════
    const transactions = [];

    // ─── الفواتير ───
    for (const inv of invRes.rows) {
      const total = Number(inv.total);
      const isSale = inv.invoice_type === 'sales';
      const isPaid = inv.status === 'paid';

      if (partyType === 'customer' && isSale) {
        // فاتورة مبيعات على العميل — مدين
        transactions.push({
          date: formatDate(inv.invoice_date) ? formatDate(inv.invoice_date) : '—',
          doc_number: inv.invoice_number,
          description: 'عليكم فاتورة مبيعات',
          debit: total,
          credit: 0,
          balance: 0,
        });
      } else if (partyType === 'supplier' && !isSale && !isPaid) {
        // فاتورة مشتريات علينا للمورد — دائن
        transactions.push({
          date: formatDate(inv.invoice_date) ? formatDate(inv.invoice_date) : '—',
          doc_number: inv.invoice_number,
          description: 'لديكم فاتورة مشتريات',
          debit: 0,
          credit: total,
          balance: 0,
        });
      }
    }

    // ─── سندات القبض / الصرف ───
    for (const p of payRes.rows) {
      const amt = Number(p.amount);

      if (partyType === 'customer') {
        // سند قبض — دائن (يخفض رصيد العميل)
        const desc = ` لكم سند قبض ${p.description?.trim()}`;
        transactions.push({
          date: formatDate(p.payment_date) ? formatDate(p.payment_date) : '—',
          doc_number: p.voucher_number || p.reference || '—',
          description: desc,
          debit: 0,
          credit: amt,
          balance: 0,
        });
      } else {
        // سند صرف — مدين (يخفض ديننا للمورد)
        const desc =`عليكم سند صرف ${p.description?.trim()} `;
        transactions.push({
          date: formatDate(p.payment_date) ? formatDate(p.payment_date) : '—',
          doc_number: p.voucher_number || p.reference || '—',
          description: desc,
          debit: amt,
          credit: 0,
          balance: 0,
        });
      }
    }

    // ═══════════════════════════════════════════
    // 7) ترتيب + الرصيد التراكمي
    // ═══════════════════════════════════════════
    transactions.sort((a, b) => a.date.localeCompare(b.date));

    let bal = 0;
    for (const t of transactions) {
      bal += Number(t.debit) - Number(t.credit);
      t.balance = bal;
    }


    // ═══════════════════════════════════════════
    // 8) توليد PDF
    // ═══════════════════════════════════════════
    const buffer = await generateStatement({
      company: companyData,
      docType: 'statement',
      docNumber: `STMT-${id.slice(0, 8)}`,
      docDate: formatDate(new Date()),
      partyTitle: partyType === 'customer' ? 'العميل' : 'المورد',
      party,
      items: transactions,
      summary: [
        {
          label: 'إجمالي المدين',
          value: transactions.reduce((s, t) => s + Number(t.debit), 0),
        },
        {
          label: 'إجمالي الدائن',
          value: transactions.reduce((s, t) => s + Number(t.credit), 0),
        },
        {
          label: 'الرصيد المستحق',
          value: Math.abs(bal),
          isTotal: true,
        },
      ],
      currencyCode: company.currency_code || 'YER',
      extraInfo: {
        'الفترة': `${date_from || '—'} إلى ${date_to || '—'}`,
      },
    });

    sendPdf(res, buffer, `statement-${partyType}-${id.slice(0, 8)}`);
  } catch (err) {
    console.error('[pdf:statement] ERROR:', err);
    console.error('[pdf:statement] STACK:', err.stack);
    throw err;
  } finally {
    client.release();
  }
});

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
      expenseDate: formatDate(exp.expense_date),
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
    console.error('[pdf:statement] ERROR:', err);
    console.error('[pdf:statement] STACK:', err.stack);
    throw err;
  }finally {
    client.release();
  }
});
// ═══════════════════════════════════════════
// ميزان مراجعة
// ═══════════════════════════════════════════
const trialBalance = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const companyId = req.user.company_id;
    const { date_from, date_to } = req.query;

    const Report = require('../models/Report');
    const data = await Report.trialBalance(companyId, { date_from, date_to });

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    // تمرير بيانات الحسابات مباشرة (بدون تحويل)
    const items = data.accounts.map((a) => ({
      code: a.code,
      name: a.name,
      debit: a.total_debit,
      credit: a.total_credit,
      balance: a.balance,
    }));

    const buffer = await generateTrialBalance({
      company: companyData,
      docType: 'trial_balance',
      docNumber: `TB-${Date.now().toString().slice(-6)}`,
      docDate: (date_to) || new Date().toISOString().slice(0, 10),
      partyTitle: 'الفترة',
      party: { name: `${date_from || '—'} إلى ${date_to || '—'}` },
      items,
      summary: [
        { label: 'إجمالي المدين', value: data.totals.debit },
        { label: 'إجمالي الدائن', value: data.totals.credit },
        { label: 'الحالة', value: data.totals.balanced ? 'متوازن ✅' : `فرق ${data.totals.difference}`, isTotal: true },
      ],
      currencyCode: company.currency_code || 'YER',
    });

    sendPdf(res, buffer, `trial-balance-${date_to || 'all'}`);
  } finally {
    client.release();
  }
});

const SalesOrder = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const order = await SalesOrder.findById(companyId, id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'أمر البيع غير موجود',
      });
    }

    const company = await getCompany(client, companyId);
    const companyData = await companyPdfData(company);

    const buffer = await generateSalesOrder({
      company: companyData,
      order,
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

module.exports = {
  invoice,
  returnDoc,
  payment,
  purchaseOrder,
  deliveryNote,
  statement,
  trialBalance,
  expense,
  SalesOrder,
};