const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const Notification = require('../models/Notification');
const scanner = require('../services/notificationScanner');

const list = asyncHandler(async (req, res) => {
  const data = await Notification.list(req.user.company_id, req.user.id, req.query);
  res.json({ success: true, data });
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.unreadCount(req.user.company_id, req.user.id);
  res.json({ success: true, data: { count } });
});

const markRead = asyncHandler(async (req, res) => {
  const updated = await Notification.markRead(
    req.user.company_id, req.user.id, req.params.id
  );
  if (!updated) throw new ApiError(404, 'Notification not found');
  res.json({ success: true, data: updated });
});

const markAllRead = asyncHandler(async (req, res) => {
  const count = await Notification.markAllRead(req.user.company_id, req.user.id);
  res.json({ success: true, data: { marked: count } });
});

const remove = asyncHandler(async (req, res) => {
  const ok = await Notification.delete(req.user.company_id, req.user.id, req.params.id);
  if (!ok) throw new ApiError(404, 'Notification not found');
  res.json({ success: true, message: 'Notification deleted' });
});

/**
 * POST /notifications/scan — تشغيل يدوي (للمدير/المالك)
 */
const scan = asyncHandler(async (req, res) => {
  const stats = await scanner.scanAll(req.user.company_id);
  res.json({ success: true, data: stats });
});

module.exports = { list, unreadCount, markRead, markAllRead, remove, scan };