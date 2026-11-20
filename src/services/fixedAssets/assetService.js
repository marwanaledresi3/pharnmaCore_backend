// services/fixedAssets/assetService.js
const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const AssetCategory = require('../../models/AssetCategory');
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

const createAsset = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    if (!payload.category_id) {
      throw new ApiError(400, 'تصنيف الأصل (category_id) مطلوب');
    }

    const catRes = await client.query(
      `SELECT * FROM asset_categories WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [payload.category_id, companyId]
    );
    if (!catRes.rowCount) {
      throw new ApiError(400, 'تصنيف الأصل غير موجود أو غير نشط');
    }
    const category = catRes.rows[0];

    // توليد رقم الأصل عبر NumberingService
    const assetNumber = await NumberingService.next(client, companyId, 'fixed_asset', {
      prefix: 'FA-',
      pad: 4,
    });

    const asset = await FixedAsset.create(client, companyId, {
      ...payload,
      asset_number: assetNumber,
      useful_life_years: payload.useful_life_years ?? category.useful_life_years,
      depreciation_method: payload.depreciation_method ?? category.depreciation_method,
      salvage_value: payload.salvage_value ?? round2((Number(payload.purchase_cost) * Number(category.salvage_value_percent || 0)) / 100),
      created_by: userId,
    });

    // إنشاء قيد شراء الأصل تلقائياً إن طُلب (auto_journal: true)
    if (payload.auto_journal) {
      if (!payload.payment_account_id) {
        throw new ApiError(400, 'payment_account_id مطلوب عند تفعيل القيد المحاسبي للشراء');
      }

      const accMap = await requireActiveAccounts(
        client,
        companyId,
        ['1200', '1211', '1212', '1213', '1214'],
        'في شراء أصل ثابت'
      );

      const targetAssetAccountId = category.asset_account_id || accMap['1213'] || accMap['1200'];
      const cost = round2(asset.purchase_cost);
      const pDate = payload.purchase_date || new Date().toISOString().slice(0, 10);

      const lines = [
        {
          account_id: targetAssetAccountId,
          debit: cost,
          credit: 0,
          description: `شراء أصل ثابت ${asset.asset_number} - ${asset.name}`,
        },
        {
          account_id: payload.payment_account_id,
          debit: 0,
          credit: cost,
          description: `سداد/التزام شراء أصل ثابت ${asset.asset_number}`,
        },
      ];

      assertBalanced(lines, 'في شراء أصل ثابت');

      const je = await JournalEntry.create(client, companyId, {
        entry_date: pDate,
        description: `قيد شراء أصل ثابت ${asset.asset_number} (${asset.name})`,
        source_type: 'asset_purchase',
        source_id: asset.id,
        created_by: userId,
        lines,
      });

      await verifyJournalEntry(client, je.id, 'في شراء أصل ثابت');
      await JournalEntry.post(client, companyId, je.id, userId);

      await client.query(
        `UPDATE fixed_assets SET journal_entry_id = $1 WHERE id = $2 AND company_id = $3`,
        [je.id, asset.id, companyId]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return await FixedAsset.findById(companyId, asset.id);
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[assetService.createAsset] ROLLBACK failed:', e.message); }
    }
    if (err.code === '23505') {
      throw new ApiError(409, 'رقم الأصل أو الباركود أو الرقم التسلسلي مستخدم مسبقاً');
    }
    throw err;
  } finally {
    client.release();
  }
};

const updateAsset = async (companyId, userId, id, payload) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const updated = await FixedAsset.update(client, companyId, id, payload);
    if (!updated) throw new ApiError(404, 'الأصل الثابت غير موجود');

    await client.query('COMMIT');
    transactionStarted = false;

    return await FixedAsset.findById(companyId, id);
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[assetService.updateAsset] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

const transferCustody = async (companyId, userId, id, payload) => {
  const { branch_id, department_id, custodian_employee_id, notes } = payload;

  return await updateAsset(companyId, userId, id, {
    branch_id,
    department_id,
    custodian_employee_id,
    notes,
  });
};

const removeAsset = async (companyId, userId, id) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await setAuditContext(client, companyId, userId);

    const deleted = await FixedAsset.delete(client, companyId, id);
    if (!deleted) throw new ApiError(404, 'الأصل الثابت غير موجود');

    await client.query('COMMIT');
    transactionStarted = false;

    return { id: deleted.id, asset_number: deleted.asset_number, deleted: true };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[assetService.removeAsset] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createAsset,
  updateAsset,
  transferCustody,
  removeAsset,
  AssetCategory,
};