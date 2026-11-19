// services/pdf/templates/hrReport.js
//
// قالب تقرير HR — يُرجع Buffer (مثل purchaseOrder.js).
// يتبع نفس نمط باقي القوالب تماماً.

const { createPage } = require('../helpers/page');
const layout = require('./pdfLayout');
const { smartFormat } = require('../helpers/arabic');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function drawWrappedArabic(doc, text, x, currentY, width, options = {}) {
  const fontSize = options.fontSize || 9;

  doc.font('Arabic').fontSize(fontSize);

  const height = doc.heightOfString(
    smartFormat(String(text ?? '')),
    { width, lineGap: 2 }
  );

  layout.arabic(doc, text, x, currentY, width, {
    fontSize,
    align: options.align || 'right',
    color: options.color,
  });

  return Math.max(height, 17);
}

// ═══════════════════════════════════════════════════════════════
// Main — يُرجع Promise<Buffer>
// ═══════════════════════════════════════════════════════════════
/**
 * @returns {Promise<Buffer>}
 */
const generateHrReport = async (opts = {}) => {
  const {
    company = {},
    title = 'تقرير',
    titleEn = 'Report',
    subtitle,
    headers = [],
    rows = [],
    summary = [],
    notes,
    footer,
    currencyCode = 'YER',
    landscape = true,
    columnTypes = {},
    showSignature = false,
    signatureLeft,
    signatureRight,
  } = opts;

  // 1) إنشاء المستند — نفس نمط purchaseOrder.js
  const { doc, promise } = createPage({
    size: landscape ? [851, 651] : [595, 842],
    margin: 30,
    bufferPages: true,
    info: {
      Title: title,
      Author: company.nameAr || company.name || 'Onix ERP',
    },
  });

  const { pageWidth, pageHeight, contentWidth, margin } = layout.setupDocument(doc);

  // 2) تجهيز بيانات الشركة
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

  // 3) رأس الصفحة
  function drawPageHeader() {
    const headerY = layout.drawCompanyHeader(doc, companyData, contentWidth);
    const titleY = layout.drawDocumentTitle(doc, title, titleEn, contentWidth, headerY + 10);

    if (subtitle) {
      layout.arabic(doc, subtitle, margin, titleY, contentWidth, {
        fontSize: 10,
        color: layout.COLORS.muted,
        align: 'center',
      });
      return titleY + 20;
    }
    return titleY;
  }

  let y = drawPageHeader() + 15;

  function addNewPage() {
    doc.addPage();
    y = drawPageHeader() + 15;
  }

  // 4) الأعمدة
  const columns = headers.map((h) => {
    const minWidth = Math.max(60, String(h).length * 9 + 20);
    return {
      key: h,
      title: h,
      width: minWidth,
      type: columnTypes[h] || 'arabic',
    };
  });

  const totalColsWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const scale = contentWidth / totalColsWidth;
  columns.forEach((c) => { c.width = c.width * scale; });

  const tableX = margin;
  const tableWidth = contentWidth;
  const rowHeight = 28;

  // 5) رأس الجدول
  function drawTableHeader() {
    layout.drawTableHeader(doc, columns, tableX, y, tableWidth, rowHeight);
    y += rowHeight;
  }

  // 6) الصفوف
  if (rows.length > 0) {
    drawTableHeader();

    rows.forEach((row) => {
      if (y + rowHeight > pageHeight - 100) {
        addNewPage();
        drawTableHeader();
      }

      const values = {};
      for (const col of columns) {
        let v = row[col.key] ?? '—';

        if (col.type === 'money') {
          v = `${money(v)} ${currencyCode}`;
        } else if (col.type === 'number') {
          v = String(Number(v) || 0);
        } else if (col.type === 'date') {
          v = v ? String(v).slice(0, 10) : '—';
        }

        values[col.key] = v;
      }

      layout.drawTableRow(doc, columns, values, tableX, y, rowHeight);
      y += rowHeight;
    });
  } else {
    layout.arabic(doc, 'لا توجد بيانات للفترة المحددة', margin, y + 20, contentWidth, {
      fontSize: 11,
      color: layout.COLORS.muted,
      align: 'center',
    });
    y += 60;
  }

  // 7) الملخص
  if (summary.length > 0) {
    if (y + summary.length * 30 + 50 > pageHeight - 100) {
      addNewPage();
    }

    y += 15;

    layout.arabic(doc, 'الملخص', margin, y, contentWidth, {
      fontSize: 11,
      color: layout.COLORS.primary,
      align: 'right',
    });
    y += 22;

    doc.moveTo(margin, y - 5)
      .lineTo(margin + contentWidth, y - 5)
      .lineWidth(1.5)
      .strokeColor(layout.COLORS.primary)
      .stroke();

    const summaryWidth = 280;
    const summaryX = margin + contentWidth - summaryWidth;

    for (const item of summary) {
      const isTotal = item.isTotal;

      if (isTotal) {
        doc.roundedRect(summaryX, y - 3, summaryWidth, 28, 4)
          .fill(layout.COLORS.primary);
      }

      const color = isTotal ? layout.COLORS.white : layout.COLORS.text;

      layout.arabic(doc, item.label, summaryX + 8, y + 5, summaryWidth - 100, {
        fontSize: 10,
        color,
        align: 'right',
      });

      doc.font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(color)
        .text(String(item.value), summaryX + summaryWidth - 100, y + 5, {
          width: 92,
          align: 'left',
        });

      y += 30;
    }
  }

  // 8) ملاحظات
  if (notes) {
    if (y + 50 > pageHeight - 100) {
      addNewPage();
    }

    y += 15;

    const height = drawWrappedArabic(doc, `ملاحظات: ${notes}`, margin, y, contentWidth, {
      fontSize: 9,
      color: layout.COLORS.muted,
    });

    y += height + 10;
  }

  // 9) التوقيعات (اختياري)
  if (showSignature) {
    if (y + 85 > pageHeight - 90) {
      addNewPage();
    }

    layout.drawSignature(
      doc,
      signatureLeft || 'توقيع المسؤول',
      signatureRight || 'توقيع المدير',
      pageWidth,
      y + 10
    );
  }

  // 10) إطار وتذييل كل الصفحات
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    layout.drawPageFrame(doc, pageWidth, pageHeight);

    const footerText = footer || `نظام إدارة المستندات — ${new Date().toLocaleDateString('ar-EG')}`;

    layout.drawFooter(doc, footerText, contentWidth, pageHeight - 55);

    doc.font('Helvetica')
      .fontSize(8)
      .fillColor(layout.COLORS.muted)
      .text(
        `Page ${i - range.start + 1} of ${range.count}`,
        margin,
        pageHeight - 40,
        { width: contentWidth, align: 'center' }
      );
  }

  // ⚠️ مهم: إنهاء المستند وإرجاع Promise<Buffer>
  doc.end();
  return promise;
};

module.exports = { generateHrReport };