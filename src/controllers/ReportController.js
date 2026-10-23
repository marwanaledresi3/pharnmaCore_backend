const asyncHandler = require('../utils/asyncHandler');
const Report = require('../models/Report');

const dashboard = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.dashboard(req.user.company_id) });
});

const balanceSheet = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.balanceSheet(req.user.company_id, req.query) });
});

const incomeStatement = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.incomeStatement(req.user.company_id, req.query) });
});

const generalLedger = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.generalLedger(req.user.company_id, req.query) });
});

const arAging = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.arAging(req.user.company_id, req.query) });
});

const apAging = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.apAging(req.user.company_id, req.query) });
});

const salesReport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.salesReport(req.user.company_id, req.query) });
});

const purchasesReport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.purchasesReport(req.user.company_id, req.query) });
});

const inventoryReport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.inventoryReport(req.user.company_id, req.query) });
});

const topProducts = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.topProducts(req.user.company_id, req.query) });
});

const taxSummary = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Report.taxSummary(req.user.company_id, req.query) });
});

module.exports = {
  dashboard,
  balanceSheet,
  incomeStatement,
  generalLedger,
  arAging,
  apAging,
  salesReport,
  purchasesReport,
  inventoryReport,
  topProducts,
  taxSummary,
};