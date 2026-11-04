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
 * كشف حساب عميل / مورد — مع فلترة بالفترة.
 */
async function generateStatement(opts = {}) {
  const {
    company = {},
    partyType = 'customer',        // 'customer' | 'supplier'
    partyTitle,                    // "العميل" / "المورد" — يُشتق تلقائياً إن لم يُمرَّر
    party = {},
    docNumber,
    docDate,
    dateFrom,                      // YYYY-MM-DD (اختياري)
    dateTo,                        // YYYY-MM-DD (اختياري)
    openingBalance = 0,
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
      Title: `كشف حساب - ${party.name || ''}`,
      Author: company.name || 'PharmaCore',
    },
  });

  const {
    pageWidth,
    pageHeight,
    contentWidth,
    margin,
  } = layout.setupDocument(doc);

  // توحيد بيانات الشركة
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

  const resolvedPartyTitle =
    partyTitle || (partyType === 'supplier' ? 'المورد' : 'العميل');

  const titleAr =
    partyType === 'supplier' ? 'كشف حساب مورد' : 'كشف حساب عميل';

  const titleEn =
    partyType === 'supplier' ? 'Supplier Statement' : 'Customer Statement';

  const rowHeight = 30;

  // ═══════════════════════════════════════════
  // رأس الصفحة (يتكرر عند addPage)
  // ═══════════════════════════════════════════
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

  // ═══════════════════════════════════════════
  // صندوق بيانات الطرف والفترة
  // ═══════════════════════════════════════════
  const infoBoxHeight = 118;

  function drawPartyInfo() {
    doc
      .roundedRect(margin, y, contentWidth, infoBoxHeight, 5)
      .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

    const colWidth = contentWidth / 2 - 25;
    const leftX = margin + 12;
    const rightX = margin + contentWidth / 2 + 5;

    // الصف 1: رقم الكشف + تاريخ الإصدار
    layout.arabic(
      doc,
      `رقم الكشف: ${docNumber || '—'}`,
      leftX,
      y + 12,
      colWidth,
      { fontSize: 9 }
    );

    layout.arabic(
      doc,
      `تاريخ الإصدار: ${docDate || '—'}`,
      rightX,
      y + 12,
      colWidth,
      { fontSize: 9 }
    );

    // الصف 2: اسم الطرف
    layout.arabic(
      doc,
      `${resolvedPartyTitle}: ${party.name || '—'}`,
      leftX,
      y + 34,
      contentWidth - 24,
      { fontSize: 10 }
    );

    // الصف 3: الفترة
    const periodLabel =
      dateFrom && dateTo
        ? `الفترة: من ${dateFrom} إلى ${dateTo}`
        : dateFrom
        ? `من ${dateFrom}`
        : dateTo
        ? `حتى ${dateTo}`
        : 'الفترة: كل الحركات';

    layout.arabic(doc, periodLabel, leftX, y + 56, contentWidth - 24, {
      fontSize: 9,
      color: layout.COLORS.primary,
    });

    // الصف 4: معلومات الاتصال
    const contactLines = [
      party.phone ? `الهاتف: ${party.phone}` : null,
      party.email ? `البريد: ${party.email}` : null,
    ].filter(Boolean);

    if (contactLines.length) {
      layout.arabic(
        doc,
        contactLines.join('  |  '),
        leftX,
        y + 78,
        contentWidth - 24,
        { fontSize: 8, color: layout.COLORS.muted }
      );
    }

    // الصف 5: الرصيد الافتتاحي (فقط إن وُجد)
    if (Number(openingBalance) !== 0) {
      layout.arabic(
        doc,
        `الرصيد الافتتاحي: ${money(openingBalance)} ${currencyCode}`,
        leftX,
        y + 96,
        contentWidth - 24,
        { fontSize: 9, color: layout.COLORS.primary }
      );
    }

    y += infoBoxHeight + 12;
  }

  drawPartyInfo();

  // ═══════════════════════════════════════════
  // أعمدة الجدول
  // ═══════════════════════════════════════════
  const columns = [
    { key: 'index', title: '#', width: 25 },
    { key: 'date', title: 'التاريخ', width: 65 },
    { key: 'doc_number', title: 'المستند', width: 75 },
    { key: 'description', title: 'البيان', width: 130, type: 'arabic' },
    { key: 'debit', title: 'مدين', width: 65 },
    { key: 'credit', title: 'دائن', width: 65 },
    { key: 'balance', title: 'الرصيد', width: 75 },
  ];

  const originalTableWidth = columns.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / originalTableWidth;

  const tableColumns = columns.map((c) => ({
    ...c,
    width: c.width * scale,
  }));

  const tableX = margin;
  const tableWidth = contentWidth;

  // ═══════════════════════════════════════════
  // رأس الجدول
  // ═══════════════════════════════════════════
  function drawTableHeader() {
    layout.drawTableHeader(
      doc,
      tableColumns,
      tableX,
      y,
      tableWidth,
      rowHeight
    );
    y += rowHeight;
  }

  // ═══════════════════════════════════════════
  // صف واحد
  // ═══════════════════════════════════════════
  function drawRow(item, index) {
    const balance = Number(item.balance || 0);
    const isSettled = Math.abs(balance) < 0.01;

    const values = {
      index: index + 1,
      date: item.date || '—',
      doc_number: item.doc_number || '—',
      description: item.description || '—',
      debit: Number(item.debit || 0) > 0 ? money(item.debit) : '—',
      credit: Number(item.credit || 0) > 0 ? money(item.credit) : '—',
      balance: isSettled ? '0 (مسدد)' : money(balance),
    };

    layout.drawTableRow(doc, tableColumns, values, tableX, y, rowHeight);
    y += rowHeight;
  }

  // ═══════════════════════════════════════════
  // الجدول
  // ═══════════════════════════════════════════
  drawTableHeader();

  if (items.length === 0) {
    y += 30;
    layout.arabic(
      doc,
      'لا توجد حركات في هذه الفترة',
      margin,
      y,
      contentWidth,
      { fontSize: 10, color: layout.COLORS.muted, align: 'center' }
    );
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

  // ═══════════════════════════════════════════
  // المجاميع
  // ═══════════════════════════════════════════
  y += 18;

  if (y + 150 > pageHeight - 90) {
    doc.addPage();
    y = drawPageHeader() + 20;
  }

  const totalDebit =
    summary.totalDebit ??
    summary.total_debit ??
    items.reduce((s, x) => s + Number(x.debit || 0), 0);

  const totalCredit =
    summary.totalCredit ??
    summary.total_credit ??
    items.reduce((s, x) => s + Number(x.credit || 0), 0);

  const closingBalance =
    summary.closingBalance ??
    summary.closing_balance ??
    Number(openingBalance) + totalDebit - totalCredit;

  const totals = [
    ['إجمالي المدين', totalDebit, false],
    ['إجمالي الدائن', totalCredit, false],
    ['الرصيد النهائي', closingBalance, true],
  ];

  const summaryWidth = 240;
  const summaryX = margin + contentWidth - summaryWidth;

  totals.forEach(([label, value, isTotal]) => {
    if (isTotal) {
      doc
        .roundedRect(summaryX, y, summaryWidth, 32, 4)
        .fill(layout.COLORS.primary);
    }

    const color = isTotal ? layout.COLORS.white : layout.COLORS.text;

    layout.arabic(doc, label, summaryX + 8, y + 9, 110, {
      fontSize: isTotal ? 10 : 9,
      color,
    });

    doc
      .font('Helvetica')
      .fontSize(isTotal ? 10 : 9)
      .fillColor(color)
      .text(`${money(value)} ${currencyCode}`, summaryX + 120, y + 9, {
        width: summaryWidth - 128,
        align: 'right',
      });

    y += isTotal ? 34 : 28;
  });

  // ═══════════════════════════════════════════
  // ملاحظات
  // ═══════════════════════════════════════════
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

  // ═══════════════════════════════════════════
  // التوقيعات
  // ═══════════════════════════════════════════
  if (y + 90 > pageHeight - 90) {
    doc.addPage();
    y = drawPageHeader() + 20;
  }

  layout.drawSignature(
    doc,
    'توقيع المحاسب',
    `توقيع ${resolvedPartyTitle}`,
    pageWidth,
    y + 10
  );

  // ═══════════════════════════════════════════
  // إطار + تذييل لكل الصفحات
  // ═══════════════════════════════════════════
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

    // رقم الصفحة
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

module.exports = { generateStatement };