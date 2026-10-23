const cron = require('node-cron');
const {pool} = require('../config/pool');
const scanner = require('../services/notificationScanner');

/**
 * يفحص كل الشركات النشطة كل ساعة
 */
const start = () => {
  // كل ساعة عند الدقيقة 0
  cron.schedule('0 * * * *', async () => {
    console.log('[notificationJob] Starting scan...');
    try {
      const companies = await pool.query(
        `SELECT id FROM companies WHERE is_active = TRUE`
      );
      for (const c of companies.rows) {
        try {
          const stats = await scanner.scanAll(c.id);
          const total = Object.values(stats).reduce((a, b) => a + b, 0);
          if (total > 0) {
            console.log(`[notificationJob] Company ${c.id}: ${total} notifications`);
          }
        } catch (err) {
          console.error(`[notificationJob] Company ${c.id} failed:`, err.message);
        }
      }
    } catch (err) {
      console.error('[notificationJob] Global error:', err);
    }
  });
  console.log('[notificationJob] Scheduled hourly');
};

module.exports = { start };