// // config/db.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
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