const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

function money(value) {
  return Number(value || 0).toFixed(2);
}

/**
 * سند مصروف — 595 × 500 pt (A5 عرضي تقريباً).
 * تنسيق مخصص مختلف عن A4 (بلا جدول، حقول معبأة).
 */
async function generateExpense(opts = {}) {
  const {
    company = {},
    expenseNumber,
    expenseDate,
    accountCode,
    accountName,
    description,
    amount,
    amountInWords,
    supplierName,
    method,
    paidAmount,
    status,
    currencyCode = 'YER',
    externalReference,
    journalEntryNumber,
  } = opts;

  const { doc, promise } = createPage({
    size: [655, 500],
    margin: 0,
    bufferPages: false,
    info: {
      Title: `سند مصروف - ${expenseNumber || ''}`,
      Author: company.name || 'PharmaCore',
    },
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 20;
  const startX = M;
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

  // الإطار الخارجي
  doc.save();
  doc
    .roundedRect(M, M, contentWidth + 40, H - M * 2, 8)
    .lineWidth(1.5)
    .strokeColor(layout.COLORS.primary)
    .stroke();
  doc.restore();

  // رأس الشركة
  let y = layout.drawCompanyHeader(doc, companyData, contentWidth) + 5;

  // عنوان السند
  const titleAr = 'سند مصروف';
  const titleEn = 'Expense Voucher';
  const titleW = 200;
  const titleH = 40;
  const titleX =  (W - titleW) / 2;
  const titleY = y;

  doc.save();
  doc
    .rect(titleX, titleY, titleW, titleH)
    .lineWidth(1.2)
    .strokeColor(layout.COLORS.blue)
    .stroke();
  doc.restore();

  doc
    .font('Cairo-Bold')
    .fontSize(14)
    .fillColor('#0511FF')
    .text(smartFormat(titleAr), titleX, titleY + 4, {
      width: titleW,
      align: 'center',
    });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(layout.COLORS.primary)
    .text(titleEn, titleX, titleY + 24, {
      width: titleW,
      align: 'center',
    });

  // معلومات علوية (رقم وتاريخ)
  const infoRightX =  pageWidth - 15;
const formattedDate = expenseDate
  ? expenseDate.split('T')[0].split('-').reverse().join('/')
  : '—';
  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor(layout.COLORS.text)
    .text(smartFormat(`رقم المصروف: ${expenseNumber || '—'}`), infoRightX - 240, titleY + 4, {
      width: 200,
      align: 'right',
    })
    .text(smartFormat(`التاريخ: ${formattedDate}`), infoRightX - 240, titleY + 20, {
      width: 200,
      align: 'right',
    });

  // المبلغ
  const amountY = titleY + titleH + 15;

  doc
    .font('Cairo')
    .fontSize(10)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('المبلغ:'),  pageWidth - 140, amountY, {
      width: 90,
      align: 'right',
    });

  const boxX =  pageWidth - 230;
  doc.save();
  doc
    .rect(boxX, amountY - 3, 80, 24)
    .strokeColor(layout.COLORS.primary)
    .lineWidth(1)
    .stroke();
  doc
    .rect(boxX + 80, amountY - 3, 65, 24)
    .strokeColor(layout.COLORS.primary)
    .lineWidth(1)
    .stroke();
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(layout.COLORS.primary)
    .text(money(amount), boxX, amountY + 4, { width: 80, align: 'center' });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(layout.COLORS.muted)
    .text(currencyCode, boxX + 80, amountY + 5, { width: 65, align: 'center' });

  // الحقول النصية — بلا جدول
  const labelX =  pageWidth - 135;
  const valueX =  20;
  const valueW = pageWidth - 160;

  function drawField(label, value, yPos) {
    doc
      .font('Cairo')
      .fontSize(10)
      .fillColor(layout.COLORS.primary)
      .text(smartFormat(`${label}:`), labelX, yPos, { width: 85, align: 'right' });

    doc
      .font('Cairo')
      .fontSize(9)
      .fillColor(layout.COLORS.text)
      .text(smartFormat(value ?? '—'), valueX - 11, yPos - 2, {
        width: valueW,
        align: 'right',
        lineGap: 2,
      });

    doc.save();
    doc
      .moveTo(valueX + 15, yPos + 13)
      .lineTo(labelX , yPos + 13)
      .strokeColor(layout.COLORS.border)
      .lineWidth(0.5)
      .stroke();
    doc.restore();

    return yPos + 22;
  }

  let fieldY = amountY + 38;

  fieldY = drawField('البيان', description, fieldY);
  fieldY = drawField(
    'الحساب',
    `${accountCode || ''}${accountName ? ` - ${accountName}` : ''}`,
    fieldY
  );
  fieldY = drawField('الاسم', supplierName, fieldY);

  // طريقة الدفع
  const methodMap = { cash: 'نقداً', bank: 'حوالة', cheque: 'شيك' };
  const methodLabel = methodMap[method] || '—';

  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('طريقة الدفع:'), labelX, fieldY, {
      width: 85,
      align: 'right',
    });
  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor('#FF0505')
    .text(smartFormat(methodLabel), pageWidth - 225, fieldY, {
      width: 90,
      align: 'right',
    });

  // رقم فاتورة المورد
  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('رقم المستند:'),  155, fieldY, {
      width: 130,
      align: 'right',
    });
  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor(layout.COLORS.text)
    .text(smartFormat(externalReference || '—'), 100, fieldY, {
      width: 130,
      align: 'left',
    });

  fieldY += 24;

  // المدفوع والحالة
  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('المدفوع:'), labelX, fieldY, {
      width: 80,
      align: 'right',
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#16a34a')
    .text(`${money(paidAmount)} ${currencyCode}`,  pageWidth - 260, fieldY, {
      width: 105,
      align: 'right',
    });

  const statusMap = {
    paid: { label: 'مدفوع', color: '#16a34a' },
    partial: { label: 'جزئي', color: '#ca8a04' },
    cancelled: { label: 'ملغي', color: '#dc2626' },
    posted: { label: 'مرحّل', color: layout.COLORS.primary },
  };
  const currentStatus = statusMap[status] || statusMap.posted;

  doc
    .font('Cairo')
    .fontSize(9)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('الحالة:'),  205, fieldY, {
      width: 65,
      align: 'right',
    });
  doc
    .font('Cairo-Bold')
    .fontSize(9)
    .fillColor(currentStatus.color)
    .text(smartFormat(currentStatus.label),  100, fieldY, {
      width: 130,
      align: 'left',
    });

  // المبلغ بالحروف
  const wordsY = fieldY + 25;
  const wordsX = startX + 10;
  const wordsW = pageWidth - 70;

  doc.save();
  doc
    .roundedRect(wordsX, wordsY, wordsW, 28, 3)
    .fillAndStroke('#f0fdf4', '#bbf7d0');
  doc.restore();

  doc
    .font('Cairo')
    .fontSize(8)
    .fillColor('#15803d')
    .text(smartFormat('المبلغ بالحروف:'), wordsX + wordsW - 110, wordsY + 7, {
      width: 100,
      align: 'right',
    });

  doc
    .font('Cairo')
    .fontSize(8)
    .fillColor('#FF0505')
    .text(smartFormat(amountInWords || '—'), wordsX + 10, wordsY + 7, {
      width: wordsW - 130,
      align: 'right',
    });

  // رقم القيد + تذييل
  if (journalEntryNumber) {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(layout.COLORS.muted)
      .text(
        `Journal Entry: ${journalEntryNumber}`,
        startX + 20,
        H - M - 40,
        { width: 200, align: 'left' }
      );
  }

  // التوقيعات (مخصصة لأن الصفحة صغيرة)
  const sigY = H - M - 40;

  doc
    .font('Cairo')
    .fontSize(12)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('توقيع المحاسب'),  pageWidth - 210, sigY, {
      width: 160,
      align: 'right',
    });
  doc
    .moveTo( pageWidth - 180, sigY + 30)
    .lineTo( pageWidth - 40, sigY + 30)
    .strokeColor(layout.COLORS.primary)
    .lineWidth(0.5)
    .stroke();

  doc
    .font('Cairo')
    .fontSize(12)
    .fillColor(layout.COLORS.primary)
    .text(smartFormat('توقيع المستلم'), startX + 30, sigY, {
      width: 160,
      align: 'right',
    });
  doc
    .moveTo(startX + 30, sigY + 30)
    .lineTo(startX + 190, sigY + 30)
    .strokeColor(layout.COLORS.primary)
    .lineWidth(0.5)
    .stroke();

  // التذييل
  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor(layout.COLORS.muted)
    .text(
      `PharmaCore ERP — ${new Date().toLocaleString('en-US')}`,
      startX,
      H - M - 12,
      { width: pageWidth, align: 'center' }
    );

  doc.end();
  return promise;
}

module.exports = { generateExpense };