
const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const generatePurchaseOrder = async (opts = {}) => {
  const {
    company,
    orderNumber,
    orderDate,
    supplier = {},
    items = [],
    summary = {},
    amountInWords,
    currencyCode = 'YER',
    extraInfo = [],
    notes,
  } = opts;

  const { doc, promise } = createPage({
    size: [651, 851],
    margin: 30,
    bufferPages: true,
  });

  const {
    pageWidth,
    pageHeight,
    contentWidth,
    margin,
  } = layout.setupDocument(doc);

  const titleAr = 'أمر شراء';
  const titleEn = 'Purchase Order';
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

  // رأس الصفحة
  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(
      doc,
      companyData,
      contentWidth
    );

    return layout.drawDocumentTitle(
      doc,
      titleAr,
      titleEn,
      contentWidth,
      headerY + 10
    );
  }

  let y = drawPageHeader() + 15;

  // رسم نص عربي مع حساب ارتفاعه حتى لا يتجاوز المساحة
  function drawWrappedArabic(text, x, currentY, width, options = {}) {
    const fontSize = options.fontSize || 9;

    doc.font('Arabic').fontSize(fontSize);

    const height = doc.heightOfString(
      smartFormat(String(text ?? '')),
      {
        width,
        lineGap: 2,
      }
    );

    layout.arabic(
      doc,
      text,
      x,
      currentY,
      width,
      {
        fontSize,
        align: options.align || 'right',
        color: options.color,
      }
    );

    return Math.max(height, 17);
  }

  // إضافة صفحة جديدة عند الحاجة
  function addNewPage() {
    doc.addPage();
    y = drawPageHeader() + 15;
  }

  // بيانات أمر الشراء والمورد
  const infoHeight = 105;

  doc.roundedRect(
    margin,
    y,
    contentWidth,
    infoHeight,
    5
  ).fillAndStroke(
    layout.COLORS.light,
    layout.COLORS.border
  );

  const halfWidth = (contentWidth - 30) / 2;

  // التاريخ ورقم الأمر
  layout.arabic(
    doc,
    `التاريخ: ${orderDate || '—'}`,
    margin + 12,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  layout.arabic(
    doc,
    `رقم الأمر: ${orderNumber || '—'}`,
    margin + 18 + halfWidth,
    y + 12,
    halfWidth,
    { fontSize: 9 }
  );

  // اسم المورد
  const supplierName = `المورد: ${supplier.name || '—'}`;

  const supplierNameHeight = drawWrappedArabic(
    supplierName,
    margin + 12,
    y + 40,
    contentWidth - 24,
    { fontSize: 10 }
  );

  y += infoHeight + 15;

  // تفاصيل المورد
  const supplierDetails = [
    ['الهاتف', supplier.phone],
    ['البريد الإلكتروني', supplier.email],
    ['العنوان', supplier.address],
    ['الرقم الضريبي', supplier.tax_number],
  ].filter(([, value]) => value);

  for (const [label, value] of supplierDetails) {
    const text = `${label}: ${value}`;

    const height = drawWrappedArabic(
      text,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );

    y += height + 5;

    if (y > pageHeight - 110) {
      addNewPage();
    }
  }

  y += 10;

  // المعلومات الإضافية
  for (const info of extraInfo) {
    const text = `${info.label || ''}: ${info.value ?? '—'}`;

    const height = drawWrappedArabic(
      text,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );

    y += height + 5;

    if (y > pageHeight - 110) {
      addNewPage();
    }
  }

  y += 10;

  // أعمدة الجدول
  const columns = [
    { key: 'index', title: '#', width: 30 },
    { key: 'name', title: 'الصنف', width: 155, type: 'arabic' },
    { key: 'sku', title: 'الكود', width: 65 },
    { key: 'quantity', title: 'الكمية', width: 55 },
    { key: 'price', title: 'السعر', width: 75 },
    { key: 'tax', title: 'الضريبة', width: 55 },
    { key: 'total', title: 'الإجمالي', width: 80 },
    { key: 'expiry_date', title: 'تاريخ الانتهاء', width: 80 },
  ];

  // ضبط عرض الأعمدة حسب مساحة الصفحة
  const originalTableWidth = columns.reduce(
    (sum, col) => sum + col.width,
    0
  );

  const scale = contentWidth / originalTableWidth;

  const tableColumns = columns.map(col => ({
    ...col,
    width: col.width * scale,
  }));

  const tableX = margin;
  const tableWidth = contentWidth;
  const rowHeight = 30;

  // رأس الجدول
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

  // رسم الجدول
  drawTableHeader();

  items.forEach((item, index) => {
    if (y + rowHeight > pageHeight - 100) {
      addNewPage();
      drawTableHeader();
    }

    const values = {
      index: index + 1,
      name: item.name || '—',
      sku: item.sku || '—',
      quantity: item.quantity ?? 0,
      price: money(item.unit_price),
      tax: item.tax ?? '—',
      total: money(item.total),
      expiry_date: item.expiry_date || '—',
    };

    layout.drawTableRow(
      doc,
      tableColumns,
      values,
      tableX,
      y,
      rowHeight
    );

    y += rowHeight;
  });

  // التأكد من مساحة المجاميع
  if (y + 150 > pageHeight - 90) {
    addNewPage();
  }

  y += 18;

  // المجاميع
  const totals = [
    ['المجموع الفرعي', summary.subtotal],
    ['الضريبة', summary.tax],
    ['الإجمالي', summary.total],
  ];

  const summaryWidth = 210;
  const summaryX = margin + contentWidth - summaryWidth;

  totals.forEach(([label, value], index) => {
    if (value === undefined || value === null) return;

    const isTotal = index === totals.length - 1;

    if (isTotal) {
      doc.roundedRect(
        summaryX,
        y,
        summaryWidth,
        30,
        4
      ).fill(layout.COLORS.primary);
    }

    const color = isTotal
      ? layout.COLORS.white
      : layout.COLORS.text;

    layout.arabic(
      doc,
      label,
      summaryX + 8,
      y + 8,
      100,
      {
        fontSize: 9,
        color,
      }
    );

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(color)
      .text(
        `${money(value)} ${currencyCode}`,
        summaryX + 110,
        y + 8,
        {
          width: 92,
          align: 'right',
        }
      );

    y += 32;
  });

  // المبلغ كتابة
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

  // الملاحظات
  if (notes) {
    if (y + 50 > pageHeight - 100) {
      addNewPage();
    }

    const height = drawWrappedArabic(
      `ملاحظات: ${notes}`,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );

    y += height + 15;
  }

  // التوقيعات
  if (y + 85 > pageHeight - 90) {
    addNewPage();
  }

  layout.drawSignature(
    doc,
    'توقيع المورد',
    'توقيع المسؤول',
    pageWidth,
    y + 10
  );

  // إطار وتذييل جميع الصفحات
  const range = doc.bufferedPageRange();

  for (
    let i = range.start;
    i < range.start + range.count;
    i++
  ) {
    doc.switchToPage(i);

    layout.drawPageFrame(
      doc,
      pageWidth,
      pageHeight
    );

    layout.drawFooter(
      doc,
      'نظام إدارة المستندات',
      contentWidth,
      pageHeight - 55
    );
  }

  doc.end();

  return promise;
};

module.exports = { generatePurchaseOrder };
