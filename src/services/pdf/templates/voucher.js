
const { createPage } = require('../helpers/page');
const { drawHeader } = require('../helpers/header');
const { drawFooter } = require('../helpers/footer');
const { smartFormat } = require('../helpers/arabic');
const { COLORS } = require('../helpers/colors');
const layout = require('./pdfLayout');
async function generateVoucher(opts = {}) {
  const {
    company = {},
    voucherType,
    voucherNumber,
    voucherDate,
    amount,
    amountInWords,
    partyName,
    settlementOf,
    method,
    chequeNumber,
    chequeDate,
    bankName,
    currencyCode = 'YER',
    externalReference,
  } = opts;

  const isReceipt = voucherType === 'receipt';

  const title = isReceipt ? 'سند قبض' : 'سند صرف';
  const englishTitle = isReceipt ? 'Receipt Voucher' : 'Payment Voucher';

  const { doc, promise } = createPage({
    size: [595, 500],
    margin: 0,
    bufferPages: false,
    info: {
      Title: `${title} - ${voucherNumber || ''}`,
      Author: company.name || 'PharmaCore',
    },
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 20;

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
    voucherType === 'receipt'
      ? 'سند قبض'
      : 'سند صرف';

  // إطار السند
  doc.save()
    .roundedRect(M, M, contentWidth + 40, H - M * 2, 8)
    .strokeColor(COLORS.primary)
    .lineWidth(1.5)
    .stroke()
    .restore();

  // رأس الشركة
  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(
      doc,
      companyData,
      contentWidth
    );

    return headerY
  }
  let y = drawPageHeader() + 15;

  // عنوان السند
  const titleY = y + 5;
  const titleW = 200;
  const titleH = 36;
  const titleX = (W - titleW) / 2;

  doc.roundedRect(titleX, titleY, titleW, titleH, 3)
    .strokeColor(COLORS.primary)
    .lineWidth(1.5)
    .stroke();

  doc.font('Cairo-Bold')
    .fontSize(14)
    .fillColor(COLORS.red)
    .text(smartFormat(title), titleX, titleY + 2, {
      width: titleW,
      align: 'center',
    });

  doc.font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.primary)
    .text(englishTitle, titleX, titleY + 23, {
      width: titleW,
      align: 'center',
    });

  // رقم السند والتاريخ
  const fieldY = titleY + 5;

  function drawLabelValue(label, value, x, y, width = 150) {
    doc.font('Cairo-Bold')
      .fontSize(9)
      .fillColor(COLORS.primary)
      .text(smartFormat(label), x + width - 65, y, {
        width: 65,
        align: 'right',
      });

    doc.font('Cairo')
      .fontSize(9)
      .fillColor(COLORS.dark)
      .text(String(value || '—'), x, y, {
        width: width - 68,
        align: 'right',
        lineBreak: false,
        ellipsis: true,
      });
  }

  drawLabelValue(
    'رقم السند:',
    voucherNumber,
    W - M - 180,
    fieldY,
    155
  );

  drawLabelValue(
    'التاريخ:',
    voucherDate,
    W - M - 180,
    fieldY + 20,
    155
  );

  // المبلغ
  y = titleY + titleH + 15;

  doc.font('Cairo-Bold')
    .fontSize(11)
    .fillColor(COLORS.primary)
    .text(smartFormat('المبلغ:'), W - M - 90, y, {
      width: 65,
      align: 'right',
    });

  const amountX = W - M - 245;
  const amountY = y - 3;
  const amountH = 25;

  doc.rect(amountX, amountY, 90, amountH)
    .strokeColor(COLORS.primary)
    .stroke();

  doc.rect(amountX + 90, amountY, 75, amountH)
    .strokeColor(COLORS.primary)
    .stroke();

  doc.font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.primary)
    .text(
      Number(amount || 0).toFixed(2),
      amountX,
      amountY + 5,
      {
        width: 90,
        align: 'center',
      }
    );

  doc.font('Cairo')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(currencyCode, amountX + 90, amountY + 6, {
      width: 75,
      align: 'center',
    });

  // دالة رسم السطور الثنائية اللغة
  function drawVoucherLine({
    arabicLabel,
    englishLabel,
    value,
    y,
    valueX,
    valueWidth,
  }) {
    doc.font('Cairo-Bold')
      .fontSize(10)
      .fillColor(COLORS.primary)
      .text(smartFormat(arabicLabel), W - M - 185, y, {
        width: 160,
        align: 'right',
      });

    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.primary)
      .text(englishLabel, M + 15, y, {
        width: 120,
        align: 'left',
      });

    // الخط المنقط
    doc.save()
      .moveTo(valueX - 15, y + 14)
      .lineTo(valueX + valueWidth, y + 14)
      .strokeColor(COLORS.primary)
      .lineWidth(0.5)
      .dash(1, { space: 2 })
      .stroke()
      .undash()
      .restore();

    // القيمة
    doc.font('Cairo')
      .fontSize(9)
      .fillColor(COLORS.text || '#000000')
      .text(smartFormat(String(value || '')), valueX, y - 1, {
        width: valueWidth,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });
  }

  let lineY = y + 40;

  // اسم الطرف
  drawVoucherLine({
    arabicLabel: 'استلمنا من السيد / السادة',
    englishLabel: 'Received From',
    value: partyName,
    y: lineY,
    valueX: M + 145,
    valueWidth: 245,
  });

  // المبلغ كتابة
  lineY += 25;

  drawVoucherLine({
    arabicLabel: 'مبلغاً وقدره',
    englishLabel: 'The Sum Of',
    value: amountInWords,
    y: lineY,
    valueX: M + 130,
    valueWidth: 265,
  });

  // مقابل
  lineY += 25;

  drawVoucherLine({
    arabicLabel: 'وذلك مقابل',
    englishLabel: 'On Settlement Of',
    value: settlementOf,
    y: lineY,
    valueX: M + 150,
    valueWidth: 245,
  });

  // بيانات طريقة الدفع
  lineY += 30;

  // الشيك
  doc.font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text('Cheque No.', M + 15, lineY, {
      width: 80,
    });

  doc.moveTo(M + 85, lineY + 13)
    .lineTo(M + 245, lineY + 13)
    .strokeColor(COLORS.primary)
    .dash(1, { space: 2 })
    .stroke()
    .undash();

  doc.font('Cairo')
    .fontSize(9)
    .fillColor(COLORS.dark)
    .text(chequeNumber || '—', M + 85, lineY - 1, {
      width: 160,
      align: 'center',
    });

  // نقداً
  doc.font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text('Cash', M + 280, lineY, {
      width: 45,
    });

  doc.moveTo(M + 325, lineY + 13)
    .lineTo(M + 445, lineY + 13)
    .strokeColor(COLORS.primary)
    .dash(1, { space: 2 })
    .stroke()
    .undash();

// رسم علامة الصح باللون الأخضر
doc.save();



  if (method === 'cash') {
    doc
  .moveTo(M + 365, lineY + 7)
  .lineTo(M + 373, lineY + 15)
  .lineTo(M + 389, lineY - 2)
  .lineWidth(2)
  .strokeColor(COLORS.success)
  .lineCap('round')
  .lineJoin('round')
  .stroke();

doc.restore();
  }

  // البنك والتاريخ
  lineY += 22;

  doc.font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text('Bank', M + 15, lineY, {
      width: 50,
    });

  doc.moveTo(M + 55, lineY + 13)
    .lineTo(M + 245, lineY + 13)
    .strokeColor(COLORS.primary)
    .dash(1, { space: 2 })
    .stroke()
    .undash();

  doc.font('Cairo')
    .fontSize(9)
    .fillColor(COLORS.dark)
    .text(bankName || '—', M + 55, lineY - 1, {
      width: 190,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });

  doc.font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text('Dated', M + 280, lineY, {
      width: 45,
    });

  doc.moveTo(M + 325, lineY + 13)
    .lineTo(M + 445, lineY + 13)
    .strokeColor(COLORS.primary)
    .dash(1, { space: 2 })
    .stroke()
    .undash();

  doc.font('Cairo')
    .fontSize(9)
    .fillColor(COLORS.dark)
    .text(chequeDate || '—', M + 325, lineY - 1, {
      width: 120,
      align: 'center',
    });

  // تحديد نوع السند
  doc.font('Cairo-Bold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text(smartFormat('نقداً'), W - M - 75, lineY - 22, {
      width: 45,
      align: 'right',
    });

  doc.font('Cairo-Bold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text(smartFormat('مؤرخ'), W - M - 75, lineY, {
      width: 45,
      align: 'right',
    });

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
      pageHeight - 95
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
        pageHeight - 23
      );
    }
  
  

  // المرجع الخارجي
  if (externalReference) {
    doc.font('Cairo')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        smartFormat(`رقم السند الورقي: ${externalReference}`),
        M + 20,
        H - M - 18,
        {
          width: 200,
          align: 'left',
          lineBreak: false,
          ellipsis: true,
        }
      );
  }

  doc.end();

  return promise;
}

module.exports = { generateVoucher };
