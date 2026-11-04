const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function generateReturn(opts ) {
  const {
    company= {},
    returnType = 'sale_return',
    returnNumber,
    returnDate,
    originalInvoiceNumber,
    originalInvoiceDate,
    partyTitle,
    party = {},
    items = [],
    summary = {},
    amountInWords,
    currencyCode = 'YER',
    reason,
    notes,
    extraInfo = [],
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

  const titleAr =
    returnType === 'purchase_return'
      ? 'مرتجع مشتريات'
      : 'مرتجع مبيعات';

  const titleEn =
    returnType === 'purchase_return'
      ? 'Purchase Return'
      : 'Sales Return';

  const rowHeight = 30;

  // تجهيز رأس الصفحة
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

  // بيانات المرتجع
  function drawReturnInfo() {
    const boxHeight = 100;

    doc.roundedRect(
      margin,
      y,
      contentWidth,
      boxHeight,
      5
    )
      .fillAndStroke(
        layout.COLORS.light,
        layout.COLORS.border
      );

    const leftX = margin + 12;
    const rightX = margin + contentWidth / 2;
    const textWidth = contentWidth / 2 - 25;

    const info = [
      {
        label: 'التاريخ',
        value: returnDate || '-',
        x: leftX,
        y: y + 12,
      },
      {
        label: 'الفاتورة الأصلية',
        value: originalInvoiceNumber || '-',
        x: rightX,
        y: y + 12,
      },
      {
        label: partyTitle || 'الطرف',
        value: party.name || '-',
        x: leftX,
        y: y + 40,
      },
      {
        label: 'تاريخ الفاتورة',
        value: originalInvoiceDate || '-',
        x: rightX,
        y: y + 40,
      },
      {
        label: 'الهاتف',
        value: party.phone || '-',
        x: leftX,
        y: y + 68,
      },
      {
        label: 'العملة',
        value: currencyCode,
        x: rightX,
        y: y + 68,
      },
    ];

    info.forEach(item => {
      layout.arabic(
        doc,
        `${item.label}: ${item.value}`,
        item.x,
        item.y,
        textWidth,
        {
          fontSize: 9,
        }
      );
    });

    y += boxHeight + 18;
  }

  drawReturnInfo();

  // المعلومات الإضافية
  if (extraInfo.length) {
    extraInfo.forEach(info => {
      layout.arabic(
        doc,
        `${info.label || ''}: ${info.value ?? '-'}`,
        margin,
        y,
        contentWidth,
        {
          fontSize: 9,
        }
      );

      y += 19;
    });

    y += 8;
  }

  // سبب المرتجع
  if (reason) {
    layout.arabic(
      doc,
      `سبب المرتجع: ${reason}`,
      margin,
      y,
      contentWidth,
      {
        fontSize: 10,
      }
    );

    y += 30;
  }

  // أعمدة الجدول
  const columns = [
    { key: 'index', title: '#', width: 25 },
    { key: 'name', title: 'الصنف', width: 100, type: 'arabic' },
    { key: 'sku', title: 'SKU', width: 55 },
    { key: 'quantity', title: 'الكمية', width: 45 },
    { key: 'bonus', title: 'البونص', width: 45 },
    { key: 'price', title: 'السعر', width: 65 },
    { key: 'tax', title: 'الضريبة', width: 55 },
    { key: 'total', title: 'الإجمالي', width: 75 },
  ];

  // ضبط عرض الأعمدة ليتناسب مع الصفحة
  const originalTableWidth = columns.reduce(
    (sum, col) => sum + col.width,
    0
  );

  const scale = contentWidth / originalTableWidth;

  const tableColumns = columns.map(col => ({
    ...col,
    width: col.width * scale,
  }));

  const tableWidth = contentWidth;
  const tableX = margin;

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

  // صف من الجدول
  function drawRow(item, index) {
    const values = {
      index: index + 1,
      name: item.name || '-',
      sku: item.sku || '-',
      quantity:
        item.paid_quantity ??
        item.quantity ??
        0,
      bonus: item.bonus_quantity ?? 0,
      price: money(item.unit_price),
      tax: money(item.tax),
      total: money(item.total),
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
  }

  // رسم الجدول مع دعم تعدد الصفحات
  drawTableHeader();

  items.forEach((item, index) => {
    if (y + rowHeight > pageHeight - 100) {
      doc.addPage();

      y = drawPageHeader() + 15;

      drawTableHeader();
    }

    drawRow(item, index);
  });

  // المجاميع
  y += 18;

  const summaryItems = [
    ['إجمالي الأصناف', summary.subtotal],
    ['الخصم', summary.discount],
    ['الضريبة', summary.tax],
    ['الإجمالي النهائي', summary.total],
  ];

  const summaryWidth = 210;
  const summaryX = margin + contentWidth - summaryWidth;

  summaryItems.forEach(([label, value], index) => {
    if (value === undefined || value === null) return;

    if (y + 30 > pageHeight - 100) {
      doc.addPage();
      y = drawPageHeader() + 20;
    }

    const isTotal = index === summaryItems.length - 1;

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

    if (y + 35 > pageHeight - 100) {
      doc.addPage();
      y = drawPageHeader() + 20;
    }

    layout.arabic(
      doc,
      `المبلغ كتابة: ${amountInWords}`,
      margin,
      y,
      contentWidth,
      {
        fontSize: 9,
      }
    );

    y += 30;
  }

  // الملاحظات
  if (notes) {
    if (y + 40 > pageHeight - 100) {
      doc.addPage();
      y = drawPageHeader() + 20;
    }

    layout.arabic(
      doc,
      `ملاحظات: ${notes}`,
      margin,
      y,
      contentWidth,
      {
        fontSize: 9,
      }
    );

    y += 30;
  }

  // التوقيعات
  if (y + 90 > pageHeight - 90) {
    doc.addPage();
    y = drawPageHeader() + 20;
  }

  layout.drawSignature(
    doc,
    'توقيع المستلم',
    'توقيع المسؤول',
    pageWidth,
    y + 10
  );

  // إطار وتذييل جميع الصفحات
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
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
}

module.exports = { generateReturn };