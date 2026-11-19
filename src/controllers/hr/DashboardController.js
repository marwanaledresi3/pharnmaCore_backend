// controllers/hr/DashboardController.js
const { pool } = require('../../config/pool');
const asyncHandler = require('../../utils/asyncHandler');

const getStats = asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const [
    empRes,
    attTodayRes,
    leaveTodayRes,
    newHiresRes,
    pendingLeavesRes,
    approvedLeavesRes,
    payrollRes,
    deptBreakdownRes,
    recentLeavesRes,
    attTrendRes,
  ] = await Promise.all([
    // 1) Employees count
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('active','on_leave'))::int AS active,
         COUNT(*)::int AS total
       FROM employees WHERE company_id = $1`,
      [companyId]
    ),
    // 2) Today attendance
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'present')::int AS present,
         COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
         COUNT(*) FILTER (WHERE status = 'late')::int AS late
       FROM attendance WHERE company_id = $1 AND work_date = $2`,
      [companyId, today]
    ),
    // 3) On leave today
    pool.query(
      `SELECT COUNT(DISTINCT employee_id)::int AS c
       FROM leave_requests
       WHERE company_id = $1 AND status = 'approved'
         AND start_date <= $2 AND end_date >= $2`,
      [companyId, today]
    ),
    // 4) New hires this month
    pool.query(
      `SELECT COUNT(*)::int AS c FROM employees
       WHERE company_id = $1 AND hire_date >= $2 AND hire_date < $3`,
      [companyId, monthStart, monthEnd]
    ),
    // 5) Pending leaves
    pool.query(
      `SELECT COUNT(*)::int AS c FROM leave_requests
       WHERE company_id = $1 AND status = 'pending'`,
      [companyId]
    ),
    // 6) Approved leaves this month
    pool.query(
      `SELECT COUNT(*)::int AS c FROM leave_requests
       WHERE company_id = $1 AND status = 'approved'
         AND created_at >= $2 AND created_at < $3`,
      [companyId, monthStart, monthEnd]
    ),
    // 7) Current month payroll
    pool.query(
      `SELECT total_net, status, payment_date
       FROM payroll_runs
       WHERE company_id = $1 AND period_year = $2 AND period_month = $3
         AND status <> 'cancelled'
       ORDER BY created_at DESC LIMIT 1`,
      [companyId, currentYear, currentMonth]
    ),
    // 8) Department breakdown
    pool.query(
      `SELECT d.id AS department_id, d.name AS department_name,
              COUNT(e.id)::int AS employee_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id AND e.status IN ('active','on_leave')
       WHERE d.company_id = $1 AND d.is_active = true
       GROUP BY d.id, d.name
       ORDER BY employee_count DESC
       LIMIT 10`,
      [companyId]
    ),
    // 9) Recent leave requests
    pool.query(
      `SELECT lr.id, lr.start_date, lr.end_date, lr.days_count, lr.status, lr.created_at,
              e.full_name AS employee_name,
              lt.name AS leave_type_name
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.company_id = $1
       ORDER BY lr.created_at DESC
       LIMIT 5`,
      [companyId]
    ),
    // 10) Attendance trend (last 7 days)
    pool.query(
      `SELECT work_date::text AS date,
              COUNT(*) FILTER (WHERE status = 'present')::int AS present,
              COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
              COUNT(*) FILTER (WHERE status = 'late')::int AS late
       FROM attendance
       WHERE company_id = $1 AND work_date >= $2 AND work_date <= $3
       GROUP BY work_date
       ORDER BY work_date`,
      [companyId, sevenDaysAgo, today]
    ),
  ]);

  const activeEmps = empRes.rows[0].active;
  const att = attTodayRes.rows[0];
  const attendanceRate = activeEmps > 0 ? Math.round((att.present / activeEmps) * 100) : 0;

  res.json({
    success: true,
    data: {
      total_employees: empRes.rows[0].total,
      active_employees: activeEmps,
      on_leave_today: leaveTodayRes.rows[0].c,
      new_hires_this_month: newHiresRes.rows[0].c,

      present_today: att.present,
      absent_today: att.absent,
      late_today: att.late,
      attendance_rate: attendanceRate,

      pending_leave_requests: pendingLeavesRes.rows[0].c,
      approved_this_month: approvedLeavesRes.rows[0].c,

      current_month_payroll_net: Number(payrollRes.rows[0]?.total_net || 0),
      current_month_payroll_status: payrollRes.rows[0]?.status || null,
      last_payroll_date: payrollRes.rows[0]?.payment_date || null,

      departments_breakdown: deptBreakdownRes.rows,
      recent_leave_requests: recentLeavesRes.rows,
      attendance_trend: attTrendRes.rows,
    },
  });
});

module.exports = { getStats };