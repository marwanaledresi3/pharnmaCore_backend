// services/payrollService.js
const { pool } = require('../config/pool');
const PayrollRun = require('../models/PayrollRun');
const PayrollItem = require('../models/PayrollItem');
const Employee = require('../models/Employee');
const JournalEntry = require('../models/JournalEntry');
const NumberingService = require('./numberingService');
const ApiError = require('../errors/ApiError');
const settingsService = require('./settingsService');
const {
  sendHrNotification,
  notifyManagers,
} = require('./hr/notificationHelper');

const {
  round2,
  requireActiveAccounts,
  verifyJournalEntry,
  buildPayrollLines,
} = require('./journalHelper');

// ═══════════════════════════════════════════════════════════════
// حساب راتب موظف واحد
// ═══════════════════════════════════════════════════════════════
const calcEmployee = (emp, att, leave, settings) => {
  const workingDays = 30;
  const basic      = Number(emp.basic_salary) || 0;
  const housing    = Number(emp.housing_allowance) || 0;
  const transport  = Number(emp.transport_allowance) || 0;
  const other      = Number(emp.other_allowances) || 0;
  const dailyRate  = (basic + housing + transport + other) / workingDays;

  const absentDays = att ? parseInt(att.absent_days, 10) : 0;
  const unpaidDays = leave ? parseFloat(leave.days) : 0;
  const absenceDeduction = round2((absentDays + unpaidDays) * dailyRate);

  const overtimeHours  = att ? parseFloat(att.overtime_hours) : 0;
  const overtimeRate   = Number(settings.hr_overtime_rate ?? 1.5);
  const overtimeAmount = round2(overtimeHours * (dailyRate / 8) * overtimeRate);

  // تأمينات
  const socialEnabled  = settings.hr_social_insurance_enabled ?? true;
  const socialRate     = Number(settings.hr_social_employee_rate ?? 9.75);
  const socialBase     = settings.hr_social_base ?? 'basic';
  const socialMinBase  = Number(settings.hr_social_min_base ?? 0);
  const socialMaxBase  = Number(settings.hr_social_max_base ?? 45000);

  let socialBaseAmount = socialBase === 'gross'
    ? basic + housing + transport + other
    : basic;
  socialBaseAmount = Math.max(socialBaseAmount, socialMinBase);
  socialBaseAmount = Math.min(socialBaseAmount, socialMaxBase);

  const socialInsurance = socialEnabled ? round2(socialBaseAmount * socialRate / 100) : 0;

  // ضريبة دخل
  const taxEnabled   = settings.hr_tax_enabled ?? true;
  const taxThreshold = Number(settings.hr_tax_exemption_threshold ?? 3000);
  const taxRate      = Number(settings.hr_tax_rate ?? 5);

  const taxableIncome = basic + housing + transport - socialInsurance;
  const taxDeduction  = taxEnabled && taxableIncome > taxThreshold
    ? round2((taxableIncome - taxThreshold) * taxRate / 100)
    : 0;

  const grossSalary     = round2(basic + housing + transport + other + overtimeAmount);
  const totalDeductions = round2(absenceDeduction + socialInsurance + taxDeduction);
  const netSalary       = round2(grossSalary - totalDeductions);

  return {
    basic_salary:        round2(basic),
    housing_allowance:   round2(housing),
    transport_allowance: round2(transport),
    other_allowances:    round2(other),
    overtime_amount:     overtimeAmount,
    bonus_amount:        0,
    gross_salary:        grossSalary,
    absence_deduction:   absenceDeduction,
    tax_deduction:       taxDeduction,
    social_insurance:    socialInsurance,
    loan_deduction:      0,
    other_deductions:    0,
    total_deductions:    totalDeductions,
    net_salary:          netSalary,
  };
};

// ═══════════════════════════════════════════════════════════════
// CREATE — حساب مسير (draft)
// ═══════════════════════════════════════════════════════════════
const create = async (companyId, userId, payload) => {
  const client = await pool.connect();
  let started = false;
  let run = null;

  try {
    await client.query('BEGIN');
    started = true;

    const { year, month, payment_date } = payload;

    // 1) فحص التكرار
    const dup = await client.query(
      `SELECT id FROM payroll_runs
        WHERE company_id = $1 AND period_year = $2 AND period_month = $3
          AND status <> 'cancelled'`,
      [companyId, year, month]
    );
    if (dup.rowCount) {
      throw new ApiError(400, `يوجد مسير رواتب لهذا الشهر بالفعل (${month}/${year})`);
    }

    // 2) جلب الموظفين النشطين
    const employees = await Employee.findActiveForPayroll(client, companyId);
    if (!employees.length) {
      throw new ApiError(400, 'لا يوجد موظفون نشطون لحساب الرواتب');
    }

    // 3) جلب الإعدادات
    const settings = await settingsService.getMany(companyId, [
      'hr_overtime_rate',
      'hr_social_insurance_enabled',
      'hr_social_employee_rate',
      'hr_social_base',
      'hr_social_min_base',
      'hr_social_max_base',
      'hr_tax_enabled',
      'hr_tax_exemption_threshold',
      'hr_tax_rate',
    ], client);

    // 4) جلب الحضور
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;
    const monthEnd  = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const attRes = await client.query(
      `SELECT employee_id,
              COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
              COALESCE(SUM(overtime_hours), 0)          AS overtime_hours
         FROM attendance
        WHERE company_id = $1
          AND work_date >= $2 AND work_date < $3
        GROUP BY employee_id`,
      [companyId, monthStart, monthEnd]
    );
    const attMap = Object.fromEntries(attRes.rows.map(a => [a.employee_id, a]));

    // 5) جلب الإجازات غير المدفوعة
    const leaveRes = await client.query(
      `SELECT lr.employee_id, SUM(lr.days_count) AS days
         FROM leave_requests lr
         JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.company_id = $1
          AND lr.status = 'approved'
          AND lt.is_paid = false
          AND lr.start_date < $3 AND lr.end_date >= $2
        GROUP BY lr.employee_id`,
      [companyId, monthStart, monthEnd]
    );
    const leaveMap = Object.fromEntries(leaveRes.rows.map(l => [l.employee_id, l]));

    // 6) رقم المسير
    const runNumber = await NumberingService.next(client, companyId, 'payroll');

    // 7) إنشاء الرأس
    run = await PayrollRun.create(client, companyId, {
      run_number: runNumber,
      period_year: year,
      period_month: month,
      payment_date,
      created_by: userId,
    });

    // 8) حساب كل موظف
    let totalGross = 0, totalDed = 0, totalNet = 0;

    for (const emp of employees) {
      const calc = calcEmployee(emp, attMap[emp.id], leaveMap[emp.id], settings);
      await PayrollItem.create(client, companyId, {
        payroll_run_id: run.id,
        employee_id: emp.id,
        ...calc,
      });
      totalGross += calc.gross_salary;
      totalDed   += calc.total_deductions;
      totalNet   += calc.net_salary;
    }

    // 9) تحديث الإجماليات
    await PayrollRun.updateTotals(client, run.id, {
      total_gross: round2(totalGross),
      total_deductions: round2(totalDed),
      total_net: round2(totalNet),
    });

    const full = await PayrollRun.findWithItems(companyId, run.id);

    await client.query('COMMIT');
    started = false;

    // ⬇️ إشعار للمدراء (بعد COMMIT)
    try {
      await notifyManagers({
        companyId,
        settingKey: 'hr_notify_payroll_ready',
        type: 'hr.payroll_ready',
        title: '💰 مسير رواتب جاهز للمراجعة',
        message: `تم إنشاء مسير ${runNumber} للفترة ${month}/${year} — صافي ${totalNet.toFixed(2)}`,
        referenceType: 'payroll_run',
        referenceId: run.id,
        metadata: {
          run_number: runNumber,
          period_year: year,
          period_month: month,
          total_net: totalNet,
          items_count: employees.length,
        },
        excludeUserId: userId,
        uniqueKey: `payroll_ready:${run.id}`,
      });
    } catch (e) {
      console.error('[payrollService] notify managers failed:', e.message);
    }

    return full;
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payrollService.create] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// POST — ترحيل المسير → قيد محاسبي
// ═══════════════════════════════════════════════════════════════
const post = async (companyId, id, userId) => {
  const client = await pool.connect();
  let started = false;
  let run = null;
  let entry = null;
  let updated = null;

  try {
    await client.query('BEGIN');
    started = true;

    // 1) قفل المسير
    const lockRes = await client.query(
      `SELECT * FROM payroll_runs
        WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [id, companyId]
    );
    run = lockRes.rows[0];
    if (!run) throw new ApiError(404, 'مسير الرواتب غير موجود');
    if (run.status === 'paid') throw new ApiError(400, 'المسير مُرحّل مسبقاً');
    if (run.status === 'cancelled') throw new ApiError(400, 'المسير ملغى');

    // 2) جلب الحسابات
    const accounts = await requireActiveAccounts(
      client, companyId,
      ['512', '5240', '2130', '2131', '2132'],
      'في ترحيل مسير الرواتب'
    );

    // 3) الإجماليات
    const totals = await PayrollItem.getTotals(client, id);
    const employerSocial = round2(Number(totals.basic_total) * 0.12);

    // 4) بناء السطور
    const lines = buildPayrollLines({
      accounts,
      gross:          Number(totals.total_gross),
      net:            Number(totals.total_net),
      employeeSocial: Number(totals.social_employee),
      employerSocial,
      tax:            Number(totals.tax_total),
      reference:      run.run_number,
    });

    // 5) إنشاء القيد
    entry = await JournalEntry.create(client, companyId, {
      entry_date: run.payment_date,
      description: `مسير رواتب ${run.run_number} — ${run.period_month}/${run.period_year}`,
      source_type: 'payroll',
      source_id: run.id,
      created_by: userId,
      lines,
    });

    await verifyJournalEntry(client, entry.id, 'في ترحيل الرواتب');

    // 6) ترحيل القيد
    await JournalEntry.post(client, companyId, entry.id, userId);

    // 7) تحديث المسير
    updated = await PayrollRun.markPaid(client, run.id, {
      journal_entry_id: entry.id,
      approved_by: userId,
    });

    await client.query('COMMIT');
    started = false;

    // ⬇️ إشعارات للموظفين (بعد COMMIT)
    try {
      const settings = await settingsService.getMany(companyId, ['hr_notify_payroll_ready']);
      const enabled = settings.hr_notify_payroll_ready ?? true;

      if (enabled) {
        const { rows: employeesWithUsers } = await pool.query(
          `SELECT e.user_id, pi.net_salary, e.full_name
             FROM payroll_items pi
             JOIN employees e ON e.id = pi.employee_id
            WHERE pi.payroll_run_id = $1
              AND e.user_id IS NOT NULL`,
          [run.id]
        );

        for (const emp of employeesWithUsers) {
          await sendHrNotification({
            companyId,
            settingKey: 'hr_notify_payroll_ready',
            userId: emp.user_id,
            type: 'hr.payroll_paid',
            title: '💵 تم ترحيل راتبك',
            message: `تم ترحيل راتبك لشهر ${run.period_month}/${run.period_year} — صافي ${Number(emp.net_salary).toFixed(2)}`,
            referenceType: 'payroll_run',
            referenceId: run.id,
            metadata: {
              net_salary: Number(emp.net_salary),
              period: `${run.period_year}-${String(run.period_month).padStart(2, '0')}`,
            },
            uniqueKey: `payroll_paid:${run.id}:user:${emp.user_id}`,
          });
        }
      }
    } catch (e) {
      console.error('[payrollService] notify employees failed:', e.message);
    }

    return updated;
  } catch (err) {
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch (e) { console.error('[payrollService.post] ROLLBACK failed:', e.message); }
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { create, post };