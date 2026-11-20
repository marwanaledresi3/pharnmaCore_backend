// services/fixedAssets/depreciationService.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const JournalEntry = require('../../models/JournalEntry');
const NumberingService = require('../numberingService');
const {
  round2,
  assertBalanced,
  requireActiveAccounts,
  verifyJournalEntry,
} = require('../journalHelper');

async function setAuditContext(client, companyId, userId) {
  await client.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);
  if (userId) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  }
}

function calculateMonthlyDepreciationAmount(asset, monthsElapsed = 0) {
  const cost = Number(asset.purchase_cost || 0);
  const salvage = Number(asset.salvage_value || 0);
  const accum = Number(asset.accumulated_depreciation || 0);
  const bookValue = round2(cost - accum);
  const maxDepreciable = round2(Math.max(0, bookValue - salvage));

  if (maxDepreciable <= 0) return 0;

  const lifeYears = Number(asset.useful_life_years || 0);
  if (lifeYears <= 0) return 0;

  if (asset.depreciation_method === 'declining_balance') {
    const ratePerYear = 2 / lifeYears;
    const monthlyRate = ratePerYear / 12;
    const raw = round2(bookValue * monthlyRate);
    return round2(Math.min(raw, maxDepreciable));
  }

  // straight_line (القسط الثابت)
  const totalMonths = lifeYears * 12;
  const remainingMonths = Math.max(1, totalMonths - monthsElapsed);
  const raw = round2(maxDepreciable / remainingMonths);
  return round2(Math.min(raw, maxDepreciable));
}

const runDepreciationForPeriod = async (companyId, userId, { period_date, auto_post = true } = {}) => {
  const targetDate = period_date || new Date().toISOString().slice(0, 10);
  const periodMonth = targetDate.slice(0, 7); // YYYY-MM

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const accMap = await requireActiveAccounts(
      client,
      companyId,
      ['1221', '5250'],
      'في تشغيل إهلاك الأصول الثابتة'
    );

    const { rows: assets } = await client.query(
      `SELECT
         fa.*,
         ac.depreciation_expense_account_id,
         ac.accumulated_depreciation_account_id
       FROM fixed_assets fa
       LEFT JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.company_id = $1
         AND fa.status = 'active'
         AND fa.depreciation_start_date <= $2::date
       FOR UPDATE OF fa`,
      [companyId, targetDate]
    );

    const processed = [];

    for (const asset of assets) {
      // منع تكرار إهلاك نفس الأصل لنفس الشهر
      const dup = await client.query(
        `SELECT id FROM asset_depreciations
         WHERE company_id = $1
           AND asset_id = $2
           AND to_char(depreciation_date, 'YYYY-MM') = $3
         LIMIT 1`,
        [companyId, asset.id, periodMonth]
      );
      if (dup.rowCount) continue;

      const countRes = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM asset_depreciations WHERE asset_id = $1`,
        [asset.id]
      );
      const monthsElapsed = countRes.rows[0]?.cnt || 0;

      const depAmount = calculateMonthlyDepreciationAmount(asset, monthsElapsed);
      if (depAmount <= 0) continue;

      const newAccum = round2(Number(asset.accumulated_depreciation || 0) + depAmount);
      const newBookValue = round2(Number(asset.purchase_cost || 0) - newAccum);

      const expenseAccountId = asset.depreciation_expense_account_id || accMap['5250'];
      const accumAccountId = asset.accumulated_depreciation_account_id || accMap['1221'];

      const depNumber = await NumberingService.next(client, companyId, 'asset_depreciation', {
        prefix: 'DEP-',
        pad: 4,
      });

      const lines = [
        {
          account_id: expenseAccountId,
          debit: depAmount,
          credit: 0,
          description: `مصروف إهلاك ${asset.asset_number} (${asset.name}) - ${periodMonth}`,
        },
        {
          account_id: accumAccountId,
          debit: 0,
          credit: depAmount,
          description: `مجمع إهلاك ${asset.asset_number} (${asset.name}) - ${periodMonth}`,
        },
      ];

      assertBalanced(lines, `في إهلاك الأصل ${asset.asset_number}`);

      const je = await JournalEntry.create(client, companyId, {
        entry_date: targetDate,
        description: `إهلاك أصل ثابت ${asset.asset_number} (${asset.name}) - ${periodMonth}`,
        source_type: 'depreciation',
        source_id: asset.id,
        created_by: userId,
        lines,
      });

      await verifyJournalEntry(client, je.id, `في إهلاك الأصل ${asset.asset_number}`);
      if (auto_post) {
        await JournalEntry.post(client, companyId, je.id, userId);
      }

      const depIns = await client.query(
        `INSERT INTO asset_depreciations (
           company_id, asset_id, depreciation_number, depreciation_date,
           amount, accumulated_after, book_value_after, journal_entry_id, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          companyId,
          asset.id,
          depNumber,
          targetDate,
          depAmount,
          newAccum,
          newBookValue,
          je.id,
          userId,
        ]
      );

      const nextStatus = newBookValue <= Number(asset.salvage_value || 0) + 0.005
        ? 'fully_depreciated'
        : asset.status;

      await client.query(
        `UPDATE fixed_assets
         SET accumulated_depreciation = $1,
             book_value = $2,
             status = $3,
             updated_at = NOW()
         WHERE id = $4 AND company_id = $5`,
        [newAccum, newBookValue, nextStatus, asset.id, companyId]
      );

      processed.push({
        asset_id: asset.id,
        asset_number: asset.asset_number,
        depreciation: depIns.rows[0],
        journal_entry_id: je.id,
      });
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      period_date: targetDate,
      processed_count: processed.length,
      items: processed,
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[depreciationService.runDepreciationForPeriod] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

const listDepreciations = async (companyId, { asset_id, date_from, date_to } = {}) => {
  const params = [companyId];
  const conds = ['ad.company_id = $1'];

  if (asset_id) {
    params.push(asset_id);
    conds.push(`ad.asset_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conds.push(`ad.depreciation_date >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conds.push(`ad.depreciation_date <= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
       ad.*,
       fa.asset_number,
       fa.name AS asset_name,
       je.entry_number_display AS journal_entry_number
     FROM asset_depreciations ad
     JOIN fixed_assets fa ON fa.id = ad.asset_id
     LEFT JOIN journal_entries je ON je.id = ad.journal_entry_id
     WHERE ${conds.join(' AND ')}
     ORDER BY ad.depreciation_date DESC, ad.created_at DESC`,
    params
  );

  return rows;
};

module.exports = {
  runDepreciationForPeriod,
  listDepreciations,
};