

const fs = require('fs');
const path = require('path');
const { smartFormat } = require('../helpers/arabic');

const fontPath = path.join(
  __dirname, '..', '..', '..', 'assets', 'fonts', 'Cairo-Regular.ttf'
);

const SHARED_LOGO_PATH = path.join(
  __dirname, '..', '..', '..', 'assets', 'images', 'shared-logo.png'
);
const FONT_REGULAR = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Cairo-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Cairo-Bold.ttf');
const margin = 40;
const COLORS = {
  primary: '#17365D',
  border: '#CCCCCC',
  text: '#000000',
  muted: '#777777',
  light: '#E8EEF5',
  white: '#FFFFFF',
};

function setupDocument(doc) {
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Arabic font not found: ${fontPath}`);
  }

  doc.registerFont('Arabic', fontPath);

  return {
    pageWidth: doc.page.width,
    pageHeight: doc.page.height,
    margin,
    contentWidth: doc.page.width - margin * 2,
  };
}

function reverseWords(text) {
  return String(text ?? '').trim().split(/\s+/).reverse().join(' ');
}

function arabic(doc, text, x, y, width, options = {}) {
  doc.font('Arabic')
    .fontSize(options.fontSize || 10)
    .fillColor(options.color || COLORS.text)
    .text(smartFormat(text), x, y, {
      width,
      align: options.align || 'right',
      lineBreak: options.lineBreak ?? true,
    });
}

function english(doc, text, x, y, width, options = {}) {
  doc.font('Helvetica')
    .fontSize(options.fontSize || 10)
    .fillColor(options.color || COLORS.text)
    .text(String(text ?? ''), x, y, {
      width,
      align: options.align || 'left',
    });
}

function drawPageFrame(doc, pageWidth, pageHeight) {
  doc.save()
    .lineWidth(1)
    .strokeColor('#333333')
    .rect(20, 20, pageWidth - 40, pageHeight - 40)
    .stroke()
    .restore();
}


function drawCompanyHeader(doc, company, contentWidth) {
  const startY = 40;
  const rowHeight = 20;

  const englishWidth = 190;
  const logoWidth = 135;
  const arabicWidth = contentWidth - englishWidth - logoWidth;

  const englishX = margin;
  const logoX = englishX + englishWidth;
  const arabicX = logoX + logoWidth;

  const englishData = [
    company.nameEn,
    company.addressEn,
    company.phoneEn,
  ];

  const arabicData = [
    company.nameAr,
    company.addressAr,
    company.phoneAr,
  ];

  for (let i = 0; i < 3; i++) {
    const y = startY + i * rowHeight;

    english(
      doc,
      englishData[i],
      englishX + 8,
      y + 5,
      englishWidth - 16
    );

    arabic(
      doc,
      arabicData[i],
      arabicX + 8,
      y + 5,
      arabicWidth - 16
    );
  }

  // ═══════════════════════════════════════════
  // الشعار: شعار الشركة → الشعار المشترك → افتراضي
  // ═══════════════════════════════════════════
  drawCompanyLogo(doc, company, logoX, startY);

  const y = startY + rowHeight * 3 + 15;

  doc.moveTo(margin, y)
    .lineTo(doc.page.width - margin, y)
    .lineWidth(1.5)
    .stroke();

  return y;
}


/**
 * يرسم شعار الشركة أو الشعار المشترك.
 * - يدعم: base64 data URL، مسار محلي، Buffer (إن مررته في company._logoBuffer).
 * - fallback: الشعار المشترك.
 * - fallback أخير: مستطيل افتراضي "PC ERP".
 */
function drawCompanyLogo(doc, company, logoX, startY) {
  const logoSize = 100;
  const logoY = startY - 15;
  const imgX = logoX + 17;

  const drawImage = (source, label) => {
    try {
      doc.image(source, imgX, logoY, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
      return true;
    } catch (err) {
      console.warn(`[pdf] logo (${label}) failed:`, err.message);
      return false;
    }
  };

  // 1) Buffer مُمرَّر مسبقاً (من resolveLogoAsync)
  if (company._logoBuffer && Buffer.isBuffer(company._logoBuffer)) {
    if (drawImage(company._logoBuffer, 'buffer')) return;
  }

  // 2) company.logo_url — base64 أو مسار محلي
  const logoUrl = company.logo_url || company.logoUrl;

  if (logoUrl && typeof logoUrl === 'string') {
    // 2a) base64 data URL
    if (logoUrl.startsWith('data:image')) {
      try {
        const base64 = logoUrl.split(',')[1];
        if (base64) {
          const buf = Buffer.from(base64, 'base64');
          if (drawImage(buf, 'base64')) return;
        }
      } catch (err) {
        console.warn('[pdf] logo (base64) failed:', err.message);
      }
    }
    // 2b) مسار محلي
    else if (!/^https?:\/\//i.test(logoUrl) && fs.existsSync(logoUrl)) {
      if (drawImage(logoUrl, 'local-path')) return;
    }
    // 2c) URL (http/https) — لا يمكن تحميله sync، نتجاهله
    else if (/^https?:\/\//i.test(logoUrl)) {
      // لو لم يُحمَّل مسبقاً عبر resolveLogoAsync → تجاهل
      console.warn(
        '[pdf] company.logo_url is a remote URL — use resolveLogoAsync() to preload it as Buffer'
      );
    }
  }

  // 3) الشعار المشترك
  if (fs.existsSync(SHARED_LOGO_PATH)) {
    if (drawImage(SHARED_LOGO_PATH, 'shared')) return;
  }

  // 4) fallback أخير — مستطيل "PC ERP"
  doc.save();
  doc
    .rect(imgX, logoY, logoSize, logoSize)
    .strokeColor(COLORS.primary)
    .lineWidth(2)
    .stroke();
  doc
    .rect(imgX + 4, logoY + 4, logoSize - 8, logoSize - 8)
    .strokeColor(COLORS.primary)
    .lineWidth(0.5)
    .stroke();
  doc
    .font('Arabic')
    .fontSize(22)
    .fillColor(COLORS.primary)
    .text('PC', imgX, logoY + 28, { width: logoSize, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.primary)
    .text('ERP', imgX, logoY + 55, { width: logoSize, align: 'center' });
  doc.restore();
}


function drawDocumentTitle(doc, titleAr, titleEn, contentWidth, y) {
  y += 10;

  arabic(doc, titleAr, margin-11, y, contentWidth, {
    fontSize: 23,
    color: COLORS.primary,
    align: 'center',
  });

  y += 35;

  return y;
}


function drawTableHeader(doc, columns, x, y, tableWidth, rowHeight = 35) {
  doc.save()
    .rect(x, y, tableWidth, rowHeight)
    .fill(COLORS.primary);

  let columnX = x + tableWidth;

  for (const column of columns) {
    columnX -= column.width;

    doc.font('Arabic')
      .fontSize(9)
      .fillColor(COLORS.white)
      .text(column.title, columnX + 2, y + 11, {
        width: column.width - 4,
        align: 'center',
      });
  }

  doc.restore();
}


function drawTableRow(doc, columns, values, x, y, rowHeight = 35) {
  const tableWidth = columns.reduce(
    (sum, column) => sum + column.width,
    0
  );

  let columnX = x + tableWidth;

  for (const column of columns) {
    columnX -= column.width;

    const value = values[column.key] ?? '';

    if (column.type === 'arabic') {
      arabic(
        doc,
        value,
        columnX + 3,
        y + 11,
        column.width - 6,
        {
          fontSize: 9,
          align: 'center',
        }
      );
    } else {
      doc.font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.text)
        .text(String(value), columnX + 2, y + 11, {
          width: column.width - 4,
          align: 'center',
        });
    }
  }

  doc.moveTo(x, y + rowHeight)
    .lineTo(x + tableWidth, y + rowHeight)
    .lineWidth(0.5)
    .strokeColor(COLORS.border)
    .stroke();
}

function drawSignature(doc, leftTitle, rightTitle, pageWidth, y) {
  arabic(doc, leftTitle, margin, y, 180, { fontSize: 13 });

  arabic(
    doc,
    rightTitle,
    pageWidth - margin - 180,
    y,
    180,
    { fontSize: 13 }
  );

  const signatureY = y + 55;

  doc.moveTo(margin, signatureY)
    .lineTo(margin + 180, signatureY)
    .lineWidth(0.8)
    .stroke();

  doc.moveTo(pageWidth - margin - 180, signatureY)
    .lineTo(pageWidth - margin, signatureY)
    .stroke();

  return signatureY;
}

function drawFooter(doc, text, contentWidth, y) {
  arabic(doc, text, margin, y, contentWidth, {
    fontSize: 10,
    color: COLORS.muted,
    align: 'center',
  });
}

module.exports = {
  setupDocument,
  arabic,
  english,
  drawPageFrame,
  drawCompanyHeader,
  drawCompanyLogo,          // ← جديد (اختياري للاستخدام الخارجي)
  drawDocumentTitle,
  drawTableHeader,
  drawTableRow,
  drawSignature,
  drawFooter,
  margin,
  COLORS,
};
