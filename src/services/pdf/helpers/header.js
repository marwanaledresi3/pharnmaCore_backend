const { smartFormat } = require('./arabic');
const { COLORS } = require('./colors');
const path = require('path');
const fs = require('fs');

// مسار الشعار المشترك
const SHARED_LOGO_PATH = path.join(__dirname, '..', '..', '..', 'assets','images', 'shared-logo.png');

function drawHeader(doc, { company = {}, pageWidth, startX, title, subtitle, y }) {
  const logoSize = 60;
  const colWidth = (pageWidth - logoSize - 40) / 2;
  


  doc.save();
  doc.rect(startX - 5, y - 5, pageWidth - 55, 75).fill('#f1f5f9');
  doc.restore();

  // ── يمين: اسم الشركة (عربي + إنجليزي) ──
  doc.font('Cairo-Bold').fontSize(9).fillColor(COLORS.primary)
    .text(smartFormat(company.name || 'شركة'), startX + pageWidth - 300, y + 8, {
      width: colWidth, align: 'right',
    });

    // الاسم الإنجليزي
    doc.font('Cairo').fontSize(9).fillColor('#475569')
      .text(smartFormat(company.name_en || 'Company Name'), startX +  15, y + 8, {
        width: colWidth, align: 'left',
      });
  console.log('name_en (base64) failed:', company.name_en);
  let detailY = y + 30;

  // الاسم الإنجليزي
  

  // الهاتف
  if (company.phone) {
    doc.font('Cairo').fontSize(8).fillColor(COLORS.muted)
      .text(smartFormat(`الهاتف: ${company.phone}`), startX + pageWidth - 300, detailY, {
        width: colWidth, align: 'right',
      });
  }
  // الهاتف
  if (company.phone) {
    doc.font('Cairo').fontSize(8).fillColor(COLORS.muted)
      .text(smartFormat(`الهاتف: ${company.phone}`), startX +  15, detailY, {
        width: colWidth, align: 'left',
      });
    detailY += 21;
  }

  // العنوان
  if (company.address) {
    doc.font('Cairo').fontSize(8).fillColor(COLORS.muted)
      .text(smartFormat(company.address), startX + pageWidth - 300, detailY, {
        width: colWidth, align: 'right',
      });
  }
  doc.moveTo(startX, y + 70).lineTo(startX + pageWidth - 65, y + 71)
              .strokeColor('#0f766e').lineWidth(1).stroke();

  // ── وسط: الشعار (رفع مخصص أو مشترك) ──
  const logoX = startX + pageWidth / 2 - logoSize / 2;
  const logoY = y ;

  let logoPath = null;
  if (company.logo_url) {
    // إذا كان data URL (base64)
    if (company.logo_url.startsWith('data:image')) {
      try {
        const base64Data = company.logo_url.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imgBuffer, logoX, logoY, { width: logoSize, height: logoSize });
        logoPath = 'drawn';
      } catch (e) {
        console.error('[pdf] logo (base64) failed:', e.message);
      }
    } else if (fs.existsSync(company.logo_url)) {
      doc.image(company.logo_url, logoX, logoY, { width: logoSize, height: logoSize });
      logoPath = 'drawn';
    }
  }

  // fallback → الشعار المشترك
  if (logoPath !== 'drawn') {
    if (fs.existsSync(SHARED_LOGO_PATH)) {
      doc.image(SHARED_LOGO_PATH, logoX, logoY, { width: logoSize, height: logoSize });
    } else {
      // رسم شعار افتراضي (مربع PC)
      doc.save();
      doc.rect(logoX, logoY, logoSize, logoSize)
        .strokeColor(COLORS.primary).lineWidth(2).stroke();
      doc.rect(logoX + 4, logoY + 4, logoSize - 8, logoSize - 8)
        .strokeColor(COLORS.primary).lineWidth(0.5).stroke();
      doc.font('Cairo-Bold').fontSize(24).fillColor(COLORS.primary)
        .text('PC', logoX, logoY + 14, { width: logoSize, align: 'center' });
      doc.font('Cairo-Bold').fontSize(6).fillColor(COLORS.primary)
        .text('ERP', logoX, logoY + 46, { width: logoSize, align: 'center' });
      doc.restore();
    }
  }

  const boxX = startX + 150;
  const boxY = y + 85;
  const boxW = pageWidth * 0.4;
  const boxH = 30; // ارتفاع المستطيل ليتناسب مع حجم الخط 13

        // رسم الإطار الخارجي للمربع
  doc.save();
  doc.rect(boxX, boxY - 3, boxW, boxH)
    .strokeColor('#0f766e') // لون حدود الإطار (مطابق للون النص)
    .lineWidth(1)           // سمك الخط
    .stroke();
  doc.restore();

        // طباعة النص داخل المربع
  doc.font('Cairo-Bold').fontSize(13).fillColor('#0f766e')
    .text(smartFormat(title), boxX, boxY, {
            width: boxW, align: 'center',
          });

        y += 100;

  // ── يسار: إنجليزي ──
  // doc.font('Cairo-Bold').fontSize(10).fillColor(COLORS.primary)
  //   .text(title || 'PHARMACORE ERP', startX + 20, y, {
  //     width: colWidth, align: 'left',
  //   });
  // if (subtitle) {
  //   doc.font('Cairo').fontSize(8).fillColor(COLORS.muted)
  //     .text(subtitle, startX + 20, y + 18, {
  //       width: colWidth, align: 'left',
  //     });
  // }

  return y + 55;
  
}

module.exports = { drawHeader };