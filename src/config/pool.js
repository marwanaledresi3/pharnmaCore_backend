// // config/db.js
const { Pool } = require('pg');
require('dotenv').config();
const { types } = require('pg');
types.setTypeParser(1082, (val) => val);   // date → string
const connectionString = process.env.DATABASE_URL;

// كشف تلقائي: SSL فقط للسحابة
const isLocal =
  connectionString?.includes('localhost') ||
  connectionString?.includes('127.0.0.1');

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  family: 4,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
});

pool.on('error', (err) => {
  console.error('[pg pool] خطأ غير متوقع:', err.message);
});

pool.query('SELECT 1')
  .then(() => console.log('[pg pool] ✅ متصل بقاعدة البيانات'))
  .catch((err) => {
    console.error('[pg pool] ❌ فشل الاتصال:', err.message);
  });

module.exports = { pool };


// helper: نفّذ fn داخل transaction مع ضبط الجلسة
async function withTransaction(session, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (session?.companyId) {
      await client.query(`SELECT set_config('app.company_id', $1, true)`, [String(session.companyId)]);
    }
    if (session?.userId) {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(session.userId)]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports.withTransaction = withTransaction;