// controllers/FixedAssetController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const { pool } = require('../config/pool');
const AssetCategory = require('../models/AssetCategory');
const FixedAsset = require('../models/FixedAsset');
const assetService = require('../services/fixedAssets/assetService');
const depreciationService = require('../services/fixedAssets/depreciationService');
const maintenanceService = require('../services/fixedAssets/maintenanceService');
const disposalService = require('../services/fixedAssets/disposalService');

// Categories
const listCategories = asyncHandler(async (req, res) => {
  const data = await AssetCategory.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getCategoryById = asyncHandler(async (req, res) => {
  const row = await AssetCategory.findById(req.user.company_id, req.params.id);
  if (!row) throw new ApiError(404, 'تصنيف الأصل غير موجود');
  res.json({ success: true, data: row });
});

const createCategory = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await AssetCategory.create(client, req.user.company_id, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const updateCategory = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await AssetCategory.update(client, req.user.company_id, req.params.id, req.body);
    if (!updated) throw new ApiError(404, 'تصنيف الأصل غير موجود');
    await client.query('COMMIT');
    res.json({ success: true, data: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const deleteCategory = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ok = await AssetCategory.delete(client, req.user.company_id, req.params.id);
    if (!ok) throw new ApiError(404, 'تصنيف الأصل غير موجود');
    await client.query('COMMIT');
    res.json({ success: true, message: 'تم حذف تصنيف الأصل بنجاح' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Assets
const listAssets = asyncHandler(async (req, res) => {
  const data = await FixedAsset.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const getAssetById = asyncHandler(async (req, res) => {
  const asset = await FixedAsset.findById(req.user.company_id, req.params.id);
  if (!asset) throw new ApiError(404, 'الأصل الثابت غير موجود');
  res.json({ success: true, data: asset });
});

const createAsset = asyncHandler(async (req, res) => {
  const created = await assetService.createAsset(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: created });
});

const updateAsset = asyncHandler(async (req, res) => {
  const updated = await assetService.updateAsset(req.user.company_id, req.user.id, req.params.id, req.body);
  res.json({ success: true, data: updated });
});

const transferCustody = asyncHandler(async (req, res) => {
  const updated = await assetService.transferCustody(req.user.company_id, req.user.id, req.params.id, req.body);
  res.json({ success: true, data: updated });
});

const deleteAsset = asyncHandler(async (req, res) => {
  const result = await assetService.removeAsset(req.user.company_id, req.user.id, req.params.id);
  res.json({ success: true, data: result });
});

// Depreciation
const listDepreciations = asyncHandler(async (req, res) => {
  const data = await depreciationService.listDepreciations(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const runDepreciation = asyncHandler(async (req, res) => {
  const data = await depreciationService.runDepreciationForPeriod(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data });
});


// Maintenance
const listMaintenances = asyncHandler(async (req, res) => {
  const data = await maintenanceService.listMaintenances(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const createMaintenance = asyncHandler(async (req, res) => {
  const assetId = req.params.id || req.body.asset_id;
  if (!assetId) throw new ApiError(400, 'معرف الأصل (asset_id) مطلوب');
  const data = await maintenanceService.createMaintenance(
    req.user.company_id,
    req.user.id,
    assetId,
    req.body
  );
  res.status(201).json({ success: true, data });
});

// Disposals
const listDisposals = asyncHandler(async (req, res) => {
  const data = await disposalService.listDisposals(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const disposeAsset = asyncHandler(async (req, res) => {
  const assetId = req.params.id || req.body.asset_id;
  if (!assetId) throw new ApiError(400, 'معرف الأصل (asset_id) مطلوب');
  const data = await disposalService.disposeAsset(
    req.user.company_id,
    req.user.id,
    assetId,
    req.body
  );
  res.status(201).json({ success: true, data });
});
module.exports = {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  listAssets,
  getAssetById,
  createAsset,
  updateAsset,
  transferCustody,
  deleteAsset,
  listDepreciations,
  runDepreciation,
  disposeAsset,
  listDisposals,
  createMaintenance,
  listMaintenances,
};