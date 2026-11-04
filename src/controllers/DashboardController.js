const asyncHandler = require('../utils/asyncHandler');
const Dashboard = require('../models/Dashboard');
const ApiError = require('../errors/ApiError');

const summary = asyncHandler(async (req, res) => {
  const data = await Dashboard.getSummary(req.user.company_id, {
    period: req.query.period || 'month',
  });
  res.json({ success: true, data });
});

const recentActivity = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const data = await Dashboard.getRecentActivity(req.user.company_id, { limit });
  res.json({ success: true, data });
});

const publicStats = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await Dashboard.getPublicStats() });
});

module.exports = { summary, recentActivity, publicStats };