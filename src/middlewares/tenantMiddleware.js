const ApiError = require('../errors/ApiError');

/**
 * يضمن وجود company_id في req.user لكل المسارات المحمية
 * (يكفي استخدام requireCompany من authMiddleware، لكن هذا alias مفيد)
 */
module.exports = require('./authMiddleware').requireCompany;