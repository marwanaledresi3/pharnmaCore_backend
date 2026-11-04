
const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

function docLabel(type) {
  const labels = {
    sale_invoice: 'فاتورة مبيعات',
    purchase_invoice: 'فاتورة مشتريات',
    sale_return: 'مرتجع مبيعات',
    purchase_return: 'مرتجع مشتريات',
    receipt_voucher: 'سند قبض',
    payment_voucher: 'سند صرف',
    delivery_note: 'بوليصة تسليم',
    statement: 'كشف حساب',
    trial_balance: 'ميزان مراجعة',
    report: 'تقرير',
  };

  return labels[type] || 'مستند';
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2);
}

async function generateInvoice(opts) {
  const {
    company = {},
    docType,
    docNumber,
    docDate,
    partyTitle,
    party = {},
    items = [],
    summary = [],
    amountInWords,
    currencyCode = 'YER',
    extraInfo = {},
    notes,
    qrData,
  } = opts;

  // إنشاء المستند وتسجيل الخطوط
  const { doc, promise } = createPage({
    size: [651, 851],
    margin: 30,
    bufferPages: true,
    info: {
      Title: `${docLabel(docType)} - ${docNumber || ''}`,
      Author: company.name || 'PharmaCore',
    },
  });

  const page = layout.setupDocument(doc);

  const {
    pageWidth,
    pageHeight,
    margin,
    contentWidth,
  } = page;

  const COLORS = layout.COLORS;

  const bottomLimit = pageHeight - 150;

  // إطار كل صفحة
  layout.drawPageFrame(doc, pageWidth, pageHeight);

  doc.on('pageAdded', () => {
    layout.drawPageFrame(doc, pageWidth, pageHeight);
  });

  // بيانات الشركة المتوافقة مع pdfLayout
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

  // رأس الصفحة والعنوان
  function drawPageHeader(title = docLabel(docType)) {
    let currentY = layout.drawCompanyHeader(
      doc,
      companyData,
      contentWidth
    );

    currentY = layout.drawDocumentTitle(
      doc,
      title,
      '',
      contentWidth,
      currentY
    );

    return currentY;
  }

  let y = drawPageHeader();

  // معلومات الفاتورة
  function drawInvoiceInfo(currentY) {
    const boxHeight = 62;

  

    layout.arabic(
      doc,
      `رقم المستند: ${docNumber || '—'}`,
      margin + 10,
      currentY + 8,
      contentWidth - 20,
      { fontSize: 10, color: COLORS.primary }
    );

    layout.arabic(
      doc,
      `التاريخ: ${docDate || '—'}`,
      margin + 10,
      currentY + 25,
      contentWidth - 20,
      { fontSize: 9 }
    );

    if (party.name) {
      layout.arabic(
        doc,
        `${partyTitle || 'الطرف'}: ${party.name}`,
        margin + 10,
        currentY + 42,
        contentWidth - 20,
        { fontSize: 9 }
      );
    }

    return currentY + boxHeight + 10;
  }

  y = drawInvoiceInfo(y);

  // بيانات الطرف
  const partyDetails = [];

  if (party.phone) {
    partyDetails.push(`الهاتف: ${party.phone}`);
  }

  if (party.tax_number || party.taxNumber) {
    partyDetails.push(
      `الرقم الضريبي: ${party.tax_number || party.taxNumber}`
    );
  }

  if (party.address) {
    partyDetails.push(`العنوان: ${party.address}`);
  }

  if (partyDetails.length > 0) {
    layout.arabic(
      doc,
      partyDetails.join('   |   '),
      margin,
      y,
      contentWidth,
      { fontSize: 8, color: COLORS.muted }
    );

    y += 20;
  }

  // معلومات إضافية
  const extraEntries = Object.entries(extraInfo).filter(
    ([, value]) =>
      value != null &&
      value !== '' &&
      value !== '—'
  );

  for (const [key, value] of extraEntries) {
    if (y + 18 > bottomLimit) {
      doc.addPage();
      y = drawPageHeader('متابعة المستند');
    }

    layout.arabic(
      doc,
      `${key}: ${value}`,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );

    y += 17;
  }

  y += 8;

  // أعمدة جدول الأصناف
  const columns = [
    { key: 'index', title: '#', width: 25 },
    {
      key: 'name',
      title: 'الصنف',
      width: 140,
      type: 'arabic',
    },
    { key: 'sku', title: 'SKU', width: 55 },
    { key: 'quantity', title: 'الكمية', width: 50 },
    { key: 'bonus', title: 'بونص', width: 45 },
    { key: 'price', title: 'السعر', width: 65 },
    { key: 'tax', title: 'الضريبة', width: 55 },
    { key: 'total', title: 'الإجمالي', width: 80 },
  ];

  // ضبط عرض الأعمدة على عرض الصفحة
  const originalWidth = columns.reduce(
    (sum, column) => sum + column.width,
    0
  );

  const scale = contentWidth / originalWidth;

  const scaledColumns = columns.map(column => ({
    ...column,
    width: column.width * scale,
  }));

  const rowHeight = 35;
  const headerHeight = 35;

  // رسم رأس الجدول
  function drawItemsTableHeader() {
    layout.drawTableHeader(
      doc,
      scaledColumns,
      margin,
      y,
      contentWidth,
      headerHeight
    );

    y += headerHeight;
  }

  if (items.length > 0) {
    drawItemsTableHeader();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // الانتقال إلى صفحة جديدة عند امتلاء الصفحة
      // if (y + rowHeight > bottomLimit) {
      //   doc.addPage();

       
      //   drawItemsTableHeader();
      // }

      // خلفية الصفوف بالتناوب
      if (i % 2 === 0) {
        doc.save();
        doc.rect(
          margin,
          y,
          contentWidth,
          rowHeight
        ).fill(COLORS.light);
        doc.restore();
      }

      const values = {
        index: String(i + 1),
        name: item.name || '—',
        sku: item.sku || '—',
        quantity: String(
          item.paid_quantity ??
          item.quantity ??
          0
        ),
        bonus: String(item.bonus_quantity || 0),
        price: formatNumber(item.unit_price),
        tax: item.tax ? String(item.tax) : '—',
        total: formatNumber(item.total),
      };

      layout.drawTableRow(
        doc,
        scaledColumns,
        values,
        margin,
        y,
        rowHeight
      );

      y += rowHeight;
    }

    y += 12;
  }

  // التحقق من المساحة قبل المجاميع
  const summaryHeight = summary.reduce(
    (sum, row) => sum + (row.isTotal ? 24 : 20),
    0
  ) + 16;

  // if (summary.length > 0 && y + summaryHeight > bottomLimit) {
  //   doc.addPage();
  
  // }

  // المجاميع
  if (summary.length > 0) {
    const boxW = 280;
    const boxH = summaryHeight;
    const boxX = margin;

    doc.save();
    doc.roundedRect(
      boxX,
      y,
      boxW,
      boxH,
      4
    ).fill(COLORS.light);
    doc.restore();

    let cy = y + 8;

    for (const row of summary) {
      const isTotal = Boolean(row.isTotal);

      const label = row.label || '';

      const value =
        typeof row.value === 'string'
          ? row.value
          : `${formatNumber(row.value)} ${currencyCode}`;

      layout.arabic(
        doc,
        label,
        boxX + 8,
        cy,
        boxW - 110,
        {
          fontSize: isTotal ? 11 : 9,
          color: isTotal ? COLORS.primary : COLORS.text,
          bold: isTotal,
        }
      );

      doc.font(isTotal ? 'Cairo-Bold' : 'Cairo')
        .fontSize(isTotal ? 11 : 9)
        .fillColor(isTotal ? COLORS.primary : COLORS.text)
        .text(String(value), boxX + 8, cy, {
          width: boxW - 16,
          align: 'left',
        });

      cy += isTotal ? 24 : 20;
    }

    y += boxH + 12;
  }

  // المبلغ بالحروف
  if (amountInWords) {
    const wordsHeight = 32;

    if (y + wordsHeight > bottomLimit) {
      doc.addPage();
      y = drawPageHeader('ملخص المستند');
    }

    doc.save();
    doc.roundedRect(
      margin,
      y,
      contentWidth,
      wordsHeight,
      4
    ).fill('#f0fdf4');
    doc.restore();

    layout.arabic(
      doc,
      `المبلغ بالحروف: ${amountInWords}`,
      margin + 8,
      y + 9,
      contentWidth - 16,
      { fontSize: 9, color: '#166534' }
    );

    y += wordsHeight + 8;
  }

  // الملاحظات
  if (notes) {
    const noteText = smartFormat(notes);

    doc.font('Cairo').fontSize(9);

    const noteHeight = doc.heightOfString(noteText, {
      width: contentWidth - 10,
      align: 'right',
    }) + 25;

    if (y + noteHeight > bottomLimit) {
      doc.addPage();
      y = drawPageHeader('ملاحظات المستند');
    }

    layout.arabic(
      doc,
      'ملاحظات:',
      margin,
      y,
      contentWidth,
      {
        fontSize: 10,
        color: COLORS.primary,
      }
    );

    y += 18;

    layout.arabic(
      doc,
      notes,
      margin,
      y,
      contentWidth,
      { fontSize: 9 }
    );

    y += noteHeight - 18;
  }

  // QR Code
  if (qrData) {
    try {
      const QRCode = require('qrcode');

      const qrBuffer = await QRCode.toBuffer(qrData, {
        width: 120,
        margin: 1,
      });

      const qrSize = 75;

      if (y + qrSize + 25 > bottomLimit) {
        doc.addPage();
        y = drawPageHeader('رمز التحقق');
      }

      doc.image(
        qrBuffer,
        margin + contentWidth - qrSize,
        y,
        {
          width: qrSize,
          height: qrSize,
        }
      );

      layout.arabic(
        doc,
        'امسح الرمز للتحقق',
        margin + contentWidth - qrSize - 10,
        y + qrSize + 3,
        qrSize + 20,
        {
          fontSize: 7,
          color: COLORS.muted,
          align: 'center',
        }
      );

      y += qrSize + 25;
    } catch (error) {
      console.error('[pdf] QR failed:', error.message);
    }
  }

  // التوقيعات
  const signatureY = Math.max(
    y + 15,
    pageHeight - 125
  );

  layout.drawSignature(
    doc,
    'توقيع المُصدِر:',
    'توقيع المستلم:',
    pageWidth,
    signatureY
  );

  // التذييل
  doc.moveTo(
    margin,
    pageHeight - 55
  )
    .lineTo(
      pageWidth - margin,
      pageHeight - 55
    )
    .lineWidth(0.5)
    .strokeColor(COLORS.border)
    .stroke();

  layout.drawFooter(
    doc,
    `تم إنشاء المستند بواسطة PharmaCore ERP — ${new Date().toLocaleString('ar-SA')}`,
    contentWidth,
    pageHeight - 45
  );

  // إنهاء المستند
  doc.end();

  return promise;
}

module.exports = { generateInvoice };
