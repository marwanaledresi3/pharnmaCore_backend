const { smartFormat } = require('./arabic');
const { COLORS } = require('./colors');

/**
 * تذييل: توقيعان + تاريخ الإنشاء.
 */
function drawFooter(doc, { pageWidth, startX, pageHeight, showSignatures = true }) {
  const sigY = pageHeight - 60;

  if (showSignatures) {
    doc.font('Cairo-Bold').fontSize(10).fillColor(COLORS.primary)
      .text(smartFormat('المحاسب'), startX + 70, sigY + 25, {
        width: 80, align: 'right',
      });
    doc.font('Cairo-Bold').fontSize(8).fillColor(COLORS.muted)
      .text('Accountant', startX + 20, sigY + 27, {
        width: 60, align: 'left',
      });
    doc.moveTo(startX + 20, sigY + 20).lineTo(startX + 160, sigY + 20)
      .strokeColor(COLORS.primary).lineWidth(0.5).dash(1, { space: 2 }).stroke();
    doc.undash();

    doc.font('Cairo-Bold').fontSize(10).fillColor(COLORS.primary)
      .text(smartFormat('المستلم'), startX + pageWidth - 70, sigY + 25, {
        width: 60, align: 'right',
      });
    doc.font('Cairo-Bold').fontSize(8).fillColor(COLORS.muted)
      .text('Reciever Sign', startX + pageWidth - 160, sigY + 27, {
        width: 100, align: 'left',
      });
    doc.moveTo(startX + pageWidth - 160, sigY + 20)
      .lineTo(startX + pageWidth - 20, sigY + 20)
      .strokeColor(COLORS.primary).lineWidth(0.5).dash(1, { space: 2 }).stroke();
    doc.undash();
  }

  doc.font('Cairo').fontSize(7).fillColor(COLORS.muted)
    .text(
      smartFormat(`تم إنشاؤه بواسطة PharmaCore ERP — ${new Date().toLocaleString('ar-SA')}`),
      startX,
      pageHeight - 20,
      { width: pageWidth, align: 'center' }
    );
}

module.exports = { drawFooter };