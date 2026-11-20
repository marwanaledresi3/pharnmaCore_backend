// services/fixedAssets/disposalService.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const FixedAsset = require('../../models/FixedAsset');
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

/**
 * استبعاد أو بيع أصل ثابت وتوليد القيد المحاسبي:
 * - المدين:
 *     - حساب النقد/البنك/الذمم (proceeds_account_id) بقيمة البيع (إن وُجدت)
 *     - مجمع الإهلاك (accumulatedAccountId) بقيمة الإهلاك المتراكم
 *     - خسائر بيع/استبعاد الأصول الثابتة (5181) إذا (قيمة البيع < القيمة الدفترية)
 * - الدائن:
 *     - حساب الأصل الثابت (assetAccountId) بالتكلفة التاريخية
 *     - أرباح بيع الأصول الثابتة (4120) إذا (قيمة البيع > القيمة الدفترية)
 */
const disposeAsset = async (companyId, userId, assetId, payload) => {
  const {
    disposal_date,
    disposal_type = 'sale', // sale | scrap | write_off | donation
    proceeds_amount = 0,
    proceeds_account_id = null,
    reason = null,
    notes = null,
    auto_post = true,
  } = payload;

  const proceeds = round2(proceeds_amount);
  if (!Number.isFinite(proceeds) || proceeds < 0) {
    throw new ApiError(400, 'قيمة البيع/العائد يجب أن تكون 0 أو أكبر');
  }

  const dDate = disposal_date || new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const lockRes = await client.query(
      `SELECT
         fa.*,
         ac.asset_account_id,
         ac.accumulated_depreciation_account_id
       FROM fixed_assets fa
       LEFT JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.id = $1 AND fa.company_id = $2
       FOR UPDATE OF fa`,
      [assetId, companyId]
    );

    const asset = lockRes.rows[0];
    if (!asset) throw new ApiError(404, 'الأصل الثابت غير موجود');
    if (asset.status === 'disposed') {
      throw new ApiError(400, 'الأصل مستبعد مسبقاً');
    }

    if (proceeds > 0 && !proceeds_account_id) {
      throw new ApiError(400, 'proceeds_account_id مطلوب عند تسجيل قيمة بيع/عائد');
    }

    const accMap = await requireActiveAccounts(
      client,
      companyId,
      ['1200', '1221', '4120', '5181'],
      'في استبعاد/بيع أصل ثابت'
    );

    const assetAccountId = asset.asset_account_id || accMap['1200'];
    const accumAccountId = asset.accumulated_depreciation_account_id || accMap['1221'];

    const cost = round2(asset.purchase_cost || 0);
    const accum = round2(asset.accumulated_depreciation || 0);
    const bookValue = round2(cost - accum);
    const gainOrLoss = round2(proceeds - bookValue); // موجب = ربح، سالب = خسارة

    const lines = [];

    if (proceeds > 0) {
      lines.push({
        account_id: proceeds_account_id,
        debit: proceeds,
        credit: 0,
        description: `عائد بيع/استبعاد أصل ${asset.asset_number}`,
      });
    }

    if (accum > 0) {
      lines.push({
        account_id: accumAccountId,
        debit: accum,
        credit: 0,
        description: `إقفال مجمع إهلاك أصل ${asset.asset_number}`,
      });
    }

    if (gainOrLoss < -0.005) {
      lines.push({
        account_id: accMap['5181'],
        debit: round2(Math.abs(gainOrLoss)),
        credit: 0,
        description: `خسارة استبعاد/بيع أصل ${asset.asset_number}`,
      });
    }

    lines.push({
      account_id: assetAccountId,
      debit: 0,
      credit: cost,
      description: `استبعاد تكلفة أصل ثابت ${asset.asset_number} (${asset.name})`,
    });

    if (gainOrLoss > 0.005) {
      lines.push({
        account_id: accMap['4120'],
        debit: 0,
        credit: gainOrLoss,
        description: `ربح بيع أصل ثابت ${asset.asset_number}`,
      });
    }

    assertBalanced(lines, `في استبعاد الأصل ${asset.asset_number}`);

    const disposalNumber = await NumberingService.next(client, companyId, 'asset_disposal', {
      prefix: 'DISP-',
      pad: 4,
    });

    const je = await JournalEntry.create(client, companyId, {
      entry_date: dDate,
      description: `استبعاد/بيع أصل ثابت ${asset.asset_number} (${asset.name}) - ${disposalNumber}`,
      source_type: 'asset_disposal',
      source_id: asset.id,
      created_by: userId,
      lines,
    });

    await verifyJournalEntry(client, je.id, `في استبعاد الأصل ${asset.asset_number}`);
    if (auto_post) {
      await JournalEntry.post(client, companyId, je.id, userId);
    }

    const { rows: dispRows } = await client.query(
      `INSERT INTO asset_disposals (
         company_id, asset_id, disposal_number, disposal_date,
         disposal_type, proceeds_amount, book_value_at_disposal,
         gain_loss_amount, reason, notes, journal_entry_id, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        companyId,
        asset.id,
        disposalNumber,
        dDate,
        disposal_type,
        proceeds,
        bookValue,
        gainOrLoss,
        reason || null,
        notes || null,
        je.id,
        userId,
      ]
    );

    await client.query(
      `UPDATE fixed_assets
       SET status = 'disposed',
           book_value = 0,
           disposed_at = $1,
           updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [dDate, asset.id, companyId]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return {
      disposal: dispRows[0],
      journal_entry_id: je.id,
      asset: await FixedAsset.findById(companyId, asset.id),
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[disposalService.disposeAsset] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

const listDisposals = async (companyId, { asset_id, date_from, date_to } = {}) => {
  const params = [companyId];
  const conds = ['ad.company_id = $1'];

  if (asset_id) {
    params.push(asset_id);
    conds.push(`ad.asset_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conds.push(`ad.disposal_date >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conds.push(`ad.disposal_date <= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
       ad.*,
       fa.asset_number,
       fa.name AS asset_name,
       je.entry_number_display AS journal_entry_number
     FROM asset_disposals ad
     JOIN fixed_assets fa ON fa.id = ad.asset_id
     LEFT JOIN journal_entries je ON je.id = ad.journal_entry_id
     WHERE ${conds.join(' AND ')}
     ORDER BY ad.disposal_date DESC, ad.created_at DESC`,
    params
  );

  return rows;
};

module.exports = {
  disposeAsset,
  listDisposals,
};