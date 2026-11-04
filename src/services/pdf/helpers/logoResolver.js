/**
 * يحمّل شعار الشركة من URL (Cloudinary) إلى Buffer.
 * استخدمها قبل استدعاء أي قالب PDF:
 *
 *   const buf = await resolveLogoAsync(company.logo_url);
 *   await PdfService.generateInvoice({ company: { ...company, _logoBuffer: buf } });
 */
async function resolveLogoAsync(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;

  // base64 → مباشرة
  if (logoUrl.startsWith('data:image')) {
    try {
      const base64 = logoUrl.split(',')[1];
      return base64 ? Buffer.from(base64, 'base64') : null;
    } catch {
      return null;
    }
  }

  // مسار محلي → اقرأه
  if (!/^https?:\/\//i.test(logoUrl) && fs.existsSync(logoUrl)) {
    return fs.readFileSync(logoUrl);
  }

  // URL → اجلبه
  if (/^https?:\/\//i.test(logoUrl)) {
    try {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      console.warn('[pdf] resolveLogoAsync failed:', err.message);
      return null;
    }
  }

  return null;
}
module.exports = { resolveLogoAsync };