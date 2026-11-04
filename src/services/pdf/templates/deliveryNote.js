const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

/**
 * بوليصة تسليم — A4، مع جدول بنود وتسليم.
 */
async function generateDeliveryNote(opts = {}) {
  const {
    company = {},
    deliveryNumber,
    deliveryDate,
    orderNumber,
    party = {},
    partyTitle = 'العميل',
    warehouseName,
    driverName,
    vehicleNumber,
    items = [],
    notes,
    extraInfo = [],
  } = opts;

  const { doc, promise } = createPage({
    size: [651, 851],
    margin: 30,
    bufferPages: true,
    info: {
      Title: `بوليصة تسليم - ${deliveryNumber || ''}`,
      Author: company.name || 'PharmaCore',
    },
  });

  const { pageWidth, pageHeight, contentWidth, margin } = layout.setupDocument(doc);

  const companyData = {
    nameAr:  company.name || '',
    nameEn:  company.name_en || '',
    addressAr: company.address || '',
    addressEn: company.addressEn || company.address_en || '',
    phoneAr: company.phoneAr || company.phone || '',
    phoneEn: company.phoneEn || company.phone || '',
    logo_url: company.logo_url,
    _logoBuffer: company._logoBuffer,
  };

  const titleAr = 'بوليصة تسليم';
  const titleEn = 'Delivery Note';
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
  // صندوق بيانات التسليم
  // ═══════════════════════════════════════════
  const infoHeight = 118;

  function drawDeliveryInfo() {
    doc
      .roundedRect(margin, y, contentWidth, infoHeight, 5)
      .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

    const colWidth = contentWidth / 2 - 25;
    const leftX = margin + 12;
    const rightX = margin + contentWidth / 2 + 5;

    // رقم البوليصة + التاريخ
    layout.arabic(doc, `رقم البوليصة: ${deliveryNumber || '—'}`, leftX, y + 12, colWidth, {
      fontSize: 9,
    });
    layout.arabic(doc, `تاريخ التسليم: ${deliveryDate || '—'}`, rightX, y + 12, colWidth, {
      fontSize: 9,
    });

    // رقم الطلب + اسم المستودع
    layout.arabic(doc, `رقم الطلب: ${orderNumber || '—'}`, leftX, y + 34, colWidth, {
      fontSize: 9,
    });
    layout.arabic(doc, `المستودع: ${warehouseName || '—'}`, rightX, y + 34, colWidth, {
      fontSize: 9,
    });

    // اسم الطرف + الهاتف
    layout.arabic(doc, `${partyTitle}: ${party.name || '—'}`, leftX, y + 56, colWidth, {
      fontSize: 10,
    });
    layout.arabic(doc, `الهاتف: ${party.phone || '—'}`, rightX, y + 56, colWidth, {
      fontSize: 9,
    });

    // السائق + رقم المركبة
    if (driverName) {
      layout.arabic(doc, `السائق: ${driverName}`, leftX, y + 78, colWidth, {
        fontSize: 9,
      });
    }
    if (vehicleNumber) {
      layout.arabic(doc, `رقم المركبة: ${vehicleNumber}`, rightX, y + 78, colWidth, {
        fontSize: 9,
      });
    }

    // معلومات إضافية
    if (extraInfo.length) {
      const extraText = extraInfo
        .map((e) => `${e.label || ''}: ${e.value ?? '—'}`)
        .join('  |  ');
      layout.arabic(doc, extraText, leftX, y + 98, contentWidth - 24, {
        fontSize: 8,
        color: layout.COLORS.muted,
      });
    }

    y += infoHeight + 12;
  }

  drawDeliveryInfo();

  // ═══════════════════════════════════════════
  // أعمدة الجدول
  // ═══════════════════════════════════════════
  const columns = [
    { key: 'index', title: '#', width: 25 },
    { key: 'name', title: 'الصنف', width: 130, type: 'arabic' },
    { key: 'sku', title: 'SKU', width: 65 },
    { key: 'quantity', title: 'الكمية', width: 55 },
    { key: 'bonus', title: 'البونص', width: 50 },
    { key: 'batch', title: 'رقم التشغيلة', width: 80 },
    { key: 'expiry', title: 'الانتهاء', width: 70 },
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
  function drawItem(item, index) {
    const values = {
      index: index + 1,
      name: item.name || '—',
      sku: item.sku || '—',
      quantity: Number(item.paid_quantity ?? item.quantity ?? 0).toFixed(3),
      bonus: Number(item.bonus_quantity ?? 0).toFixed(3),
      batch: item.batch_number || '—',
      expiry: item.expiry_date || '—',
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
    layout.arabic(doc, 'لا توجد أصناف', margin, y, contentWidth, {
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
      drawItem(item, index);
    });
  }

  // ═══════════════════════════════════════════
  // ملاحظات
  // ═══════════════════════════════════════════
  if (notes) {
    y += 18;
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
    'توقيع المستلم',
    'توقيع أمين المستودع',
    pageWidth,
    y + 10
  );

  // ═══════════════════════════════════════════
  // الإطار والتذييل
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

module.exports = { generateDeliveryNote };