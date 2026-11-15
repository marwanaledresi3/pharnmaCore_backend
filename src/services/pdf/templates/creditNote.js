// services/pdf/templates/creditNote.js
const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

const money = (value) =>
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const generateCreditNote = async (opts = {}) => {
  const {
    company = {},
    note = {},           // إشعار دائن أو مدين
    currencyCode = 'YER',
    amountInWords,
  } = opts;

  const isCredit = note.note_type === 'credit';
  const titleAr = isCredit ? 'إشعار دائن' : 'إشعار مدين';
  const titleEn = isCredit ? 'Credit Note' : 'Debit Note';

  const { doc, promise } = createPage({
    size: [651, 851],
    margin: 30,
    bufferPages: true,
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

  // ═══ Header ═══
  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(doc, companyData, contentWidth);
    return layout.drawDocumentTitle(doc, titleAr, titleEn, contentWidth, headerY + 10);
  }

  let y = drawPageHeader() + 15;

  // ═══ Helpers ═══
  function drawWrappedArabic(text, x, currentY, width, options = {}) {
    const fontSize = options.fontSize || 9;
    doc.font('Arabic').fontSize(fontSize);
    const height = doc.heightOfString(smartFormat(String(text ?? '')), {
      width,
      lineGap: 2,
    });
    layout.arabic(doc, text, x, currentY, width, {
      fontSize,
      align: options.align || 'right',
      color: options.color,
    });
    return Math.max(height, 17);
  }

  function addNewPage() {
    doc.addPage();
    y = drawPageHeader() + 15;
  }

  // ═══ Party + Reason info ═══
  const infoHeight = 105;

  doc
    .roundedRect(margin, y, contentWidth, infoHeight, 5)
    .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

  const halfWidth = (contentWidth - 30) / 2;
  const partyLabel = note.party_type === 'customer' ? 'العميل' : 'المورد';
  const partyName = note.customer_name || note.supplier_name || '—';

  const reasonLabels = {
    return: 'مرتجع',
    discount: 'خصم',
    correction: 'تصحيح',
    price_diff: 'فرق سعر',
    shipping: 'شحن',
    other: 'أخرى',
  };

  layout.arabic(
    doc,
    `${partyLabel}: ${partyName}`,
    margin + 12,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `السبب: ${reasonLabels[note.reason] || note.reason || '—'}`,
    margin + 18 + halfWidth,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `التاريخ: ${note.note_date || '—'}`,
    margin + 12,
    y + 32,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `رقم الإشعار: ${note.note_number || '—'}`,
    margin + 18 + halfWidth,
    y + 32,
    halfWidth,
    { fontSize: 9 }
  );

  if (note.invoice_number) {
    layout.arabic(
      doc,
      `فاتورة مرتبطة: ${note.invoice_number}`,
      margin + 12,
      y + 52,
      contentWidth - 24,
      { fontSize: 8, color: layout.COLORS.muted }
    );
  }

  y += infoHeight + 15;

  // ═══ Items table ═══
  const columns = [
    { key: 'index', title: '#', width: 30 },
    { key: 'description', title: 'الوصف', width: 220, type: 'arabic' },
    { key: 'quantity', title: 'الكمية', width: 60 },
    { key: 'unit_price', title: 'السعر', width: 70 },
    { key: 'line_total', title: 'الإجمالي', width: 80 },
  ];

  const originalTableWidth = columns.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / originalTableWidth;
  const tableColumns = columns.map((c) => ({ ...c, width: c.width * scale }));

  const tableX = margin;
  const tableWidth = contentWidth;
  const rowHeight = 30;

  function drawTableHeader() {
    layout.drawTableHeader(doc, tableColumns, tableX, y, tableWidth, rowHeight);
    y += rowHeight;
  }

  drawTableHeader();

  for (let i = 0; i < note.items.length; i++) {
    if (y + rowHeight > pageHeight - 100) {
      addNewPage();
      drawTableHeader();
    }

    const item = note.items[i];
    const values = {
      index: i + 1,
      description: item.description || '—',
      quantity: Number(item.quantity) || 0,
      unit_price: money(item.unit_price),
      line_total: money(item.line_total),
    };

    layout.drawTableRow(doc, tableColumns, values, tableX, y, rowHeight);
    y += rowHeight;
  }

  if (y + 150 > pageHeight - 90) {
    addNewPage();
  }

  y += 18;

  // ═══ Totals ═══
  const totals = [
    ['المجموع', note.subtotal],
    ['الضريبة', note.tax_total],
    ['الإجمالي', note.total],
  ];

  const summaryWidth = 210;
  const summaryX = margin + contentWidth - summaryWidth;

  totals.forEach(([label, value], index) => {
    if (value === undefined || value === null) return;

    const isTotal = index === totals.length - 1;

    if (isTotal) {
      doc
        .roundedRect(summaryX, y, summaryWidth, 30, 4)
        .fill(isCredit ? layout.COLORS.primary : '#8B0000');
    }

    const color = isTotal ? layout.COLORS.white : layout.COLORS.text;

    layout.arabic(doc, label, summaryX + 8, y + 8, 100, { fontSize: 9, color });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(color)
      .text(`${money(value)} ${currencyCode}`, summaryX + 110, y + 8, {
        width: 92,
        align: 'right',
      });

    y += 32;
  });

  // ═══ Amount in words ═══
  if (amountInWords) {
    y += 12;
    const height = drawWrappedArabic(
      `المبلغ كتابةً: ${amountInWords}`,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );
    y += height + 12;
  }

  // ═══ Notes ═══
  if (note.description) {
    if (y + 50 > pageHeight - 100) {
      addNewPage();
    }

    const height = drawWrappedArabic(
      `ملاحظات: ${note.description}`,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );
    y += height + 15;
  }

  // ═══ Signatures ═══
  if (y + 85 > pageHeight - 90) {
    addNewPage();
  }

  layout.drawSignature(doc, 'توقيع المستلم', 'توقيع المسؤول', pageWidth, y + 10);

  // ═══ Frame + Footer لكل الصفحات ═══
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    layout.drawPageFrame(doc, pageWidth, pageHeight);
    layout.drawFooter(doc, 'نظام إدارة المستندات', contentWidth, pageHeight - 55);
  }

  doc.end();
  return promise;
};

module.exports = { generateCreditNote };