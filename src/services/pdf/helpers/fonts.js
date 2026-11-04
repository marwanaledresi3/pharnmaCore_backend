const path = require('path');
const fs = require('fs');

const FONT_REGULAR = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Cairo-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Cairo-Bold.ttf');

function registerFonts(doc) {
  if (fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD)) {
    doc.registerFont('Cairo', FONT_REGULAR);
    doc.registerFont('Cairo-Bold', FONT_BOLD);
  } else {
    console.warn('[pdf] Cairo font not found — العربية لن تظهر صحيحة');
    doc.registerFont('Cairo', 'Helvetica');
    doc.registerFont('Cairo-Bold', 'Helvetica-Bold');
  }
}

module.exports = { registerFonts, FONT_REGULAR, FONT_BOLD };