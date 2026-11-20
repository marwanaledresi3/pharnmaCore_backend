// jobs/assetDepreciationJob.js
const cron = require('node-cron');
const { pool } = require('../config/pool');
const settingsService = require('../services/settingsService');

const log = (msg, meta) => {
  const ts = new Date().toISOString();
  if (meta) console.log(`[assetDepreciationJob][${ts}] ${msg}`, meta);
  else       console.log(`[assetDepreciationJob][${ts}] ${msg}`);
};

const resolveYearMonth = ({ year, month, period_date } = {}) => {
  if (year && month) {
    return { year: Number(year), month: Number(month) };
  }
  const base = period_date ? new Date(period_date) : new Date();
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
  };
};

const run = async (companyId, opts = {}) => {
  const { year, month } = resolveYearMonth(opts);
  const { force = false } = opts;

  const raw = await settingsService.getMany(companyId, ['fa_enabled']);
  const enabled = raw.fa_enabled ?? true;

  if (!enabled && !force) {
    return { companyId, year, month, processed_count: 0, reason: 'disabled' };
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await client.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);

    const { rows } = await client.query(
      `SELECT fn_calculate_depreciation($1::uuid, $2::int, $3::int) AS processed_count`,
      [companyId, year, month]
    );

    await client.query('COMMIT');
    started = false;

    return {
      companyId,
      year,
      month,
      processed_count: Number(rows[0]?.processed_count || 0),
      reason: 'ok',
    };
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
};

const runAll = async (opts = {}) => {
  const { year, month } = resolveYearMonth(opts);
  const { rows: companies } = await pool.query(
    `SELECT id, name FROM companies WHERE is_active = true`
  );

  log(`بدء إهلاك الأصول الثابتة — ${year}/${month} — عدد الشركات: ${companies.length}`);

  const results = [];
  let totalProcessed = 0;

  for (const co of companies) {
    try {
      const r = await run(co.id, { ...opts, year, month });
      totalProcessed += r.processed_count || 0;
      results.push({ company: co.name, ...r });
      if ((r.processed_count || 0) > 0) {
        log(`✅ ${co.name}: تم إهلاك ${r.processed_count} أصل`);
      }
    } catch (err) {
      log(`❌ ${co.name}: ${err.message}`);
      results.push({ company: co.name, error: err.message });
    }
  }

  log(`انتهى — إجمالي الأصول المُهلكة: ${totalProcessed}`);
  return { year, month, totalProcessed, results };
};

let cronTask = null;

const start = () => {
  if (cronTask) {
    log('⚠️ scheduler يعمل بالفعل — تخطّي');
    return;
  }

  const schedule = '30 23 28 * *';
  cronTask = cron.schedule(
    schedule,
    async () => {
      try {
        await runAll();
      } catch (err) {
        log(`❌ خطأ في scheduler: ${err.message}`);
      }
    },
    { timezone: process.env.TZ || 'Asia/Aden' }
  );

  log(`✅ scheduler بدأ — ${schedule} (يوم 28 من كل شهر 23:30)`);
};

const stop = () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log('scheduler متوقف');
  }
};

module.exports = { run, runAll, start, stop };