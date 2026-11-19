// controllers/PayrollController.js
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../errors/ApiError');
const PayrollRun = require('../models/PayrollRun');
const service = require('../services/payrollService');
const { pool } = require('../config/pool');

const isRestricted = (req) => !req.permissions?.includes('payroll.view_all');
const requireEmployeeId = (req) => {
  if (!req.user?.employee_id) {
    throw new ApiError(403, 'هذا الحساب غير مرتبط بموظف');
  }
  return req.user.employee_id;
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll — قائمة المسيرات
// ═══════════════════════════════════════════════════════════════════════════
const list = asyncHandler(async (req, res) => {
  // ⬇️ الموظف لا يرى قائمة المسيرات — يرى قسائمه فقط
  if (isRestricted(req)) {
    throw new ApiError(403, 'Access denied — use /payroll/my-payslips');
  }

  res.json({ success: true, data: await PayrollRun.list(req.user.company_id, req.query) });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /payroll/:id
// ═══════════════════════════════════════════════════════════════════════════
const getOne = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'Access denied — use /payroll/my-payslips');
  }

  const run = await PayrollRun.findWithItems(req.user.company_id, req.params.id);
  if (!run) throw new ApiError(404, 'Payroll run not found');
  res.json({ success: true, data: run });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /payroll — حساب (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const create = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'Access denied');
  }

  const run = await service.create(req.user.company_id, req.user.id, req.body);
  res.status(201).json({ success: true, data: run });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /payroll/:id/post — ترحيل (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const post = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'Access denied');
  }

  const result = await service.post(req.user.company_id, req.params.id, req.user.id);
  res.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /payroll/:id (مدير فقط)
// ═══════════════════════════════════════════════════════════════════════════
const remove = asyncHandler(async (req, res) => {
  if (isRestricted(req)) {
    throw new ApiError(403, 'Access denied');
  }

  const ok = await PayrollRun.delete(req.user.company_id, req.params.id);
  if (!ok) throw new ApiError(404, 'Payroll run not found or not draft');
  res.json({ success: true, message: 'Payroll run deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 GET /payroll/my-payslips — قسائم راتب الموظف
// ═══════════════════════════════════════════════════════════════════════════
const myPayslips = asyncHandler(async (req, res) => {
  const employeeId = requireEmployeeId(req);

  // جلب مسيرات الرواتب التي تحتوي على بند لهذا الموظف (paid فقط)
  const { rows } = await pool.query(
    `SELECT pr.id AS payroll_run_id,
            pr.run_number,
            pr.period_year,
            pr.period_month,
            pr.payment_date,
            pr.status AS run_status,
            pi.id AS payroll_item_id,
            pi.basic_salary,
            pi.housing_allowance,
            pi.transport_allowance,
            pi.other_allowances,
            pi.overtime_amount,
            pi.bonus_amount,
            pi.gross_salary,
            pi.absence_deduction,
            pi.tax_deduction,
            pi.social_insurance,
            pi.loan_deduction,
            pi.other_deductions,
            pi.total_deductions,
            pi.net_salary
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
      WHERE pi.employee_id = $1
        AND pr.company_id = $2
        AND pr.status = 'paid'
      ORDER BY pr.period_year DESC, pr.period_month DESC`,
    [employeeId, req.user.company_id]
  );

  res.json({ success: true, data: rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 GET /payroll/my-payslips/:itemId — تفاصيل قسيمة
// ═══════════════════════════════════════════════════════════════════════════
const myPayslipDetail = asyncHandler(async (req, res) => {
  const employeeId = requireEmployeeId(req);

  const { rows } = await pool.query(
    `SELECT pr.run_number,
            pr.period_year,
            pr.period_month,
            pr.payment_date,
            pi.*,
            e.full_name,
            e.employee_number
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       JOIN employees e ON e.id = pi.employee_id
      WHERE pi.id = $1
        AND pi.employee_id = $2
        AND pr.company_id = $3
        AND pr.status = 'paid'`,
    [req.params.itemId, employeeId, req.user.company_id]
  );

  if (!rows[0]) {
    throw new ApiError(404, 'Payslip not found');
  }

  res.json({ success: true, data: rows[0] });
});

module.exports = {
  list, getOne, create, post, remove,
  myPayslips, myPayslipDetail,
};