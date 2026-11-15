// controllers/ReportController.js
const asyncHandler = require('../utils/asyncHandler');
const Report = require('../models/Report');

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════


const dashboard = asyncHandler(async (req, res, next) => {
  try {
    const data = await Report.dashboard(req.user.company_id, {
      as_of: req.query.as_of_date || null,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('❌ Dashboard Error:', error);
    console.error('Error Message:', error.message);
    console.error('Stack Trace:', error.stack);

    return next(error);
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Financial statements
// ═══════════════════════════════════════════════════════════════════════════

const balanceSheet = asyncHandler(async (req, res) => {
  const data = await Report.balanceSheet(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const incomeStatement = asyncHandler(async (req, res) => {
  const data = await Report.incomeStatement(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const generalLedger = asyncHandler(async (req, res) => {
  const data = await Report.generalLedger(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const trialBalance = asyncHandler(async (req, res) => {
  const data = await Report.trialBalance(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const taxSummary = asyncHandler(async (req, res) => {
  const data = await Report.taxSummary(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// AR / AP
// ═══════════════════════════════════════════════════════════════════════════

const arAging = asyncHandler(async (req, res) => {
  const data = await Report.arAging(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const apAging = asyncHandler(async (req, res) => {
  const data = await Report.apAging(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sales / Purchases
// ═══════════════════════════════════════════════════════════════════════════

const salesReport = asyncHandler(async (req, res) => {
  const data = await Report.salesReport(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const purchasesReport = asyncHandler(async (req, res) => {
  const data = await Report.purchasesReport(req.user.company_id, req.query);
  res.json({ success: true, data });
});

const topProducts = asyncHandler(async (req, res) => {
  const data = await Report.topProducts(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Inventory
// ═══════════════════════════════════════════════════════════════════════════

const inventoryReport = asyncHandler(async (req, res) => {
  const data = await Report.inventoryReport(req.user.company_id, req.query);
  res.json({ success: true, data });
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  dashboard,
  balanceSheet,
  incomeStatement,
  generalLedger,
  trialBalance,
  taxSummary,
  arAging,
  apAging,
  salesReport,
  purchasesReport,
  topProducts,
  inventoryReport,
};