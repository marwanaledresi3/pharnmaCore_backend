// services/pdf/templates/payrollReport.js
//
// تقرير مسير رواتب كامل — A4 landscape.
// يشمل: ترويسة، بيانات المسير، جدول الموظفين، الملخص، التوقيعات.

const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function drawWrappedArabic(doc, text, x, currentY, width, options = {}) {
  const fontSize = options.fontSize || 9;

  doc.font('Arabic').fontSize(fontSize);

  const height = doc.heightOfString(smartFormat(String(text ?? '')), {
    width, lineGap: 2,
  });

  layout.arabic(doc, text, x, currentY, width, {
    fontSize,
    align: options.align || 'right',
    color: options.color,
  });

  return Math.max(height, 17);
}

/**
 * @param {object} opts
 *   - company
 *   - payrollRun: {
 *       run_number, period_year, period_month, payment_date,
 *       status, total_gross, total_deductions, total_net,
 *       journal_entry_id,
 *       items: [
 *         {
 *           employee_number, full_name,
 *           basic_salary, housing_allowance, transport_allowance, other_allowances,
 *           overtime_amount, bonus_amount, gross_salary,
 *           absence_deduction, tax_deduction, social_insurance, loan_deduction, other_deductions,
 *           total_deductions, net_salary
 *         }
 *       ]
 *     }
 *   - currencyCode
 *   - includeDetails (bool) — إظهار تفصيل البدلات/الخصومات
 */
const generatePayrollReport = async (opts = {}) => {
  const {
    company = {},
    payrollRun = {},
    currencyCode = 'YER',
    includeDetails = false,
  } = opts;

  const { doc, promise } = createPage({
    size: [851, 651], // A4 landscape
    margin: 30,
    bufferPages: true,
    info: {
      Title: `Payroll Report ${payrollRun.run_number || ''}`,
      Author: company.nameAr || company.name || 'Onix ERP',
    },
  });

  const { pageWidth, pageHeight, contentWidth, margin } = layout.setupDocument(doc);

  const companyData = {
    nameAr:    company.nameAr    || company.name    || '',
    nameEn:    company.nameEn    || company.name_en || '',
    addressAr: company.addressAr || company.address || '',
    addressEn: company.addressEn || company.address_en || '',
    phoneAr:   company.phoneAr   || company.phone   || '',
    phoneEn:   company.phoneEn   || company.phone   || '',
    logo_url:  company.logo_url,
    _logoBuffer: company._logoBuffer,
  };

  // ═══════════════════════════════════════════════════════════
  // رأس الصفحة (قابل لإعادة الرسم)
  // ═══════════════════════════════════════════════════════════
  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(doc, companyData, contentWidth);
    const titleY = layout.drawDocumentTitle(
      doc,
      'تقرير مسير رواتب',
      'Payroll Report',
      contentWidth,
      headerY + 10
    );

    // Subtitle: الفترة
    layout.arabic(
      doc,
      `الفترة: ${payrollRun.period_month}/${payrollRun.period_year} — رقم المسير: ${payrollRun.run_number || '—'}`,
      margin,
      titleY,
      contentWidth,
      { fontSize: 10, color: layout.COLORS.muted, align: 'center' }
    );

    return titleY + 20;
  }

  let y = drawPageHeader() + 10;

  function addNewPage() {
    doc.addPage();
    y = drawPageHeader() + 10;
  }

  // ═══════════════════════════════════════════════════════════
  // بيانات المسير
  // ═══════════════════════════════════════════════════════════
  const infoHeight = 50;
  doc.roundedRect(margin, y, contentWidth, infoHeight, 4)
     .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

  const infoColW = (contentWidth - 24) / 3;

  layout.arabic(doc, `تاريخ الدفع: ${payrollRun.payment_date || '—'}`, margin + 8, y + 8, infoColW, {
    fontSize: 9,
  });
  layout.arabic(doc, `عدد الموظفين: ${(payrollRun.items || []).length}`, margin + infoColW + 16, y + 8, infoColW, {
    fontSize: 9,
  });
  layout.arabic(doc, `الحالة: ${payrollRun.status === 'paid' ? 'مدفوع' : payrollRun.status === 'draft' ? 'مسودة' : payrollRun.status}`, margin + (infoColW * 2) + 24, y + 8, infoColW, {
    fontSize: 9,
  });

  if (payrollRun.journal_entry_id) {
    layout.arabic(doc, `القيد المحاسبي: ${String(payrollRun.journal_entry_id).slice(0, 8)}`, margin + 8, y + 28, infoColW * 2, {
      fontSize: 8,
      color: layout.COLORS.muted,
    });
  }

  y += infoHeight + 12;

  // ═══════════════════════════════════════════════════════════
  // الأعمدة
  // ═══════════════════════════════════════════════════════════
  let columns;

  if (includeDetails) {
    columns = [
      { key: 'num',           title: '#',              width: 25 },
      { key: 'employee_number', title: 'الرقم',        width: 45, type: 'text' },
      { key: 'full_name',     title: 'الاسم',          width: 120, type: 'arabic' },
      { key: 'basic_salary',  title: 'الأساسي',        width: 60, type: 'money' },
      { key: 'allowances',    title: 'البدلات',        width: 55, type: 'money' },
      { key: 'overtime',      title: 'إضافي',          width: 45, type: 'money' },
      { key: 'bonus',         title: 'مكافآت',         width: 50, type: 'money' },
      { key: 'gross_salary',  title: 'الإجمالي',       width: 65, type: 'money' },
      { key: 'social',        title: 'تأمينات',        width: 55, type: 'money' },
      { key: 'tax',           title: 'ضريبة',          width: 50, type: 'money' },
      { key: 'other_ded',     title: 'خصومات أخرى',    width: 60, type: 'money' },
      { key: 'total_deductions', title: 'إجمالي خصم',  width: 65, type: 'money' },
      { key: 'net_salary',    title: 'الصافي',         width: 70, type: 'money' },
    ];
  } else {
    columns = [
      { key: 'num',           title: '#',              width: 30 },
      { key: 'employee_number', title: 'الرقم',        width: 60, type: 'text' },
      { key: 'full_name',     title: 'الاسم',          width: 200, type: 'arabic' },
      { key: 'gross_salary',  title: 'الإجمالي',       width: 100, type: 'money' },
      { key: 'total_deductions', title: 'الخصومات',    width: 100, type: 'money' },
      { key: 'net_salary',    title: 'الصافي',         width: 120, type: 'money' },
    ];
  }

  // ضبط العرض
  const totalColsWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const scale = contentWidth / totalColsWidth;
  columns.forEach((c) => { c.width = c.width * scale; });

  const tableX = margin;
  const tableWidth = contentWidth;
  const rowH = 22;

  // ═══════════════════════════════════════════════════════════
  // رأس الجدول
  // ═══════════════════════════════════════════════════════════
  function drawTableHeader() {
    layout.drawTableHeader(doc, columns, tableX, y, tableWidth, rowH);
    y += rowH;
  }

  // ═══════════════════════════════════════════════════════════
  // الصفوف
  // ═══════════════════════════════════════════════════════════
  const items = payrollRun.items || [];

  if (items.length > 0) {
    drawTableHeader();

    items.forEach((item, index) => {
      if (y + rowH > pageHeight - 120) {
        addNewPage();
        drawTableHeader();
      }

      const values = {
        num: index + 1,
        employee_number: item.employee_number || '—',
        full_name: item.full_name || '—',
        basic_salary: money(item.basic_salary),
        allowances: money(
          Number(item.housing_allowance || 0) +
          Number(item.transport_allowance || 0) +
          Number(item.other_allowances || 0)
        ),
        overtime: money(item.overtime_amount),
        bonus: money(item.bonus_amount),
        gross_salary: money(item.gross_salary),
        social: money(item.social_insurance),
        tax: money(item.tax_deduction),
        other_ded: money(
          Number(item.absence_deduction || 0) +
          Number(item.loan_deduction || 0) +
          Number(item.other_deductions || 0)
        ),
        total_deductions: money(item.total_deductions),
        net_salary: money(item.net_salary),
      };

      layout.drawTableRow(doc, columns, values, tableX, y, rowH);
      y += rowH;
    });
  } else {
    layout.arabic(doc, 'لا توجد بنود في هذا المسير', margin, y + 20, contentWidth, {
      fontSize: 11, color: layout.COLORS.muted, align: 'center',
    });
    y += 60;
  }

  // ═══════════════════════════════════════════════════════════
  // الملخص
  // ═══════════════════════════════════════════════════════════
  if (y + 110 > pageHeight - 100) addNewPage();

  y += 15;

  layout.arabic(doc, 'ملخص المسير', margin, y, contentWidth, {
    fontSize: 11, color: layout.COLORS.primary, align: 'right',
  });
  y += 22;

  doc.moveTo(margin, y - 5).lineTo(margin + contentWidth, y - 5)
     .lineWidth(1.5).strokeColor(layout.COLORS.primary).stroke();

  const summaryW = 300;
  const summaryX = margin + contentWidth - summaryW;

  const summaryItems = [
    { label: 'إجمالي الإيرادات', value: money(payrollRun.total_gross) },
    { label: 'إجمالي الخصومات', value: money(payrollRun.total_deductions) },
    { label: 'صافي الرواتب', value: `${money(payrollRun.total_net)} ${currencyCode}`, isTotal: true },
  ];

  for (const item of summaryItems) {
    if (item.isTotal) {
      doc.roundedRect(summaryX, y - 3, summaryW, 28, 4).fill(layout.COLORS.primary);
    }

    const color = item.isTotal ? layout.COLORS.white : layout.COLORS.text;

    layout.arabic(doc, item.label, summaryX + 8, y + 5, summaryW - 120, {
      fontSize: 10, color, align: 'right',
    });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(color)
       .text(String(item.value), summaryX + summaryW - 120, y + 5, { width: 112, align: 'left' });

    y += 30;
  }

  // ═══════════════════════════════════════════════════════════
  // التوقيعات
  // ═══════════════════════════════════════════════════════════
  if (y + 85 > pageHeight - 90) addNewPage();

  layout.drawSignature(
    doc,
    'إعداد المحاسب',
    'اعتماد المدير',
    pageWidth,
    y + 20
  );

  // ═══════════════════════════════════════════════════════════
  // إطار وتذييل
  // ═══════════════════════════════════════════════════════════
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    layout.drawPageFrame(doc, pageWidth, pageHeight);

    const footerText = `مسير رواتب ${payrollRun.run_number || ''} — ${payrollRun.period_month}/${payrollRun.period_year}`;
    layout.drawFooter(doc, footerText, contentWidth, pageHeight - 55);

    doc.font('Helvetica').fontSize(8).fillColor(layout.COLORS.muted)
       .text(
         `Page ${i - range.start + 1} of ${range.count}`,
         margin, pageHeight - 40,
         { width: contentWidth, align: 'center' }
       );
  }

  // ⚠️ Buffer
  doc.end();
  return promise;
};

module.exports = { generatePayrollReport };