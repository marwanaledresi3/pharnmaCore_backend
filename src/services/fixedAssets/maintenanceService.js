// services/fixedAssets/maintenanceService.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const JournalEntry = require('../../models/JournalEntry');
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

const createMaintenance = async (companyId, userId, assetId, payload) => {
  const {
    maintenance_date,
    maintenance_type = 'routine', // routine | repair | upgrade | inspection
    cost = 0,
    is_capitalized = false,
    payment_account_id = null,
    expense_account_id = null,
    supplier_id = null,
    description = null,
    next_due_date = null,
    set_under_maintenance = false,
  } = payload;

  const costNum = round2(cost);
  if (!Number.isFinite(costNum) || costNum < 0) {
    throw new ApiError(400, 'تكلفة الصيانة يجب أن تكون 0 أو أكبر');
  }

  if (!description || !String(description).trim()) {
    throw new ApiError(400, 'وصف الصيانة (description) مطلوب');
  }

  const mDate = maintenance_date || new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const lockRes = await client.query(
      `SELECT fa.*, ac.asset_account_id, ac.depreciation_account_id
       FROM fixed_assets fa
       LEFT JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.id = $1 AND fa.company_id = $2
       FOR UPDATE OF fa`,
      [assetId, companyId]
    );
    const asset = lockRes.rows[0];
    if (!asset) throw new ApiError(404, 'الأصل الثابت غير موجود');
    if (['disposed', 'sold', 'written_off'].includes(asset.status)) {
      throw new ApiError(400, 'لا يمكن تسجيل صيانة لأصل مستبعد أو مباع أو مشطوب');
    }

    let journalEntryId = null;

    if (costNum > 0) {
      if (!payment_account_id) {
        throw new ApiError(400, 'payment_account_id مطلوب عند وجود تكلفة صيانة');
      }

      const accMap = await requireActiveAccounts(
        client,
        companyId,
        ['1211', '5250'],
        'في تسجيل صيانة أصل ثابت'
      );

      const debitAccountId = is_capitalized
        ? (asset.asset_account_id || accMap['1211'])
        : (expense_account_id || asset.depreciation_account_id || accMap['5250']);

      const lines = [
        {
          account_id: debitAccountId,
          debit: costNum,
          credit: 0,
          description: is_capitalized
            ? `رسملة صيانة/تطوير أصل ${asset.asset_number}`
            : `صيانة أصل ثابت ${asset.asset_number}`,
        },
        {
          account_id: payment_account_id,
          debit: 0,
          credit: costNum,
          description: `سداد/التزام صيانة أصل ${asset.asset_number}`,
        },
      ];

      assertBalanced(lines, `في صيانة الأصل ${asset.asset_number}`);

      const je = await JournalEntry.create(client, companyId, {
        entry_date: mDate,
        description: `صيانة أصل ثابت ${asset.asset_number} (${String(description).trim()})`,
        source_type: 'asset_maintenance',
        source_id: asset.id,
        created_by: userId,
        lines,
      });

      await verifyJournalEntry(client, je.id, `في صيانة الأصل ${asset.asset_number}`);
      await JournalEntry.post(client, companyId, je.id, userId);
      journalEntryId = je.id;

      if (is_capitalized) {
        const newCost = round2(Number(asset.purchase_cost || 0) + costNum);
        await client.query(
          `UPDATE fixed_assets
           SET purchase_cost = $1
           WHERE id = $2 AND company_id = $3`,
          [newCost, asset.id, companyId]
        );
      }
    }

    const { rows: mRows } = await client.query(
      `INSERT INTO asset_maintenance (
         company_id, asset_id, maintenance_date, maintenance_type,
         description, cost, is_capitalized, supplier_id,
         journal_entry_id, next_due_date, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        companyId,
        asset.id,
        mDate,
        maintenance_type,
        String(description).trim(),
        costNum,
        Boolean(is_capitalized),
        supplier_id || null,
        journalEntryId,
        next_due_date || null,
        userId,
      ]
    );

    if (set_under_maintenance && asset.status === 'active') {
      await client.query(
        `UPDATE fixed_assets SET status = 'under_maintenance'
         WHERE id = $1 AND company_id = $2`,
        [asset.id, companyId]
      );
    }

    const { rows: updatedAssetRows } = await client.query(
      `SELECT *, (purchase_cost - accumulated_depreciation) AS book_value
       FROM fixed_assets WHERE id = $1 AND company_id = $2`,
      [asset.id, companyId]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      maintenance: mRows[0],
      asset: updatedAssetRows[0],
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[maintenanceService.createMaintenance] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

const listMaintenances = async (companyId, { asset_id, date_from, date_to } = {}) => {
  const params = [companyId];
  const conds = ['am.company_id = $1'];

  if (asset_id) {
    params.push(asset_id);
    conds.push(`am.asset_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conds.push(`am.maintenance_date >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conds.push(`am.maintenance_date <= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
       am.*,
       fa.asset_number,
       fa.name AS asset_name
     FROM asset_maintenance am
     JOIN fixed_assets fa ON fa.id = am.asset_id
     WHERE ${conds.join(' AND ')}
     ORDER BY am.maintenance_date DESC, am.created_at DESC`,
    params
  );

  return rows;
};

module.exports = {
  createMaintenance,
  listMaintenances,
};