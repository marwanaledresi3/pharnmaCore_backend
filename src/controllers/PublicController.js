const asyncHandler = require('../utils/asyncHandler');
const PublicContent = require('../models/Public');

const listProducts = asyncHandler(async (req, res) => {
  const data = await PublicContent.listGlobalProducts(req.query);
  res.json({ success: true, data });
});

const listPosts = asyncHandler(async (req, res) => {
  const data = await PublicContent.listCompanyPosts(req.query);
  res.json({ success: true, data });
});

const listCategories = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await PublicContent.listCategories() });
});

const viewPost = asyncHandler(async (req, res) => {
  await PublicContent.incrementPostViews(req.params.id);
  res.json({ success: true });
});

module.exports = { listProducts, listPosts, listCategories, viewPost };