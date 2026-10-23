const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const JournalEntry = require('../models/JournalEntry');
const service = require('../services/journalEntryService');

/**
 * GET /journal-entries
 */
const list = asyncHandler(async (req, res) => {
  const data = await JournalEntry.list(req.user.company_id, req.query);
  res.json({ success: true, data });
});

/**
 * GET /journal-entries/:id
 */
const getOne = asyncHandler(async (req, res) => {
  const entry = await JournalEntry.findById(req.user.company_id, req.params.id);
  if (!entry) throw new ApiError(404, 'Journal entry not found');
  res.json({ success: true, data: entry });
});

/**
 * POST /journal-entries
 */
const create = asyncHandler(async (req, res) => {
  const entry = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: entry });
});

/**
 * PATCH /journal-entries/:id
 */
const update = asyncHandler(async (req, res) => {
  const entry = await service.update(req.user.company_id, req.params.id, req.body);
  res.json({ success: true, data: entry });
});

/**
 * POST /journal-entries/:id/post
 */
const post = asyncHandler(async (req, res) => {
  const result = await service.post(req.user.company_id, req.params.id, req.user.id);
  res.json({ success: true, data: result });
});

/**
 * POST /journal-entries/:id/unpost
 */
const unpost = asyncHandler(async (req, res) => {
  const result = await service.unpost(req.user.company_id, req.params.id);
  res.json({ success: true, data: result });
});

/**
 * DELETE /journal-entries/:id
 */
const remove = asyncHandler(async (req, res) => {
  const ok = await JournalEntry.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Entry not found or not draft');
  res.json({ success: true, message: 'Journal entry deleted' });
});

/**
 * GET /journal-entries/trial-balance
 */
const trialBalance = asyncHandler(async (req, res) => {
  const data = await JournalEntry.trialBalance(req.user.company_id, req.query);
  res.json({ success: true, data });
});

module.exports = { list, getOne, create, update, post, unpost, remove, trialBalance };