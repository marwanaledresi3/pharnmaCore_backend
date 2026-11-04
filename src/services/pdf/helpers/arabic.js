
function isArabicText(s) {
  return /[\u0600-\u06FF]/.test(String(s));
}

function formatArabic(text) {
  if (text == null || text === '') return '';

  return String(text)
    .split(' ')
    .reverse()
    .join('  ');
}

function smartFormat(text) {
  if (text == null) return '';

  const s = String(text);

  if (!isArabicText(s)) return s;

  return formatArabic(s);
}

module.exports = {
  formatArabic,
  smartFormat,
  isArabicText,
};
