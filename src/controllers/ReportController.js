const asyncHandler = require('../utils/asyncHandler');
const Report = require('../models/Report');

const dashboard = asyncHandler(async (req, res) => {
  try{
    const data = await Report.dashboard(req.user.company_id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching dashboard report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const balanceSheet = asyncHandler(async (req, res) => {
  try {
    const data = await Report.balanceSheet(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching balance sheet report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const incomeStatement = asyncHandler(async (req, res) => {
  try {
    const data = await Report.incomeStatement(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching income statement report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const generalLedger = asyncHandler(async (req, res) => {
  try {
    const data = await Report.generalLedger(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching general ledger report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const arAging = asyncHandler(async (req, res) => {
  try {
    const data = await Report.arAging(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching AR aging report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const apAging = asyncHandler(async (req, res) => {
  try {
    const data = await Report.apAging(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching AP aging report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const salesReport = asyncHandler(async (req, res) => {
  try {
    const data = await Report.salesReport(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching sales report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const purchasesReport = asyncHandler(async (req, res) => {
  try {
    const data = await Report.purchasesReport(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching purchases report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const inventoryReport = asyncHandler(async (req, res) => {
  try {
    const data = await Report.inventoryReport(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching inventory report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const topProducts = asyncHandler(async (req, res) => {
  try {
    const data = await Report.topProducts(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching top products report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const taxSummary = asyncHandler(async (req, res) => {
  try {
    const data = await Report.taxSummary(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching tax summary report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
const trialBalance = asyncHandler(async (req, res) => {
  try {
    const data = await Report.trialBalance(req.user.company_id, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching trial balance report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
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
  trialBalance
};