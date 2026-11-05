/**
 * تنسيق التاريخ حسب توقيت اليمن
 * الناتج: DD/MM/YYYY
 */
function formatDate(date) {
  if (!date) return '—';

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Aden',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsedDate);
}

module.exports = {
  formatDate,
};