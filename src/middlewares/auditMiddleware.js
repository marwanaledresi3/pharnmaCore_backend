const {pool} = require('../config/pool');

/**
 * يستخدم بعد الاستجابة لتسجيل العمليات
 * الاستخدام: router.post('/', authenticate, auditMiddleware('sales_order', 'insert'), ctrl.create)
 */
const auditMiddleware = (tableName, action) => async (req, res, next) => {
  res.on('finish', async () => {
    if (!req.user?.company_id) return;
    if (res.statusCode >= 400) return;

    try {
      const recordId = res.locals.recordId || null;
      await pool.query(
        `INSERT INTO audit_logs (company_id, user_id, action, table_name, record_id, new_data, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.company_id,
          req.user.id,
          action,
          tableName,
          recordId,
          req.body ? JSON.stringify(req.body) : null,
          req.ip,
        ]
      );
    } catch (e) {
      console.error('Audit log failed:', e.message);
    }
  });
  next();
};

module.exports = auditMiddleware;