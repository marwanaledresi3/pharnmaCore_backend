const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * ميزان المراجعة — A4.
 */
async function generateTrialBalance(opts = {}) {
  const {
    company = {},
    reportNumber,
    dateFrom,
    dateTo,
    reportDate,
    items = [],
    summary = {},
    currencyCode = 'YER',
    notes,
  } = opts;

  const { doc, promise } = createPage({
    size: [651, 851],
    margin: 30,
    bufferPages: true,
    info: {
      Title: `ميزان المراجعة`,
      Author: company.name || 'PharmaCore',
    },
  });

  const { pageWidth, pageHeight, contentWidth, margin } = layout.setupDocument(doc);

  const companyData = {
    nameAr: company.nameAr || company.name || '',
    nameEn: company.nameEn || company.name_en || '',
    addressAr: company.addressAr || company.address || '',
    addressEn: company.addressEn || company.address_en || '',
    phoneAr: company.phoneAr || company.phone || '',
    phoneEn: company.phoneEn || company.phone || '',
    logo_url: company.logo_url,
    _logoBuffer: company._logoBuffer,
  };

  const titleAr = 'ميزان المراجعة';
  const titleEn = 'Trial Balance';
  const rowHeight = 26;

  // رأس الصفحة
  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(doc, companyData, contentWidth);

    return layout.drawDocumentTitle(
      doc,
      titleAr,
      titleEn,
      contentWidth,
      headerY + 10
    );
  }

  let y = drawPageHeader() + 15;

  // صندوق الفترة
  const infoBoxHeight = 55;

  function drawPeriodInfo() {
    doc
      .roundedRect(margin, y, contentWidth, infoBoxHeight, 5)
      .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

    const colWidth = contentWidth / 3 - 15;
    const x1 = margin + 12;
    const x2 = margin + contentWidth / 3 + 5;
    const x3 = margin + (2 * contentWidth) / 3 + 5;

    layout.arabic(doc, `من: ${dateFrom || '—'}`, x1, y + 12, colWidth, {
      fontSize: 9,
    });
    layout.arabic(doc, `إلى: ${dateTo || '—'}`, x2, y + 12, colWidth, {
      fontSize: 9,
    });
    layout.arabic(doc, `تاريخ التقرير: ${reportDate || '—'}`, x3, y + 12, colWidth, {
      fontSize: 9,
    });

    if (reportNumber) {
      layout.arabic(doc, `رقم التقرير: ${reportNumber}`, x1, y + 34, colWidth, {
        fontSize: 8,
        color: layout.COLORS.muted,
      });
    }

    y += infoBoxHeight + 12;
  }

  drawPeriodInfo();

  // أعمدة الجدول
  const columns = [
    { key: 'index', title: '#', width: 30 },
    { key: 'code', title: 'كود الحساب', width: 80 },
    { key: 'name', title: 'اسم الحساب', width: 180, type: 'arabic' },
    { key: 'debit', title: 'مدين', width: 85 },
    { key: 'credit', title: 'دائن', width: 85 },
    { key: 'balance', title: 'الرصيد', width: 85 },
  ];

  const originalTableWidth = columns.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / originalTableWidth;
  const tableColumns = columns.map((c) => ({ ...c, width: c.width * scale }));

  const tableX = margin;
  const tableWidth = contentWidth;

  function drawTableHeader() {
    layout.drawTableHeader(doc, tableColumns, tableX, y, tableWidth, rowHeight);
    y += rowHeight;
  }

  function drawRow(item, index) {
    const balance = Number(item.balance || 0);
    const values = {
      index: index + 1,
      code: item.code || '—',
      name: item.name || '—',
      debit: Number(item.debit || 0) > 0 ? money(item.debit) : '—',
      credit: Number(item.credit || 0) > 0 ? money(item.credit) : '—',
      balance: Math.abs(balance) < 0.01 ? '0' : money(balance),
    };
    layout.drawTableRow(doc, tableColumns, values, tableX, y, rowHeight);
    y += rowHeight;
  }

  drawTableHeader();

  if (items.length === 0) {
    y += 30;
    layout.arabic(doc, 'لا توجد بيانات', margin, y, contentWidth, {
      fontSize: 10,
      color: layout.COLORS.muted,
      align: 'center',
    });
    y += 40;
  } else {
    items.forEach((item, index) => {
      if (y + rowHeight > pageHeight - 110) {
        doc.addPage();
        y = drawPageHeader() + 15;
        drawTableHeader();
      }
      drawRow(item, index);
    });
  }

  // المجاميع
  y += 18;

  if (y + 100 > pageHeight - 90) {
    doc.addPage();
    y = drawPageHeader() + 20;
  }

  const totalDebit =
    summary.total_debit ?? summary.totalDebit ??
    items.reduce((s, x) => s + Number(x.debit || 0), 0);

  const totalCredit =
    summary.total_credit ?? summary.totalCredit ??
    items.reduce((s, x) => s + Number(x.credit || 0), 0);

  const totals = [
    ['إجمالي المدين', totalDebit],
    ['إجمالي الدائن', totalCredit],
  ];

  const summaryWidth = 240;
  const summaryX = margin + contentWidth - summaryWidth;

  totals.forEach(([label, value]) => {
    doc
      .roundedRect(summaryX, y, summaryWidth, 28, 4)
      .fill(layout.COLORS.light);

    layout.arabic(doc, label, summaryX + 8, y + 8, 100, {
      fontSize: 9,
    });

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(layout.COLORS.text)
      .text(`${money(value)} ${currencyCode}`, summaryX + 120, y + 8, {
        width: summaryWidth - 128,
        align: 'right',
      });

    y += 32;
  });

  // ملاحظات
  if (notes) {
    y += 10;
    if (y + 50 > pageHeight - 100) {
      doc.addPage();
      y = drawPageHeader() + 20;
    }
    layout.arabic(doc, `ملاحظات: ${notes}`, margin, y, contentWidth, {
      fontSize: 9,
      color: layout.COLORS.muted,
    });
    y += 24;
  }

  // التوقيعات
  if (y + 90 > pageHeight - 90) {
    doc.addPage();
    y = drawPageHeader() + 20;
  }

  layout.drawSignature(
    doc,
    'توقيع المحاسب',
    'توقيع المدير المالي',
    pageWidth,
    y + 10
  );

  // الإطار والتذييل
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    layout.drawPageFrame(doc, pageWidth, pageHeight);
    layout.drawFooter(
      doc,
      'نظام إدارة المستندات — PharmaCore ERP',
      contentWidth,
      pageHeight - 55
    );
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(layout.COLORS.muted)
      .text(
        `Page ${i - range.start + 1} / ${range.count}`,
        margin,
        pageHeight - 42,
        { width: contentWidth, align: 'center' }
      );
  }

  doc.end();
  return promise;
}

module.exports = { generateTrialBalance };