const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const FONT_REGULAR = path.join(__dirname, '..', 'assets', 'fonts', 'Amiri-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'Amiri-Bold.ttf');

// تحقق من وجود الخطوط
if (!fs.existsSync(FONT_REGULAR)) {
  console.warn('[pdf] خط Amiri-Regular.ttf غير موجود — سيستخدم Helvetica (لا يدعم العربية)');
}
function formatArabicText(text) {
  return text.split(' ').reverse().join('  ');
}
/**
 * خدمة توليد PDF موحّدة لكل المستندات.
 * - رأس موحّد (شعار + اسم الشركة + رقم/تاريخ المستند)
 * - جدول بنود
 * - مجاميع + مبلغ بالحروف
 * - توقيعات + QR (اختياري)
 */
class PdfService {
  /**
   * يُنشئ PDF ويُعيده كـ Buffer.
   *
   * @param {object} opts
   * @param {object} opts.company       — { name, tax_number, address, phone, logo_url }
   * @param {string} opts.docType       — 'sale_invoice' | 'purchase_invoice' | 'sale_return' | 'purchase_return' | 'receipt_voucher' | 'payment_voucher' | 'delivery_note' | 'statement' | 'trial_balance' | 'report'
   * @param {string} opts.docNumber     — INV-00001
   * @param {string} opts.docDate       — '2026-10-30'
   * @param {string} opts.partyTitle    — 'العميل' | 'المورد'
   * @param {object} opts.party         — { name, phone, email, address, tax_number }
   * @param {Array} opts.items          — [{ name, sku, quantity, unit_price, discount, tax, total }]
   * @param {object} opts.summary       — [{ label, value, isTotal }]
   * @param {string} opts.notes         — ملاحظات إضافية
   * @param {string} opts.currencyCode  — 'YER'
   * @param {string} opts.qrData        — (اختياري) نص QR
   * @param {string} opts.extraInfo     — (اختياري) حقول إضافية كـ multiline
   * @returns {Promise<Buffer>}
   */
  static async generate(opts) {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          bufferPages: true,
          info: {
            Title: `${this.docTypeLabel(opts.docType)} - ${opts.docNumber}`,
            Author: opts.company?.name || 'PharmaCore ERP',
            Subject: this.docTypeLabel(opts.docType),
            CreationDate: new Date(),
          },
        });

        const buffers = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // تسجيل الخطوط
        if (fs.existsSync(FONT_REGULAR)) {
          doc.registerFont('Arabic', FONT_REGULAR);
          doc.registerFont('Arabic-Bold', FONT_BOLD);
        } else {
          doc.registerFont('Arabic', 'Helvetica');
          doc.registerFont('Arabic-Bold', 'Helvetica-Bold');
        }

        // ميتاداتا
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const startX = doc.page.margins.left;
        let y = doc.page.margins.top;

        // ═══════════════════════════════════════════
        // الرأس الموحّد
        // ═══════════════════════════════════════════
        y = this.drawHeader(doc, opts, startX, y, pageWidth);

        // ═══════════════════════════════════════════
        // بيانات الطرف
        // ═══════════════════════════════════════════
        y = this.drawPartyInfo(doc, opts, startX, y, pageWidth);

        // ═══════════════════════════════════════════
        // معلومات إضافية (اختياري)
        // ═══════════════════════════════════════════
        if (opts.extraInfo) {
          y = this.drawExtraInfo(doc, opts, startX, y, pageWidth);
        }

        // ═══════════════════════════════════════════
        // جدول البنود
        // ═══════════════════════════════════════════
        if (opts.items && opts.items.length > 0) {
          y = await this.drawItemsTable(doc, opts, startX, y, pageWidth);
        }

        // ═══════════════════════════════════════════
        // المجاميع
        // ═══════════════════════════════════════════
        y = this.drawSummary(doc, opts, startX, y, pageWidth);

        // ═══════════════════════════════════════════
        // المبلغ بالحروف
        // ═══════════════════════════════════════════
        if (opts.amountInWords) {
          y = this.drawAmountInWords(doc, opts, startX, y, pageWidth);
        }

        // ═══════════════════════════════════════════
        // ملاحظات
        // ═══════════════════════════════════════════
        if (opts.notes) {
          y = this.drawNotes(doc, opts, startX, y, pageWidth);
        }

        // ═══════════════════════════════════════════
        // QR (اختياري)
        // ═══════════════════════════════════════════
        if (opts.qrData) {
          y = await this.drawQr(doc, opts, startX, y, pageWidth);
        }

        // ═══════════════════════════════════════════
        // التوقيعات
        // ═══════════════════════════════════════════
        this.drawSignatures(doc, opts, startX, pageWidth);

        // ═══════════════════════════════════════════
        // التذييل
        // ═══════════════════════════════════════════
        this.drawFooter(doc, opts);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ═══════════════════════════════════════════
  // الأجزاء
  // ═══════════════════════════════════════════

  static docTypeLabel(docType) {
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
    return labels[docType] || 'مستند';
  }

  static drawHeader(doc, opts, x, y, width) {
    const startY = y;
     const topY = doc.y;
      const columnWidth = 175;
       const margin = 40;
        const pageWidth = doc.page.width;

    // خلفية خفيفة
    doc.save();
    doc.rect(x, y, width, 60).fill('#f1f5f9');
    doc.restore();

    // اسم الشركة (يمين)
    doc.font('Arabic-Bold').fontSize(18).fillColor('#1e293b')
      .text(formatArabicText(opts.company?.name) || 'PharmaCore', pageWidth - margin - columnWidth,topY  * 17, {
        width: width * 0.6,
        align: 'right',
      });

    // تفاصيل الشركة
    let detailY = y + 30;
    if (opts.company?.tax_number) {
      doc.font('Arabic').fontSize(9).fillColor('#64748b')
        .text(`الرقم الضريبي: ${opts.company.tax_number}`, x + width - 10, detailY, { width: width * 0.6, align: 'right' });
      detailY += 12;
    }
    if (opts.company?.phone) {
      doc.font('Arabic').fontSize(9).fillColor('#64748b')
        .text(`الهاتف: ${opts.company.phone}`, x + width - 10, detailY, { width: width * 0.6, align: 'right' });
      detailY += 12;
    }
    if (opts.company?.address) {
      doc.font('Arabic').fontSize(9).fillColor('#64748b')
        .text(opts.company.address, x + width - 10, detailY, { width: width * 0.6, align: 'right' });
    }

    // نوع المستند + رقمه (يسار)
    doc.font('Arabic-Bold').fontSize(16).fillColor('#0f766e')
      .text(this.docTypeLabel(opts.docType), x + 10, y + 8, {
        width: width * 0.35,
        align: 'left',
      });

    doc.font('Arabic').fontSize(10).fillColor('#334155')
      .text(`رقم: ${opts.docNumber}`, x + 10, y + 30, { width: width * 0.35, align: 'left' });

    doc.font('Arabic').fontSize(10).fillColor('#334155')
      .text(`التاريخ: ${opts.docDate}`, x + 10, y + 45, { width: width * 0.35, align: 'left' });

    // خط فاصل
    doc.moveTo(x, startY + 62).lineTo(x + width, startY + 62)
      .strokeColor('#cbd5e1').lineWidth(1).stroke();

    return startY + 72;
  }

  static drawPartyInfo(doc, opts, x, y, width) {
    if (!opts.party) return y;

    // خلفية
    doc.save();
    doc.rect(x, y, width, 50).fill('#f8fafc');
    doc.restore();

    // الطرف
    doc.font('Arabic-Bold').fontSize(11).fillColor('#1e293b')
      .text(`${opts.partyTitle || 'الطرف'}: ${opts.party.name || '—'}`, x + 10, y + 8, {
        width: width - 20,
        align: 'right',
      });

    // التفاصيل
    const details = [];
    if ((opts.party.phone)) details.push(`الهاتف: ${opts.party.phone}`);
    if (opts.party.tax_number) details.push(`الرقم الضريبي: ${opts.party.tax_number}`);
    if ((opts.party.email)) details.push(`البريد: ${opts.party.email}`);
    if ((opts.party.address)) details.push(`العنوان: ${opts.party.address}`);

    if (details.length > 0) {
      doc.font('Arabic').fontSize(9).fillColor('#475569')
        .text(details.join('  |  '), x + 10, y + 25, {
          width: width - 20,
          align: 'right',
        });
    }

    return y + 58;
  }

  static drawExtraInfo(doc, opts, x, y, width) {
    // حقول إضافية (key: value)
    const entries = Object.entries(opts.extraInfo).filter(([, v]) => v != null);
    if (entries.length === 0) return y;

    for (const [key, value] of entries) {
      doc.font('Arabic-Bold').fontSize(9).fillColor('#334155')
        .text(`${key}: `, x + width - 10, y, { width: width * 0.3, align: 'right', continued: true });
      doc.font('Arabic').fontSize(9).fillColor('#475569')
        .text(String(value), { width: width * 0.6, align: 'right' });
      y += 14;
    }

    return y + 5;
  }

  static async drawItemsTable(doc, opts, x, y, width) {
    const cols = {
      index: 22,
      name: 180,
      sku: 55,
      qty: 40,
      price: 55,
      tax: 40,
      total: 65,
    };
    const rowHeight = 22;
    const headerHeight = 26;

    const totalColsWidth = Object.values(cols).reduce((s, w) => s + w, 0);
    const scale = width / totalColsWidth;
    const cw = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v * scale]));

    // رأس الجدول
    doc.save();
    doc.rect(x, y, width, headerHeight).fill('#0f766e');
    doc.restore();

    doc.font('Arabic-Bold').fontSize(9).fillColor('#ffffff');

    let cursor = x + width;
    const headerY = y + 8;
    const headers = [
      { key: 'index', label: '#', align: 'center' },
      { key: 'name', label: 'الصنف', align: 'right' },
      { key: 'sku', label: 'SKU', align: 'center' },
      { key: 'qty', label: 'الكمية', align: 'center' },
      { key: 'price', label: 'السعر', align: 'left' },
      { key: 'tax', label: 'الضريبة', align: 'center' },
      { key: 'total', label: 'الإجمالي', align: 'left' },
    ];

    for (const h of headers) {
      const cwWidth = cw[h.key];
      cursor -= cwWidth;
      doc.text(h.label, cursor + 4, headerY, { width: cwWidth - 8, align: h.align });
    }

    y += headerHeight;

    // الصفوف
    doc.font('Arabic').fontSize(8.5);

    for (let i = 0; i < opts.items.length; i++) {
      const item = opts.items[i];
      const isEven = i % 2 === 0;

      // خلفية متناوبة
      if (isEven) {
        doc.save();
        doc.rect(x, y, width, rowHeight).fill('#f8fafc');
        doc.restore();
      }

      cursor = x + width;
      const cellY = y + 6;

      // index
      cursor -= cw.index;
      doc.fillColor('#64748b').text(String(i + 1), cursor + 4, cellY, { width: cw.index - 8, align: 'center' });

      // name
      cursor -= cw.name;
      doc.fillColor('#1e293b').text(item.name || '—', cursor + 4, cellY, {
        width: cw.name - 8,
        align: 'right',
        ellipsis: true,
      });

      // sku
      cursor -= cw.sku;
      doc.fillColor('#64748b').text(item.sku || '—', cursor + 4, cellY, { width: cw.sku - 8, align: 'center', ellipsis: true });

      // qty
      cursor -= cw.qty;
      doc.fillColor('#1e293b').text(String(item.quantity ?? 0), cursor + 4, cellY, { width: cw.qty - 8, align: 'center' });

      // price
      cursor -= cw.price;
      doc.fillColor('#1e293b').text(this.fmtMoney(item.unit_price), cursor + 4, cellY, { width: cw.price - 8, align: 'left' });

      // tax
      cursor -= cw.tax;
      doc.fillColor('#64748b').text(item.tax || '—', cursor + 4, cellY, { width: cw.tax - 8, align: 'center' });

      // total
      cursor -= cw.total;
      doc.fillColor('#1e293b').text(this.fmtMoney(item.total), cursor + 4, cellY, { width: cw.total - 8, align: 'left' });

      // خط فاصل
      doc.moveTo(x, y + rowHeight).lineTo(x + width, y + rowHeight)
        .strokeColor('#e2e8f0').lineWidth(0.5).stroke();

      y += rowHeight;

      // صفحة جديدة إذا لزم
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    }

    return y + 8;
  }

  static drawSummary(doc, opts, x, y, width) {
    if (!opts.summary || opts.summary.length === 0) return y;

    const boxWidth = 250;
    const boxX = x + 10;
    const startY = y;

    // خلفية
    doc.save();
    doc.rect(boxX, startY, boxWidth, opts.summary.length * 20 + 10).fill('#f1f5f9');
    doc.restore();

    let currentY = startY + 8;

    for (const row of opts.summary) {
      const isTotal = row.isTotal;
      doc.font(isTotal ? 'Arabic-Bold' : 'Arabic').fontSize(isTotal ? 10.5 : 9)
        .fillColor(isTotal ? '#0f766e' : '#334155');

      doc.text(row.label, boxX + 8, currentY, { width: boxWidth - 100, align: 'right' });

      doc.text(this.fmtMoney(row.value) + ' ' + (opts.currencyCode || ''), boxX + 8, currentY, {
        width: boxWidth - 16,
        align: 'left',
      });

      currentY += isTotal ? 22 : 20;
    }

    return currentY + 8;
  }

  static drawAmountInWords(doc, opts, x, y, width) {
    doc.font('Arabic-Bold').fontSize(9).fillColor('#1e293b')
      .text('المبلغ بالحروف: ', x + 10, y, { width: 100, align: 'right', continued: true });
    doc.font('Arabic').fontSize(9).fillColor('#475569')
      .text(opts.amountInWords, { width: width - 120, align: 'right' });

    return y + 20;
  }

  static drawNotes(doc, opts, x, y, width) {
    doc.font('Arabic-Bold').fontSize(9).fillColor('#1e293b')
      .text('ملاحظات: ', x + 10, y, { width: 100, align: 'right', continued: true });
    doc.font('Arabic').fontSize(9).fillColor('#475569')
      .text(opts.notes, { width: width - 120, align: 'right' });

    return y + 24;
  }

  static async drawQr(doc, opts, x, y, width) {
    try {
      const qrBuffer = await QRCode.toBuffer(opts.qrData, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 100,
      });

      const qrSize = 90;
      doc.image(qrBuffer, x + width - qrSize - 10, y, { width: qrSize, height: qrSize });

      doc.font('Arabic').fontSize(7).fillColor('#64748b')
        .text('امسح الرمز للتحقق', x + width - qrSize - 10, y + qrSize + 2, { width: qrSize, align: 'center' });

      return y + qrSize + 15;
    } catch (err) {
      console.error('[pdf] QR failed:', err.message);
      return y;
    }
  }

  static drawSignatures(doc, opts, x, width) {
    const y = doc.page.height - 130;

    doc.font('Arabic').fontSize(9).fillColor('#334155');

    doc.text('توقيع المُصدِر:', x + width - 180, y, { width: 170, align: 'right' });
    doc.moveTo(x + width - 180, y + 30).lineTo(x + width - 10, y + 30)
      .strokeColor('#94a3b8').lineWidth(0.5).stroke();

    doc.text('توقيع المستلم:', x + 10, y, { width: 170, align: 'right' });
    doc.moveTo(x + 10, y + 30).lineTo(x + 180, y + 30)
      .strokeColor('#94a3b8').lineWidth(0.5).stroke();
  }

  static drawFooter(doc, opts) {
    const y = doc.page.height - 40;
    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.moveTo(x, y - 5).lineTo(x + width, y - 5)
      .strokeColor('#cbd5e1').lineWidth(0.5).stroke();

    doc.font('Arabic').fontSize(7).fillColor('#94a3b8')
      .text(
        `تم إنشاؤه بواسطة PharmaCore ERP — ${new Date().toLocaleString('ar-SA')}`,
        x,
        y,
        { width, align: 'center' }
      );
  }

  static fmtMoney(n) {
    return Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

module.exports = PdfService;