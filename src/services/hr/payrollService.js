// services/hr/payrollService.js
const db = require('../../config/pool');
const JournalHelper = require('../journalHelper');
const NumberingService = require('../numberingService');
const ApiError = require('../../errors/ApiError');

class PayrollService {

  /**
   * حساب مسير رواتب (draft) لشهر معين
   * لا ينشئ قيداً محاسبياً بعد
   */
  async calculate(companyId, { year, month, paymentDate, createdBy }) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.company_id = $1", [companyId]);
      await client.query("SET LOCAL app.user_id = $1", [createdBy]);

      // 1) جلب الموظفين النشطين
      const { rows: employees } = await client.query(
        `SELECT * FROM employees
          WHERE company_id = $1 AND status IN ('active','on_leave')
          ORDER BY employee_number`,
        [companyId]
      );

      if (!employees.length) {
        throw new ApiError(400, 'لا يوجد موظفون نشطون لحساب الرواتب');
      }

      // 2) جلب الحضور والغياب للشهر
      const { rows: attendance } = await client.query(
        `SELECT employee_id,
                COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
                COALESCE(SUM(overtime_hours), 0)          AS overtime_hours
           FROM attendance
          WHERE company_id = $1
            AND work_date >= $2 AND work_date < $3
          GROUP BY employee_id`,
        [companyId,
         `${year}-${String(month).padStart(2,'0')}-01`,
         `${year}-${String(month + 1).padStart(2,'0')}-01`]
      );
      const attMap = Object.fromEntries(attendance.map(a => [a.employee_id, a]));

      // 3) جلب الإجازات غير مدفوعة الأجر
      const { rows: unpaidLeaves } = await client.query(
        `SELECT lr.employee_id, SUM(lr.days_count) AS days
           FROM leave_requests lr
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.company_id = $1
            AND lr.status = 'approved'
            AND lt.is_paid = false
            AND lr.start_date < $3 AND lr.end_date >= $2
          GROUP BY lr.employee_id`,
        [companyId,
         `${year}-${String(month).padStart(2,'0')}-01`,
         `${year}-${String(month + 1).padStart(2,'0')}-01`]
      );
      const leaveMap = Object.fromEntries(unpaidLeaves.map(l => [l.employee_id, l]));

      // 4) رقم المسير
      const runNumber = await NumberingService.next(client, companyId, 'PAYROLL');

      // 5) إنشاء مسير الرواتب
      const { rows: [run] } = await client.query(
        `INSERT INTO payroll_runs
           (company_id, run_number, period_year, period_month,
            payment_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6)
         RETURNING *`,
        [companyId, runNumber, year, month, paymentDate, createdBy]
      );

      // 6) حساب كل موظف
      let totalGross = 0, totalDeductions = 0, totalNet = 0;

      for (const emp of employees) {
        const calc = this._calcEmployee(emp, attMap[emp.id], leaveMap[emp.id], year, month);

        await client.query(
          `INSERT INTO payroll_items
             (company_id, payroll_run_id, employee_id,
              basic_salary, housing_allowance, transport_allowance, other_allowances,
              overtime_amount, bonus_amount, gross_salary,
              absence_deduction, tax_deduction, social_insurance,
              loan_deduction, other_deductions, total_deductions, net_salary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [companyId, run.id, emp.id,
           calc.basic_salary, calc.housing_allowance, calc.transport_allowance,
           calc.other_allowances, calc.overtime_amount, calc.bonus_amount,
           calc.gross_salary, calc.absence_deduction, calc.tax_deduction,
           calc.social_insurance, calc.loan_deduction, calc.other_deductions,
           calc.total_deductions, calc.net_salary]
        );

        totalGross      += calc.gross_salary;
        totalDeductions += calc.total_deductions;
        totalNet        += calc.net_salary;
      }

      // 7) تحديث الإجماليات
      await client.query(
        `UPDATE payroll_runs
            SET total_gross = $1, total_deductions = $2, total_net = $3
          WHERE id = $4`,
        [totalGross, totalDeductions, totalNet, run.id]
      );

      await client.query('COMMIT');
      return { ...run, total_gross: totalGross, total_deductions: totalDeductions, total_net: totalNet };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * منطق حساب راتب موظف واحد
   */
  _calcEmployee(emp, att, leave, year, month) {
    const workingDays = 30; // تقريب معياري — أو احسب من التقويم
    const basic      = parseFloat(emp.basic_salary) || 0;
    const housing    = parseFloat(emp.housing_allowance) || 0;
    const transport  = parseFloat(emp.transport_allowance) || 0;
    const other      = parseFloat(emp.other_allowances) || 0;
    const dailyRate  = (basic + housing + transport + other) / workingDays;

    // خصم الغياب
    const absentDays = att ? parseInt(att.absent_days, 10) : 0;
    const unpaidDays = leave ? parseFloat(leave.days) : 0;
    const absenceDeduction = (absentDays + unpaidDays) * dailyRate;

    // أجر إضافي (ساعة = dailyRate / 8)
    const overtimeHours  = att ? parseFloat(att.overtime_hours) : 0;
    const overtimeAmount = overtimeHours * (dailyRate / 8) * 1.5;

    // تأمينات (مثال: 9.75% من الأساسي)
    const socialInsurance = basic * 0.0975;

    // ضريبة دخل (مبسّط — يُستبدل بشرائح لاحقاً)
    const taxableIncome = basic + housing + transport - socialInsurance;
    const taxDeduction  = taxableIncome > 3000 ? (taxableIncome - 3000) * 0.05 : 0;

    const grossSalary     = basic + housing + transport + other + overtimeAmount;
    const totalDeductions = absenceDeduction + socialInsurance + taxDeduction;
    const netSalary       = grossSalary - totalDeductions;

    return {
      basic_salary:        this._r2(basic),
      housing_allowance:   this._r2(housing),
      transport_allowance: this._r2(transport),
      other_allowances:    this._r2(other),
      overtime_amount:     this._r2(overtimeAmount),
      bonus_amount:        0,
      gross_salary:        this._r2(grossSalary),
      absence_deduction:   this._r2(absenceDeduction),
      tax_deduction:       this._r2(taxDeduction),
      social_insurance:    this._r2(socialInsurance),
      loan_deduction:      0,
      other_deductions:    0,
      total_deductions:    this._r2(totalDeductions),
      net_salary:          this._r2(netSalary),
    };
  }

  /**
   * ترحيل مسير الرواتب → إنشاء قيد محاسبي
   * Dr: 512 رواتب وأجور
   * Dr: 5240 تأمينات (حصة الشركة)
   * Cr: 2130 رواتب مستحقة
   * Cr: 2131 تأمينات مستحقة
   * Cr: 2132 ضريبة دخل مستحقة
   */
  async post(companyId, runId, userId) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.company_id = $1", [companyId]);
      await client.query("SET LOCAL app.user_id = $1", [userId]);

      // قفل المسير
      const { rows: [run] } = await client.query(
        `SELECT * FROM payroll_runs
          WHERE id = $1 AND company_id = $2
          FOR UPDATE`,
        [runId, companyId]
      );
      if (!run) throw new ApiError(404, 'مسير الرواتب غير موجود');
      if (run.status === 'paid') throw new ApiError(400, 'المسير مُرحّل مسبقاً');
      if (run.status === 'cancelled') throw new ApiError(400, 'المسير ملغى');

      // جلب الحسابات
      const { rows: accounts } = await client.query(
        `SELECT code, id FROM chart_of_accounts
          WHERE company_id = $1
            AND code IN ('512','5240','2130','2131','2132')`,
        [companyId]
      );
      const acc = Object.fromEntries(accounts.map(a => [a.code, a.id]));
      for (const code of ['512','2130']) {
        if (!acc[code]) throw new ApiError(400, `الحساب ${code} غير موجود — شغّل 003_patches أولاً`);
      }

      // إجماليات
      const { rows: [totals] } = await client.query(
        `SELECT
           SUM(gross_salary)     AS gross,
           SUM(social_insurance) AS social_emp,
           SUM(tax_deduction)    AS tax,
           SUM(net_salary)       AS net
         FROM payroll_items WHERE payroll_run_id = $1`,
        [runId]
      );

      // حساب حصة الشركة في التأمينات (مثال: 12% من الأساسي)
      const { rows: [basic] } = await client.query(
        `SELECT SUM(basic_salary) AS total_basic
           FROM payroll_items WHERE payroll_run_id = $1`,
        [runId]
      );
      const employerSocial = parseFloat(basic.total_basic) * 0.12;

      // بناء سطور القيد
      const lines = [
        { account_id: acc['512'],  debit: totals.gross,          credit: 0, description: `رواتب ${run.run_number}` },
        { account_id: acc['5240'], debit: employerSocial,        credit: 0, description: 'تأمينات - حصة الشركة' },
        { account_id: acc['2130'], debit: 0, credit: totals.net,                 description: 'صافي رواتب مستحقة' },
        { account_id: acc['2131'], debit: 0, credit: parseFloat(totals.social_emp) + employerSocial, description: 'تأمينات مستحقة' },
        { account_id: acc['2132'], debit: 0, credit: totals.tax,                 description: 'ضريبة دخل مستحقة' },
      ];

      // إنشاء القيد عبر JournalHelper
      const journalEntry = await JournalHelper.createAndPost(client, {
        companyId,
        entryDate:    run.payment_date,
        description:  `مسير رواتب ${run.run_number} — ${run.period_month}/${run.period_year}`,
        sourceType:   'payroll',
        sourceId:     run.id,
        lines,
        userId,
      });

      // ربط المسير بالقيد
      await client.query(
        `UPDATE payroll_runs
            SET journal_entry_id = $1, status = 'paid', approved_by = $2, approved_at = now()
          WHERE id = $3`,
        [journalEntry.id, userId, runId]
      );

      await client.query('COMMIT');
      return { runId, journalEntryId: journalEntry.id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  _r2(v) { return Math.round(v * 100) / 100; }
}

module.exports = new PayrollService();