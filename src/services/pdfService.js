const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../templates');

/**
 * يجمع القالب مع layout الأساسي
 */
async function renderTemplate(templateName, data) {
  const layoutPath = path.join(TEMPLATES_DIR, 'layouts', 'base.hbs');
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);

  const [layoutSrc, templateSrc] = await Promise.all([
    fs.readFile(layoutPath, 'utf-8'),
    fs.readFile(templatePath, 'utf-8'),
  ]);

  // تسجيل partials
  handlebars.registerPartial('layout', layoutSrc);

  // helpers
  handlebars.registerHelper('formatMoney', (value, symbol) => {
    const n = Number(value || 0).toFixed(2);
    return symbol ? `${n} ${symbol}` : n;
  });
handlebars.registerHelper('subtract', (a, b) => Number(a) - Number(b));
  handlebars.registerHelper('formatDate', (d) => {
    if (!d) return '-';
    return new Date(d).toISOString().slice(0, 10);
  });

  handlebars.registerHelper('eq', (a, b) => a === b);

  const template = handlebars.compile(templateSrc);
  return template(data);
}

/**
 * يولّد PDF من HTML
 */
async function htmlToPdf(html, options = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      ...options,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

/**
 * يولّد فاتورة PDF
 */
async function generateInvoice(invoice, company) {
  const html = await renderTemplate('invoice', { invoice, company });
  return htmlToPdf(html);
}

/**
 * يولّد مرتجع PDF
 */
async function generateReturn(ret, company) {
  const html = await renderTemplate('return', { ret, company });
  return htmlToPdf(html);
}

/**
 * يولّد كشف حساب عميل
 */
async function generateStatement(statement, company) {
  const html = await renderTemplate('statement', { statement, company });
  return htmlToPdf(html);
}

/**
 * يولّد تقرير مبيعات
 */
async function generateSalesReport(report, company) {
  const html = await renderTemplate('sales-report', { report, company });
  return htmlToPdf(html);
}

module.exports = {
  generateInvoice,
  generateReturn,
  generateStatement,
  generateSalesReport,
};