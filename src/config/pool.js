const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
const isLocal =
  connectionString?.includes('localhost') ||
  connectionString?.includes('127.0.0.1');

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  family: 4,
  max: 20,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000,
  query_timeout: 30000,
  idle_in_transaction_session_timeout: 60000,
});

pool.on('connect', (client) => {
  client.query("SET idle_in_transaction_session_timeout = '60s'").catch(() => {});
  client.query("SET statement_timeout = '30s'").catch(() => {});
});

pool.on('error', (err) => console.error('[pg pool] error:', err.message));

pool.query('SELECT 1')
  .then(() => console.log('[pg pool] ✅ connected'))
  .catch((err) => console.error('[pg pool] ❌', err.message));

module.exports = { pool };
