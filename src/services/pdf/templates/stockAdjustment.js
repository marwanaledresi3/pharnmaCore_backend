// services/pdf/templates/stockAdjustment.js
const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

const money = (v) =>
  Number(v || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const generateStockAdjustment = async (opts = {}) => {
  const { company = {}, adjustment = {}, currencyCode = 'YER' } = opts;

  const titleAr = 'تسوية جرد';
  const titleEn = 'Stock Adjustment';

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

  // ═══ Info box ═══
  const infoHeight = 80;
  doc
    .roundedRect(margin, y, contentWidth, infoHeight, 5)
    .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

  const halfWidth = (contentWidth - 30) / 2;

  const reasonLabels = {
    physical_count: 'جرد فعلي',
    damage: 'تالف',
    theft: 'سرقة',
    expiry: 'انتهاء صلاحية',
    error: 'خطأ إدخال',
    other: 'أخرى',
  };

  layout.arabic(
    doc,
    `المستودع: ${adjustment.warehouse_name || '—'}`,
    margin + 12,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `السبب: ${reasonLabels[adjustment.reason] || adjustment.reason || '—'}`,
    margin + 18 + halfWidth,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `التاريخ: ${adjustment.adjustment_date || '—'}`,
    margin + 12,
    y + 40,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `رقم التسوية: ${adjustment.adjustment_number || '—'}`,
    margin + 18 + halfWidth,
    y + 40,
    halfWidth,
    { fontSize: 9 }
  );

  y += infoHeight + 15;

  // ═══ Items table ═══
  const columns = [
    { key: 'index', title: '#', width: 25 },
    { key: 'name', title: 'المنتج', width: 150, type: 'arabic' },
    { key: 'batch', title: 'الدفعة', width: 70 },
    { key: 'system_qty', title: 'دفترية', width: 55 },
    { key: 'actual_qty', title: 'فعلية', width: 55 },
    { key: 'diff', title: 'الفرق', width: 55 },
    { key: 'value', title: 'القيمة', width: 70 },
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

  let totalGain = 0;
  let totalLoss = 0;
  let totalValue = 0;

  for (let i = 0; i < adjustment.items.length; i++) {
    if (y + rowHeight > pageHeight - 100) {
      addNewPage();
      drawTableHeader();
    }

    const item = adjustment.items[i];
    const diff = Number(item.difference) || 0;
    const cost = Number(item.unit_cost) || 0;
    const value = Math.abs(diff) * cost;

    if (diff > 0) totalGain += diff;
    else if (diff < 0) totalLoss += Math.abs(diff);
    totalValue += value;

    const values = {
      index: i + 1,
      name: item.product_name || '—',
      batch: item.batch_number || '—',
      system_qty: item.system_quantity ?? 0,
      actual_qty: item.actual_quantity ?? 0,
      diff: (diff > 0 ? '+' : '') + diff.toFixed(2),
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

  // Gain
  layout.arabic(doc, 'إجمالي الزيادة', summaryX + 8, y + 8, 100, {
    fontSize: 9,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#15803d')
    .text(`+${totalGain.toFixed(2)}`, summaryX + 110, y + 8, {
      width: 92,
      align: 'right',
    });
  y += 32;

  // Loss
  layout.arabic(doc, 'إجمالي النقص', summaryX + 8, y + 8, 100, {
    fontSize: 9,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#b91c1c')
    .text(`-${totalLoss.toFixed(2)}`, summaryX + 110, y + 8, {
      width: 92,
      align: 'right',
    });
  y += 32;

  // Value
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
  if (adjustment.notes) {
    if (y + 50 > pageHeight - 100) {
      addNewPage();
    }
    const height = doc.heightOfString(smartFormat(adjustment.notes), {
      width: contentWidth,
      lineGap: 2,
    });
    layout.arabic(
      doc,
      `ملاحظات: ${adjustment.notes}`,
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

  layout.drawSignature(doc, 'توقيع الجرد', 'توقيع المسؤول', pageWidth, y + 10);

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    layout.drawPageFrame(doc, pageWidth, pageHeight);
    layout.drawFooter(doc, 'نظام إدارة المستندات', contentWidth, pageHeight - 55);
  }

  doc.end();
  return promise;
};

module.exports = { generateStockAdjustment };