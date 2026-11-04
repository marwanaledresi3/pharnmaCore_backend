const PDFDocument = require('pdfkit');
const { registerFonts } = require('./fonts');

/**
 * يُنشئ PDFDocument + يعيد { doc, buffers, promise }.
 * - buffers: مصفوفة القطع
 * - promise: Promise<Buffer>
 */
function createPage(opts = {}) {
  const doc = new PDFDocument({
    size: opts.size || 'A4',
    margin: opts.margin ?? 30,
    bufferPages: opts.bufferPages ?? true,
    info: opts.info || {},
  });

  const buffers = [];
  const promise = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });

  registerFonts(doc);

  return { doc, promise };
}

module.exports = { createPage };