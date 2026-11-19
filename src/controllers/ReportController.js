// controllers/ReportController.js
const asyncHandler = require('../utils/asyncHandler');
const Report = require('../models/Report');
const ApiError = require('../errors/ApiError');
const XLSX = require('xlsx');
// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════


const dashboard = asyncHandler(async (req, res, next) => {
  try {
    const data = await Report.dashboard(req.user.company_id, {
      as_of: req.query.as_of_date || null,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('❌ Dashboard Error:', error);
    console.error('Error Message:', error.message);
    console.error('Stack Trace:', error.stack);

    return next(error);
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Financial statements
// ═══════════════════════════════════════════════════════════════════════════

const balanceSheet = asyncHandler(async (req, res) => {
  const data = await Report.balanceSheet(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const incomeStatement = asyncHandler(async (req, res) => {
  const data = await Report.incomeStatement(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const generalLedger = asyncHandler(async (req, res) => {
  const data = await Report.generalLedger(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const trialBalance = asyncHandler(async (req, res) => {
  const data = await Report.trialBalance(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const taxSummary = asyncHandler(async (req, res) => {
  const data = await Report.taxSummary(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// AR / AP
// ═══════════════════════════════════════════════════════════════════════════

const arAging = asyncHandler(async (req, res) => {
  const data = await Report.arAging(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const apAging = asyncHandler(async (req, res) => {
  const data = await Report.apAging(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sales / Purchases
// ═══════════════════════════════════════════════════════════════════════════

const salesReport = asyncHandler(async (req, res) => {
  const data = await Report.salesReport(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const purchasesReport = asyncHandler(async (req, res) => {
  const data = await Report.purchasesReport(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const topProducts = asyncHandler(async (req, res) => {
  const data = await Report.topProducts(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Inventory
// ═══════════════════════════════════════════════════════════════════════════

const inventoryReport = asyncHandler(async (req, res) => {
  const data = await Report.inventoryReport(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Export: HR XLSX
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /reports/hr/export/xlsx
 *
 * Body:
 *   - filename: string
 *   - sheets: Array<{ name: string, headers: string[], rows: any[] }>
 *
 * Headers تُستخدم كـ header row، و rows هي الصفوف (مفاتيحها تطابق headers).
 */
const exportHrXlsx = asyncHandler(async (req, res) => {
  const { filename, sheets } = req.body;

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new ApiError(400, 'sheets must be a non-empty array');
  }

  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const { name, headers, rows } = sheet;

    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      throw new ApiError(400, `sheet "${name}": headers and rows must be arrays`);
    }

    // تحويل الصفوف إلى صفائف
    const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // عرض الأعمدة تلقائياً
    const colWidths = headers.map((h) => ({
      wch: Math.max(
        String(h).length + 2,
        ...rows.slice(0, 50).map((r) => String(r[h] ?? '').length + 2)
      ),
    }));
    ws['!cols'] = colWidths;

    // اسم الورقة — بحد أقصى 31 حرفاً
    const safeName = String(name || 'Sheet1').slice(0, 31);

    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const safeFilename = String(filename || 'report').replace(/[^\w\-_.]/g, '_');

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeFilename}.xlsx"`
  );
  res.send(buffer);
});

// ═══════════════════════════════════════════════════════════════════════════
// Export: HR PDF
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /reports/hr/export/pdf
 *
 * Body:
 *   - filename: string
 *   - title: string
 *   - subtitle: string
 *   - headers: string[]
 *   - rows: any[]
 *   - summary?: Array<{ label: string, value: string, isTotal?: boolean }>
 *
 * يستخدم pdfService الموجود في المشروع.
 */
const exportHrPdf = asyncHandler(async (req, res) => {
  const { filename, title, subtitle, headers, rows, summary } = req.body;

  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    throw new ApiError(400, 'headers and rows are required arrays');
  }

  // // استيراد pdfService الموجود
  // const pdfService = require('../services/pdfService');

  // // بناء المستند
  // const doc = await pdfService.buildHrReport({
  //   company: req.user.company_id, // أو جلب الشركة الكاملة
  //   title: title || 'تقرير',
  //   subtitle: subtitle || '',
  //   headers,
  //   rows,
  //   summary: summary || [],
  // });

  // const safeFilename = String(filename || 'report').replace(/[^\w\-_.]/g, '_');

  // res.setHeader('Content-Type', 'application/pdf');
  // res.setHeader(
  //   'Content-Disposition',
  //   `attachment; filename="${safeFilename}.pdf"`
  // );

  // doc.pipe(res);
});

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  dashboard,
  balanceSheet,
  incomeStatement,
  generalLedger,
  trialBalance,
  taxSummary,
  arAging,
  apAging,
  salesReport,
  purchasesReport,
  topProducts,
  inventoryReport,
   exportHrXlsx,
  exportHrPdf,
};