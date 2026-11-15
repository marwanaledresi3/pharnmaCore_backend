// services/pdf/templates/stockTransfer.js
const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

const money = (v) =>
  Number(v || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const generateStockTransfer = async (opts = {}) => {
  const { company = {}, transfer = {}, currencyCode = 'YER' } = opts;

  const titleAr = 'إذن تحويل مخزون';
  const titleEn = 'Stock Transfer';

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

  function addNewPage() {
    doc.addPage();
    y = drawPageHeader() + 15;
  }

  // ═══ Info: من → إلى ═══
  const infoHeight = 80;
  doc
    .roundedRect(margin, y, contentWidth, infoHeight, 5)
    .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

  const halfWidth = (contentWidth - 40) / 2;

  layout.arabic(
    doc,
    `من مستودع: ${transfer.from_warehouse_name || '—'}`,
    margin + 12,
    y + 12,
    halfWidth,
    { fontSize: 10, color: layout.COLORS.primary }
  );

  layout.arabic(
    doc,
    `إلى مستودع: ${transfer.to_warehouse_name || '—'}`,
    margin + 20 + halfWidth,
    y + 12,
    halfWidth,
    { fontSize: 10, color: layout.COLORS.primary }
  );

  layout.arabic(
    doc,
    `التاريخ: ${transfer.transfer_date || '—'}`,
    margin + 12,
    y + 40,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `رقم التحويل: ${transfer.transfer_number || '—'}`,
    margin + 20 + halfWidth,
    y + 40,
    halfWidth,
    { fontSize: 9 }
  );

  y += infoHeight + 15;

  // ═══ Items table ═══
  const columns = [
    { key: 'index', title: '#', width: 30 },
    { key: 'name', title: 'المنتج', width: 160, type: 'arabic' },
    { key: 'batch_from', title: 'الدفعة (من)', width: 95 },
    { key: 'batch_to', title: 'الدفعة (إلى)', width: 95 },
    { key: 'quantity', title: 'الكمية', width: 55 },
    { key: 'value', title: 'القيمة', width: 80 },
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

  let totalQty = 0;
  let totalValue = 0;

  for (let i = 0; i < transfer.items.length; i++) {
    if (y + rowHeight > pageHeight - 100) {
      addNewPage();
      drawTableHeader();
    }

    const item = transfer.items[i];
    const qty = Number(item.quantity) || 0;
    const cost = Number(item.unit_cost) || 0;
    const value = qty * cost;

    totalQty += qty;
    totalValue += value;

    const values = {
      index: i + 1,
      name: item.product_name || '—',
      batch_from: item.from_batch_number || '—',
      batch_to: item.to_batch_number || '—',
      quantity: qty,
      value: money(value),
    };

    layout.drawTableRow(doc, tableColumns, values, tableX, y, rowHeight);
    y += rowHeight;
  }

  if (y + 150 > pageHeight - 90) {
    addNewPage();
  }

  y += 18;

  // ═══ Totals ═══
  const summaryWidth = 210;
  const summaryX = margin + contentWidth - summaryWidth;

  // Total qty
  layout.arabic(doc, 'إجمالي الكمية', summaryX + 8, y + 8, 100, {
    fontSize: 9,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(layout.COLORS.text)
    .text(String(totalQty), summaryX + 110, y + 8, {
      width: 92,
      align: 'right',
    });
  y += 32;

  // Total value
  doc.roundedRect(summaryX, y, summaryWidth, 30, 4).fill(layout.COLORS.primary);
  layout.arabic(doc, 'القيمة الإجمالية', summaryX + 8, y + 8, 100, {
    fontSize: 9,
    color: layout.COLORS.white,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(layout.COLORS.white)
    .text(`${money(totalValue)} ${currencyCode}`, summaryX + 110, y + 8, {
      width: 92,
      align: 'right',
    });
  y += 32;

  // ═══ Notes ═══
  if (transfer.notes) {
    if (y + 50 > pageHeight - 100) {
      addNewPage();
    }
    const height = doc.heightOfString(smartFormat(transfer.notes), {
      width: contentWidth,
      lineGap: 2,
    });
    layout.arabic(
      doc,
      `ملاحظات: ${transfer.notes}`,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );
    y += Math.max(height, 17) + 15;
  }

  // ═══ Signatures ═══
  if (y + 85 > pageHeight - 90) {
    addNewPage();
  }

  layout.drawSignature(doc, 'توقيع المسلّم', 'توقيع المستلم', pageWidth, y + 10);

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    layout.drawPageFrame(doc, pageWidth, pageHeight);
    layout.drawFooter(doc, 'نظام إدارة المستندات', contentWidth, pageHeight - 55);
  }

  doc.end();
  return promise;
};

module.exports = { generateStockTransfer };