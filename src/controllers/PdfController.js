const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const Return = require('../models/Return');
const Company = require('../models/Company');
const Report = require('../models/Report');
const pdfService = require('../services/pdfService');
const {pool} = require('../config/pool');

const invoicePdf = asyncHandler(async (req, res) => {
  const inv = await Invoice.findById(req.user.company_id, req.params.id);
  if (!inv) throw new ApiError(404, 'Invoice not found');

  // جلب بيانات إضافية (عنوان العميل/المورد)
  const extra = await pool.query(
    `SELECT COALESCE(c.phone, s.phone) AS party_phone,
            COALESCE(c.email, s.email) AS party_email,
            COALESCE(c.address, s.address) AS party_address,
            COALESCE(c.tax_number, s.tax_number) AS party_tax_number
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.id = $1`,
    [inv.id]
  );
  Object.assign(inv, {
    customer_phone: extra.rows[0]?.party_phone,
    customer_email: extra.rows[0]?.party_email,
    customer_address: extra.rows[0]?.party_address,
    customer_tax_number: extra.rows[0]?.party_tax_number,
  });

  const company = await Company.findById(req.user.company_id);
  const pdf = await pdfService.generateInvoice(inv, company);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${inv.invoice_number}.pdf"`);
  res.send(pdf);
});

const returnPdf = asyncHandler(async (req, res) => {
  const ret = await Return.findById(req.user.company_id, req.params.id);
  if (!ret) throw new ApiError(404, 'Return not found');

  const company = await Company.findById(req.user.company_id);
  const pdf = await pdfService.generateReturn(ret, company);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="return-${ret.return_number}.pdf"`);
  res.send(pdf);
});

const statementPdf = asyncHandler(async (req, res) => {
  const { customerId } = req.params;

  const customer = await pool.query(
    `SELECT * FROM customers WHERE id = $1 AND company_id = $2`,
    [customerId, req.user.company_id]
  );
  if (!customer.rowCount) throw new ApiError(404, 'Customer not found');

  // جلب الفواتير والمرتجعات والدفعات
  const invoices = await pool.query(
    `SELECT invoice_number, invoice_date, total, paid_amount, status
     FROM invoices
     WHERE company_id = $1 AND customer_id = $2
     ORDER BY invoice_date DESC`,
    [req.user.company_id, customerId]
  );

  const balance = await pool.query(
    `SELECT COALESCE(SUM(total - paid_amount), 0)::numeric AS outstanding
     FROM invoices
     WHERE company_id = $1 AND customer_id = $2 AND status IN ('unpaid', 'partial')`,
    [req.user.company_id, customerId]
  );

  const statement = {
    customer: customer.rows[0],
    invoices: invoices.rows,
    outstanding: Number(balance.rows[0].outstanding),
    as_of: new Date().toISOString().slice(0, 10),
  };

  const company = await Company.findById(req.user.company_id);
  const pdf = await pdfService.generateStatement(statement, company);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="statement-${customerId}.pdf"`);
  res.send(pdf);
});

const salesReportPdf = asyncHandler(async (req, res) => {
  const report = await Report.salesReport(req.user.company_id, req.query);
  const company = await Company.findById(req.user.company_id);
  const pdf = await pdfService.generateSalesReport(report, company);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="sales-report.pdf"');
  res.send(pdf);
});

module.exports = { invoicePdf, returnPdf, statementPdf, salesReportPdf };