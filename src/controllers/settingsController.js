// controllers/settingsController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const settingsService = require('../services/settingsService');

// ═══════════════════════════════════════════════════════════════════════════
// GET /settings
// ═══════════════════════════════════════════════════════════════════════════
const getAll = asyncHandler(async (req, res) => {
  const settings = await settingsService.getAll(req.user.company_id);
  res.json({ success: true, data: settings });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /settings/:key
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  const value = await settingsService.getOne(req.user.company_id, req.params.key);
  if (value === null) throw new ApiError(404, 'Setting not found');
  res.json({ success: true, data: { key: req.params.key, value } });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /settings/:key
// ═══════════════════════════════════════════════════════════════════════════
const updateOne = asyncHandler(async (req, res) => {
  const { value } = req.body;
  if (value === undefined) throw new ApiError(400, 'value is required');

  const updated = await settingsService.set(req.user.company_id, req.params.key, value);

  // إعادة تحميل jobs إذا لزم
  if (req.params.key.startsWith('hr_leave_balance_')) {
    try {
      const { reload } = require('../jobs/leaveBalanceResetJob');
      await reload();
    } catch (e) {
      console.error('[settingsController] reload leaveBalanceResetJob failed:', e.message);
    }
  }

  res.json({ success: true, data: updated });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /settings — دفعة
// ═══════════════════════════════════════════════════════════════════════════
const updateMany = asyncHandler(async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    throw new ApiError(400, 'settings must be an object');
  }

  const result = await settingsService.updateMany(req.user.company_id, settings);
  if (result.errors.length > 0) {
    throw new ApiError(400, 'بعض القيم غير صالحة', result.errors);
  }

  // إعادة تحميل jobs إذا لزم
  const affectsHrJobs = Object.keys(settings).some((k) => k.startsWith('hr_leave_balance_'));
  if (affectsHrJobs) {
    try {
      const { reload } = require('../jobs/leaveBalanceResetJob');
      await reload();
    } catch (e) {
      console.error('[settingsController] reload leaveBalanceResetJob failed:', e.message);
    }
  }

  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /settings/:key
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  const ok = await settingsService.remove(req.user.company_id, req.params.key);
  if (!ok) throw new ApiError(404, 'Setting not found');
  res.json({ success: true, message: 'Setting deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /settings/reload-hr-jobs
// ═══════════════════════════════════════════════════════════════════════════
const reloadHrJobs = asyncHandler(async (req, res) => {
  try {
    const { reload } = require('../jobs/leaveBalanceResetJob');
    await reload();
    res.json({ success: true, message: 'تم إعادة تحميل مهام HR بنجاح' });
  } catch (err) {
    console.error('[settingsController] reloadHrJobs failed:', err.message);
    throw new ApiError(500, `فشل إعادة تحميل مهام HR: ${err.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /settings/hr-jobs-status
// ═══════════════════════════════════════════════════════════════════════════
const hrJobsStatus = asyncHandler(async (req, res) => {
  const { getCompanySettings } = require('../jobs/leaveBalanceResetJob');
  const { pool } = require('../config/pool');

  const client = await pool.connect();
  try {
    const s = await getCompanySettings(client, req.user.company_id);

    const now = new Date();
    let next = new Date(now.getFullYear(), s.month - 1, s.day, s.hour, 5, 0);
    if (next <= now) next = new Date(now.getFullYear() + 1, s.month - 1, s.day, s.hour, 5, 0);

    res.json({
      success: true,
      data: {
        enabled: s.enabled,
        schedule: `كل سنة في ${s.month}/${s.day} الساعة ${String(s.hour).padStart(2, '0')}:05`,
        month: s.month,
        day: s.day,
        hour: s.hour,
        carry_over: s.carryOver,
        next_run: next.toISOString(),
      },
    });
  } finally {
    client.release();
  }
});

module.exports = {
  getAll,
  getOne,
  updateOne,
  updateMany,
  remove,
  reloadHrJobs,
  hrJobsStatus,
};