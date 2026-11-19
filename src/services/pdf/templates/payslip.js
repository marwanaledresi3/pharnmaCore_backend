// services/pdf/templates/payslip.js
//
// قسيمة راتب موظف فردي — A5 portrait.
// تصميم مدمج: ترويسة، بيانات الموظف، إيرادات/خصومات، الصافي، توقيع.

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
 * @param {object} opts
 *   - company: { nameAr, nameEn, addressAr, addressEn, phoneAr, phoneEn, logo_url, _logoBuffer }
 *   - payslip: {
 *       period_year, period_month, run_number, payment_date,
 *       employee: { employee_number, full_name, department_name, job_title_name, bank_name, iban },
 *       earnings: [{ label, value }],   // الراتب الأساسي، بدلات، إضافي، مكافآت
 *       deductions: [{ label, value }], // تأمينات، ضريبة، غياب، سلف
 *       gross_salary, total_deductions, net_salary,
 *     }
 *   - currencyCode
 *   - showSignature (bool)
 */
const generatePayslip = async (opts = {}) => {
  const {
    company = {},
    payslip = {},
    currencyCode = 'YER',
    showSignature = true,
  } = opts;

  // إنشاء المستند — A5 portrait
  const { doc, promise } = createPage({
    size: [420, 595], // A5
    margin: 20,
    bufferPages: false,
    info: {
      Title: `Payslip ${payslip.run_number || ''}`,
      Author: company.nameAr || company.name || 'Onix ERP',
    },
  });

  const { pageWidth, pageHeight, contentWidth, margin } = layout.setupDocument(doc);

  const companyData = {
    nameAr:    company.nameAr    || company.name    || '',
    nameEn:    company.nameEn    || company.name_en || '',
    addressAr: company.addressAr || company.address || '',
    addressEn: company.addressEn || company.address_en || '',
    phoneAr:   company.phoneAr   || company.phone   || '',
    phoneEn:   company.phoneEn   || company.phone   || '',
    logo_url:  company.logo_url,
    _logoBuffer: company._logoBuffer,
  };

  // ═══════════════════════════════════════════════════════════
  // 1) الترويسة
  // ═══════════════════════════════════════════════════════════
  let y = layout.drawCompanyHeader(doc, companyData, contentWidth) + 8;

  // ═══════════════════════════════════════════════════════════
  // 2) العنوان — "قسيمة راتب"
  // ═══════════════════════════════════════════════════════════
  doc.save()
    .roundedRect(margin, y, contentWidth, 32, 4)
    .fill(layout.COLORS.primary)
    .restore();

  layout.arabic(doc, 'قسيمة راتب', margin, y + 6, contentWidth, {
    fontSize: 15,
    color: layout.COLORS.white,
    align: 'center',
  });
  doc.font('Helvetica').fontSize(9).fillColor(layout.COLORS.white)
     .text('Payslip', margin, y + 20, { width: contentWidth, align: 'center' });

  y += 42;

  // ═══════════════════════════════════════════════════════════
  // 3) بيانات الموظف والفترة
  // ═══════════════════════════════════════════════════════════
  const emp = payslip.employee || {};

  const infoHeight = 100;
  doc.roundedRect(margin, y, contentWidth, infoHeight, 4)
     .fillAndStroke(layout.COLORS.light, layout.COLORS.border);

  // العمود الأيمن — بيانات الموظف
  const colWidth = (contentWidth - 24) / 2;

  layout.arabic(doc, `الموظف: ${emp.full_name || '—'}`, margin + 8, y + 8, colWidth, {
    fontSize: 9,
    color: layout.COLORS.primary,
  });
  layout.arabic(doc, `رقم الموظف: ${emp.employee_number || '—'}`, margin + 8, y + 26, colWidth, {
    fontSize: 8,
  });
  layout.arabic(doc, `القسم: ${emp.department_name || '—'}`, margin + 8, y + 42, colWidth, {
    fontSize: 8,
  });
  layout.arabic(doc, `المسمى: ${emp.job_title_name || '—'}`, margin + 8, y + 58, colWidth, {
    fontSize: 8,
  });

  // العمود الأيسر — بيانات المسير
  const leftX = margin + colWidth + 16;

  layout.arabic(doc, `الفترة: ${payslip.period_month}/${payslip.period_year}`, leftX, y + 8, colWidth, {
    fontSize: 9,
    color: layout.COLORS.primary,
  });
  layout.arabic(doc, `رقم المسير: ${payslip.run_number || '—'}`, leftX, y + 26, colWidth, {
    fontSize: 8,
  });
  layout.arabic(doc, `تاريخ الدفع: ${payslip.payment_date || '—'}`, leftX, y + 42, colWidth, {
    fontSize: 8,
  });
  if (emp.bank_name) {
    layout.arabic(doc, `البنك: ${emp.bank_name}`, leftX, y + 58, colWidth, {
      fontSize: 8,
    });
  }
  if (emp.iban) {
    layout.arabic(doc, `IBAN: ${emp.iban}`, leftX, y + 72, colWidth, {
      fontSize: 8,
    });
  }

  y += infoHeight + 12;

  // ═══════════════════════════════════════════════════════════
  // 4) جدولين متوازيين: الإيرادات / الخصومات
  // ═══════════════════════════════════════════════════════════
  const earnings = Array.isArray(payslip.earnings) ? payslip.earnings : [];
  const deductions = Array.isArray(payslip.deductions) ? payslip.deductions : [];

  const colGap = 8;
  const halfW = (contentWidth - colGap) / 2;
  const earningsX = margin + halfW + colGap; // الإيرادات يمين (RTL)
  const deductionsX = margin;                // الخصومات يسار

  const rowH = 20;

  // عناوين
  const drawSectionHeader = (x, label) => {
    doc.roundedRect(x, y, halfW, 24, 3).fill('#047857'); // emerald-700
    layout.arabic(doc, label, x, y + 5, halfW, {
      fontSize: 10,
      color: layout.COLORS.white,
      align: 'center',
    });
  };

  drawSectionHeader(earningsX, 'الإيرادات');
  drawSectionHeader(deductionsX, 'الخصومات');

  y += 26;

  // صفوف
  const maxRows = Math.max(earnings.length, deductions.length);
  const tableStartY = y;

  for (let i = 0; i < maxRows; i++) {
    const rowY = tableStartY + i * rowH;

    // خلفية متبادلة
    if (i % 2 === 0) {
      doc.rect(earningsX, rowY, halfW, rowH).fill('#F9FAFB');
      doc.rect(deductionsX, rowY, halfW, rowH).fill('#F9FAFB');
    }

    // إيراد
    if (earnings[i]) {
      layout.arabic(doc, earnings[i].label, earningsX + 4, rowY + 4, halfW * 0.65, {
        fontSize: 8,
      });
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#047857')
         .text(money(earnings[i].value), earningsX + halfW * 0.6, rowY + 4, {
           width: halfW * 0.38,
           align: 'left',
         });
    }

    // خصم
    if (deductions[i]) {
      layout.arabic(doc, deductions[i].label, deductionsX + 4, rowY + 4, halfW * 0.65, {
        fontSize: 8,
      });
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#B91C1C')
         .text(money(deductions[i].value), deductionsX + halfW * 0.6, rowY + 4, {
           width: halfW * 0.38,
           align: 'left',
         });
    }
  }

  // خطوط
  doc.moveTo(earningsX, tableStartY).lineTo(earningsX + halfW, tableStartY)
     .lineWidth(0.5).strokeColor('#E5E7EB').stroke();
  doc.moveTo(deductionsX, tableStartY).lineTo(deductionsX + halfW, tableStartY)
     .lineWidth(0.5).strokeColor('#E5E7EB').stroke();

  y = tableStartY + maxRows * rowH + 8;

  // ═══════════════════════════════════════════════════════════
  // 5) الإجماليات
  // ═══════════════════════════════════════════════════════════
  const totalsHeight = 80;
  doc.roundedRect(margin, y, contentWidth, totalsHeight, 4)
     .fillAndStroke('#F3F4F6', '#E5E7EB');

  // إجمالي الإيرادات
  layout.arabic(doc, 'إجمالي الإيرادات', margin + 8, y + 8, halfW * 0.6, {
    fontSize: 8, color: '#6B7280',
  });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#047857')
     .text(money(payslip.gross_salary), margin + 8, y + 20, { width: halfW - 16, align: 'left' });

  // إجمالي الخصومات
  layout.arabic(doc, 'إجمالي الخصومات', margin + halfW + 8, y + 8, halfW * 0.6, {
    fontSize: 8, color: '#6B7280',
  });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#B91C1C')
     .text(money(payslip.total_deductions), margin + halfW + 8, y + 20, {
       width: halfW - 16, align: 'left',
     });

  // خط فاصل
  doc.moveTo(margin + 8, y + 40).lineTo(margin + contentWidth - 8, y + 40)
     .lineWidth(0.8).strokeColor('#D1D5DB').stroke();

  // الصافي
  layout.arabic(doc, 'صافي الراتب', margin + 8, y + 48, halfW, {
    fontSize: 10, color: layout.COLORS.primary,
  });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(layout.COLORS.primary)
     .text(`${money(payslip.net_salary)} ${currencyCode}`, margin + 8, y + 60, {
       width: contentWidth - 16, align: 'right',
     });

  y += totalsHeight + 10;

  // ═══════════════════════════════════════════════════════════
  // 6) المبلغ بالحروف (اختياري)
  // ═══════════════════════════════════════════════════════════
  if (payslip.amountInWords) {
    layout.arabic(doc, `المبلغ كتابةً: ${payslip.amountInWords}`, margin, y + 4, contentWidth, {
      fontSize: 8, color: '#6B7280',
    });
    y += 20;
  }

  // ═══════════════════════════════════════════════════════════
  // 7) توقيعات
  // ═══════════════════════════════════════════════════════════
  if (showSignature) {
    const signY = pageHeight - 90;

    layout.arabic(doc, 'توقيع الموظف', margin, signY, halfW - 20, {
      fontSize: 9, color: '#374151',
    });
    layout.arabic(doc, 'توقيع المسؤول', margin + halfW + 20, signY, halfW - 20, {
      fontSize: 9, color: '#374151',
    });

    doc.moveTo(margin, signY + 40).lineTo(margin + halfW - 20, signY + 40)
       .lineWidth(0.8).strokeColor('#9CA3AF').stroke();
    doc.moveTo(margin + halfW + 20, signY + 40).lineTo(margin + contentWidth, signY + 40)
       .lineWidth(0.8).strokeColor('#9CA3AF').stroke();
  }

  // ═══════════════════════════════════════════════════════════
  // 8) إطار + تذييل
  // ═══════════════════════════════════════════════════════════
  layout.drawPageFrame(doc, pageWidth, pageHeight);

  layout.drawFooter(doc, `قسيمة راتب — ${payslip.period_month}/${payslip.period_year}`, contentWidth, pageHeight - 30);

  // ⚠️ مهم: Buffer
  doc.end();
  return promise;
};

module.exports = { generatePayslip };