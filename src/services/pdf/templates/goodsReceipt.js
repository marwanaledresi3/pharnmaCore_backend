// services/pdf/templates/goodsReceipt.js
const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

const money = (value) =>
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const generateGoodsReceipt = async (opts = {}) => {
  const { company = {}, receipt = {}, currencyCode = 'YER', amountInWords } = opts;

  const titleAr = 'إذن استلام';
  const titleEn = 'Goods Receipt Note';

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

  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(doc, companyData, contentWidth);
    return layout.drawDocumentTitle(doc, titleAr, titleEn, contentWidth, headerY + 10);
  }

  let y = drawPageHeader() + 15;

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

  // ═══ Info box ═══
  const infoHeight = 105;

  doc
    .roundedRect(margin, y, contentWidth, infoHeight, 5)
    .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

  const halfWidth = (contentWidth - 30) / 2;

  layout.arabic(
    doc,
    `المورد: ${receipt.supplier_name || '—'}`,
    margin + 12,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `المستودع: ${receipt.warehouse_name || '—'}`,
    margin + 18 + halfWidth,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `التاريخ: ${receipt.receipt_date || '—'}`,
    margin + 12,
    y + 32,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `رقم الإذن: ${receipt.receipt_number || '—'}`,
    margin + 18 + halfWidth,
    y + 32,
    halfWidth,
    { fontSize: 9 }
  );

  const paymentLabel =
    receipt.payment_type === 'cash' ? 'دفع نقدي' : 'دفع آجل';

  layout.arabic(
    doc,
    `طريقة الدفع: ${paymentLabel}`,
    margin + 12,
    y + 52,
    halfWidth,
    { fontSize: 9, color: layout.COLORS.muted }
  );

  if (receipt.purchase_order_number) {
    layout.arabic(
      doc,
      `أمر الشراء: ${receipt.purchase_order_number}`,
      margin + 18 + halfWidth,
      y + 52,
      halfWidth,
      { fontSize: 9, color: layout.COLORS.muted }
    );
  }

  y += infoHeight + 15;

  // ═══ Items table ═══
  const columns = [
    { key: 'index', title: '#', width: 30 },
    { key: 'name', title: 'المنتج', width: 165, type: 'arabic' },
    { key: 'batch', title: 'الدفعة', width: 70 },
    { key: 'quantity', title: 'الكمية', width: 55 },
    { key: 'price', title: 'السعر', width: 75 },
    { key: 'total', title: 'الإجمالي', width: 80 },
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

  for (let i = 0; i < receipt.items.length; i++) {
    if (y + rowHeight > pageHeight - 100) {
      addNewPage();
      drawTableHeader();
    }

    const item = receipt.items[i];
    const values = {
      index: i + 1,
      name: item.product_name || '—',
      batch: item.batch_number || '—',
      quantity: item.quantity ?? 0,
      price: money(item.unit_price),
      total: money(item.line_total),
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
    ['المجموع', receipt.subtotal],
    ['الضريبة', receipt.tax_total],
    ['الإجمالي', receipt.total],
  ];

  const summaryWidth = 210;
  const summaryX = margin + contentWidth - summaryWidth;

  totals.forEach(([label, value], index) => {
    if (value === undefined || value === null) return;

    const isTotal = index === totals.length - 1;

    if (isTotal) {
      doc
        .roundedRect(summaryX, y, summaryWidth, 30, 4)
        .fill(layout.COLORS.primary);
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

  if (receipt.notes) {
    if (y + 50 > pageHeight - 100) {
      addNewPage();
    }
    const height = drawWrappedArabic(
      `ملاحظات: ${receipt.notes}`,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );
    y += height + 15;
  }

  if (y + 85 > pageHeight - 90) {
    addNewPage();
  }

  layout.drawSignature(doc, 'توقيع المستلم', 'توقيع المسؤول', pageWidth, y + 10);

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    layout.drawPageFrame(doc, pageWidth, pageHeight);
    layout.drawFooter(doc, 'نظام إدارة المستندات', contentWidth, pageHeight - 55);
  }

  doc.end();
  return promise;
};

module.exports = { generateGoodsReceipt };