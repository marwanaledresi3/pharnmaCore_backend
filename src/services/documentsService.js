
const Document = require('../models/document');

/**
 * أنواع المستندات المدعومة
 */
const DOCUMENT_TYPES = Document.DOCUMENT_TYPES;

/**
 * قائمة المستندات الموحدة
 */
const list = async (companyId, filters = {}) => {
  return await Document.list(companyId, filters);
};

/**
 * إحصائيات المستندات
 */
const getStats = async (companyId, filters = {}) => {
  return await Document.getStats(companyId, filters);
};

module.exports = {
  list,
  getStats,
  DOCUMENT_TYPES,
};
