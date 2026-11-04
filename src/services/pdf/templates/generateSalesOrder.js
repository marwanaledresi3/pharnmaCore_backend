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
 * أمر بيع — A4، يدعم تعدد الصفحات وتكرار رأس الجدول.
 */
async function generateSalesOrder(opts = {}) {
  const { company = {}, order = {} } = opts;

  const {
    order_number,
    order_date,
    status,
    customer_name,
    currency_code = 'YER',
    subtotal = 0,
    tax_total = 0,
    total = 0,
    items = [],
    notes,
  } = order;

  const { doc, promise } = createPage({
    size: [651, 851],
    margin: 30,
    bufferPages: true,
    info: {
      Title: `أمر بيع - ${order_number || ''}`,
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

  const titleAr = 'أمر بيع';
  const titleEn = 'Sales Order';
  const rowHeight = 30;

  // ═══════════════════════════════════════════
  // رأس الصفحة
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
  // صندوق بيانات الطلب والعميل
  // ═══════════════════════════════════════════
  const infoHeight = 100;

  function drawOrderInfo() {
    doc
      .roundedRect(margin, y, contentWidth, infoHeight, 5)
      .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

    const colWidth = contentWidth / 2 - 25;
    const leftX = margin + 12;
    const rightX = margin + contentWidth / 2 + 5;

    // رقم الأمر + التاريخ
    layout.arabic(doc, `رقم الأمر: ${order_number || '—'}`, leftX, y + 12, colWidth, {
      fontSize: 9,
    });
    layout.arabic(doc, `التاريخ: ${order_date || '—'}`, rightX, y + 12, colWidth, {
      fontSize: 9,
    });

    // اسم العميل
    layout.arabic(
      doc,
      `العميل: ${customer_name || '—'}`,
      leftX,
      y + 34,
      contentWidth - 24,
      { fontSize: 10 }
    );

    // الحالة
    const statusMap = {
      draft: 'مسودة',
      confirmed: 'مؤكد',
      approved: 'معتمد',
      posted: 'مرحّل',
      cancelled: 'ملغي',
    };
    layout.arabic(
      doc,
      `الحالة: ${statusMap[status] || status || '—'}`,
      leftX,
      y + 56,
      colWidth,
      { fontSize: 9, color: layout.COLORS.primary }
    );

    // العملة
    layout.arabic(
      doc,
      `العملة: ${currency_code}`,
      rightX,
      y + 56,
      colWidth,
      { fontSize: 9 }
    );

    y += infoHeight + 12;
  }

  drawOrderInfo();

  // ═══════════════════════════════════════════
  // أعمدة الجدول
  // ═══════════════════════════════════════════
  const columns = [
    { key: 'number', title: '#', width: 25 },
    { key: 'product', title: 'الصنف', width: 135, type: 'arabic' },
    { key: 'sku', title: 'الكود', width: 65 },
    { key: 'quantity', title: 'الكمية', width: 55 },
    { key: 'bonus', title: 'بونص', width: 45 },
    { key: 'price', title: 'السعر', width: 65 },
    { key: 'tax', title: 'الضريبة', width: 65 },
    { key: 'total', title: 'الإجمالي', width: 80 },
  ];

  const originalTableWidth = columns.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / originalTableWidth;
  const tableColumns = columns.map((c) => ({ ...c, width: c.width * scale }));

  const tableX = margin;
  const tableWidth = contentWidth;

  // ═══════════════════════════════════════════
  // رأس الجدول
  // ═══════════════════════════════════════════
  function drawTableHeader() {
    layout.drawTableHeader(doc, tableColumns, tableX, y, tableWidth, rowHeight);
    y += rowHeight;
  }

  // ═══════════════════════════════════════════
  // صف
  // ═══════════════════════════════════════════
  function drawItemRow(item, index) {
    const values = {
      number: String(index + 1),
      product: item.product_name || '—',
      sku: item.sku || '—',
      quantity: Number(item.quantity || 0).toFixed(3),
      bonus: Number(item.bonus_quantity || 0).toFixed(3),
      price: money(item.unit_price),
      tax: money(item.tax_amount),
      total: money(item.line_total),
    };

    layout.drawTableRow(doc, tableColumns, values, tableX, y, rowHeight);
    y += rowHeight;
  }

  // ═══════════════════════════════════════════
  // الجدول
  // ═══════════════════════════════════════════
  drawTableHeader();

  const orderItems = Array.isArray(items) ? items : [];

  orderItems.forEach((item, index) => {
    if (y + rowHeight > pageHeight - 110) {
      doc.addPage();
      y = drawPageHeader() + 15;
      drawTableHeader();
    }
    drawItemRow(item, index);
  });

  // ═══════════════════════════════════════════
  // المجاميع
  // ═══════════════════════════════════════════
  y += 18;

  if (y + 150 > pageHeight - 90) {
    doc.addPage();
    y = drawPageHeader() + 20;
  }

  const totals = [
    ['المجموع الفرعي', subtotal, false],
    ['الضريبة', tax_total, false],
    ['الإجمالي النهائي', total, true],
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
      .text(`${money(value)} ${currency_code}`, summaryX + 120, y + 9, {
        width: summaryWidth - 128,
        align: 'right',
      });

    y += isTotal ? 34 : 28;
  });

  // عدد الأصناف
  layout.arabic(
    doc,
    `عدد الأصناف: ${orderItems.length}`,
    margin,
    y + 5,
    contentWidth,
    { fontSize: 9, color: layout.COLORS.muted }
  );

  // ═══════════════════════════════════════════
  // ملاحظات
  // ═══════════════════════════════════════════
  if (notes) {
    y += 30;
    if (y + 50 > pageHeight - 100) {
      doc.addPage();
      y = drawPageHeader() + 20;
    }
    layout.arabic(doc, `ملاحظات: ${notes}`, margin, y, contentWidth, {
      fontSize: 9,
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
    'توقيع العميل',
    'توقيع المسؤول',
    pageWidth,
    y + 10
  );

  // ═══════════════════════════════════════════
  // الإطار والتذييل لكل الصفحات
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

module.exports = { generateSalesOrder };