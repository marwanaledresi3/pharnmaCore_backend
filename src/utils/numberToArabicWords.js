/**
 * تحويل رقم إلى حروف عربية.
 * يدعم حتى 999,999,999.99
 */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

function below100(n) {
  if (n === 0) return '';
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const ones = n % 10;
  const tens = Math.floor(n / 10);
  return ones ? `${ONES[ones]} و${TENS[tens]}` : TENS[tens];
}

function below1000(n) {
  if (n === 0) return '';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let result = HUNDREDS[hundreds];
  if (rest) {
    result = result ? `${result} و${below100(rest)}` : below100(rest);
  }
  return result;
}

function numToArabicWords(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 0) return 'صفر';

  const intPart = Math.floor(n);
  const decPart = Math.round((n - intPart) * 100);

  if (intPart === 0 && decPart === 0) return 'صفر';

  const parts = [];

  const billions = Math.floor(intPart / 1_000_000_000);
  const millions = Math.floor((intPart % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((intPart % 1_000_000) / 1000);
  const remainder = intPart % 1000;

  if (billions) {
    parts.push(`${below1000(billions)} ${billions === 1 ? 'مليار' : billions === 2 ? 'ملياران' : 'مليار'}`);
  }
  if (millions) {
    parts.push(`${below1000(millions)} ${millions === 1 ? 'مليون' : millions === 2 ? 'مليونان' : 'مليون'}`);
  }
  if (thousands) {
    parts.push(`${below1000(thousands)} ${thousands === 1 ? 'ألف' : thousands === 2 ? 'ألفان' : 'آلاف'}`);
  }
  if (remainder) {
    parts.push(below1000(remainder));
  }

  let result = parts.join(' و');

  if (decPart > 0) {
    result += ` و${below100(decPart)} هللة`;
  }

  return result;
}

module.exports = { numToArabicWords };