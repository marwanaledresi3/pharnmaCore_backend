// models/Report.js
const { pool } = require('../config/pool');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ============================================================
 * Helper: يبني قائمة معرّفات حساب + أبنائه (recursive)
 * ============================================================ */
async function accountTreeIds(companyId, code) {
  const r = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM chart_of_accounts
       WHERE company_id = $1 AND code = $2
       UNION ALL
       SELECT c.id FROM chart_of_accounts c
       JOIN tree t ON c.parent_id = t.id
       WHERE c.company_id = $1
     )
     SELECT id FROM tree`,
    [companyId, code]
  );
  return r.rows.map((x) => x.id);
}

class Report {
  /* ============================================================
   * Dashboard
   * ============================================================ */
  static async dashboard(companyId, { as_of = null } = {}) {
    const [arIds, apIds, cashIds, bankIds] = await Promise.all([
      accountTreeIds(companyId, '112'),
      accountTreeIds(companyId, '211'),
      accountTreeIds(companyId, '1111'),
      accountTreeIds(companyId, '1112'),
    ]);

    const [
      salesToday, salesMonth,
      purchasesMonth,
      receivables, payables,
      cashBalance, bankBalance,
      lowStockCount, expiringCount,
      overdueInvoices,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'sales'
           AND invoice_date = CURRENT_DATE AND status <> 'cancelled'`,
        [companyId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'sales'
           AND DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
           AND status <> 'cancelled'`,
        [companyId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'purchase'
           AND DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
           AND status <> 'cancelled'`,
        [companyId]
      ),
      arIds.length
        ? pool.query(
            `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = $1 AND je.status = 'posted'
               AND jel.account_id = ANY($2::uuid[])`,
            [companyId, arIds]
          )
        : Promise.resolve({ rows: [{ balance: 0 }] }),
      apIds.length
        ? pool.query(
            `SELECT COALESCE(SUM(jel.credit - jel.debit), 0)::numeric AS balance
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = $1 AND je.status = 'posted'
               AND jel.account_id = ANY($2::uuid[])`,
            [companyId, apIds]
          )
        : Promise.resolve({ rows: [{ balance: 0 }] }),
      cashIds.length
        ? pool.query(
            `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = $1 AND je.status = 'posted'
               AND jel.account_id = ANY($2::uuid[])`,
            [companyId, cashIds]
          )
        : Promise.resolve({ rows: [{ balance: 0 }] }),
      bankIds.length
        ? pool.query(
            `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = $1 AND je.status = 'posted'
               AND jel.account_id = ANY($2::uuid[])`,
            [companyId, bankIds]
          )
        : Promise.resolve({ rows: [{ balance: 0 }] }),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM products p
         WHERE p.company_id = $1 AND p.is_active = TRUE
           AND COALESCE((SELECT SUM(quantity) FROM product_batches WHERE product_id = p.id), 0) < p.min_stock_level`,
        [companyId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM product_batches
         WHERE company_id = $1 AND quantity > 0
           AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`,
        [companyId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total - paid_amount), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND status IN ('unpaid', 'partial')
           AND due_date < CURRENT_DATE`,
        [companyId]
      ),
    ]);

    const returnsMonth = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
       FROM returns
       WHERE company_id = $1 AND status = 'confirmed'
         AND DATE_TRUNC('month', return_date) = DATE_TRUNC('month', CURRENT_DATE)`,
      [companyId]
    );

    return {
      sales_today: salesToday.rows[0],
      sales_month: salesMonth.rows[0],
      purchases_month: purchasesMonth.rows[0],
      receivables: receivables.rows[0].balance,
      payables: payables.rows[0].balance,
      cash_balance: cashBalance.rows[0].balance,
      bank_balance: bankBalance.rows[0].balance,
      low_stock_count: lowStockCount.rows[0].count,
      expiring_batches_count: expiringCount.rows[0].count,
      overdue_invoices: overdueInvoices.rows[0],
      returns_month: returnsMonth.rows[0],
    };
  }

  /* ============================================================
   * Balance Sheet — INNER JOIN + أرباح محتجزة
   * ✅ FIX #6: يحسب net_profit (revenue - expense) ويضيفه لـ equity
   * ============================================================ */
  static async balanceSheet(companyId, { date_to } = {}) {
    const params = [companyId];
    const conds = ['je.company_id = $1', `je.status = 'posted'`];
    if (date_to) {
      params.push(date_to);
      conds.push(`je.entry_date <= $${params.length}`);
    }

    const r = await pool.query(
      `SELECT a.account_type, a.code, a.name,
              COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
       FROM chart_of_accounts a
       INNER JOIN journal_entry_lines jel ON jel.account_id = a.id
       INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE a.company_id = $1
         AND a.account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')
         AND ${conds.join(' AND ')}
       GROUP BY a.id, a.account_type, a.code, a.name
       ORDER BY a.account_type, a.code`,
      params
    );

    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const row of r.rows) {
      if (row.account_type === 'revenue') {
        totalRevenue += -Number(row.balance);  // revenue له رصيد credit
        continue;
      }
      if (row.account_type === 'expense') {
        totalExpense += Number(row.balance);
        continue;
      }

      const normalBalance = row.account_type === 'asset'
        ? Number(row.balance)
        : -Number(row.balance);

      const item = {
        code: row.code,
        name: row.name,
        balance: round2(normalBalance),
      };

      if (row.account_type === 'asset') assets.push(item);
      else if (row.account_type === 'liability') liabilities.push(item);
      else equity.push(item);
    }

    // ✅ FIX #6: أرباح محتجزة
    const netProfit = round2(totalRevenue - totalExpense);
    if (Math.abs(netProfit) > 0.01) {
      equity.push({
        code: '3999',
        name: 'أرباح محتجزة (صافي ربح الفترة)',
        balance: netProfit,
      });
    }

    const totalAssets = round2(assets.reduce((s, a) => s + a.balance, 0));
    const totalLiabilities = round2(liabilities.reduce((s, a) => s + a.balance, 0));
    const totalEquity = round2(equity.reduce((s, a) => s + a.balance, 0));

    return {
      date_to: date_to || new Date().toISOString().slice(0, 10),
      assets,
      liabilities,
      equity,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        liabilities_plus_equity: round2(totalLiabilities + totalEquity),
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      },
    };
  }

  /* ============================================================
   * Income Statement — INNER JOIN
   * ============================================================ */
  static async incomeStatement(companyId, { date_from, date_to }) {
    const params = [companyId];
    const conds = ['je.company_id = $1', `je.status = 'posted'`];

    if (date_from) { params.push(date_from); conds.push(`je.entry_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`je.entry_date <= $${params.length}`); }

    const r = await pool.query(
      `SELECT a.account_type, a.code, a.name,
              COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
       FROM chart_of_accounts a
       INNER JOIN journal_entry_lines jel ON jel.account_id = a.id
       INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE a.company_id = $1
         AND a.account_type IN ('revenue', 'expense')
         AND ${conds.join(' AND ')}
       GROUP BY a.id, a.account_type, a.code, a.name
       ORDER BY a.account_type, a.code`,
      params
    );

    const revenues = [];
    const expenses = [];

    for (const row of r.rows) {
      const display = row.account_type === 'revenue'
        ? -Number(row.balance)
        : Number(row.balance);

      const item = { code: row.code, name: row.name, balance: round2(display) };

      if (row.account_type === 'revenue') revenues.push(item);
      else expenses.push(item);
    }

    const totalRevenue = round2(revenues.reduce((s, a) => s + a.balance, 0));
    const totalExpense = round2(expenses.reduce((s, a) => s + a.balance, 0));
    const netProfit = round2(totalRevenue - totalExpense);

    return {
      date_from: date_from || null,
      date_to: date_to || new Date().toISOString().slice(0, 10),
      revenues,
      expenses,
      totals: {
        revenue: totalRevenue,
        expense: totalExpense,
        net_profit: netProfit,
      },
    };
  }

  /* ============================================================
   * General Ledger
   * ✅ FIX #3: استعلامان بدلاً من N+1
   * ✅ FIX #2: running_balance يبدأ من opening_balance
   * ============================================================ */
  static async generalLedger(companyId, { date_from, date_to, account_type } = {}) {
    // ─── 1) جلب كل السطور في استعلام واحد ─────────────────────────────
    const lineParams = [companyId];
    const lineConds = ['a.company_id = $1', `je.status = 'posted'`];

    if (account_type) {
      lineParams.push(account_type);
      lineConds.push(`a.account_type = $${lineParams.length}`);
    }
    if (date_from) {
      lineParams.push(date_from);
      lineConds.push(`je.entry_date >= $${lineParams.length}`);
    }
    if (date_to) {
      lineParams.push(date_to);
      lineConds.push(`je.entry_date <= $${lineParams.length}`);
    }

    const allLines = await pool.query(
      `SELECT
         a.id AS account_id,
         a.code,
         a.name,
         a.account_type,
         je.id AS journal_entry_id,
         je.entry_number,
         je.entry_date,
         je.description AS entry_description,
         jel.description AS line_description,
         jel.debit,
         jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts a ON a.id = jel.account_id
       WHERE ${lineConds.join(' AND ')}
       ORDER BY a.code, je.entry_date ASC, je.entry_number ASC`,
      lineParams
    );

    // ─── 2) تجميع حسب الحساب ─────────────────────────────────────────
    const byAccount = new Map();
    for (const row of allLines.rows) {
      if (!byAccount.has(row.account_id)) {
        byAccount.set(row.account_id, {
          account: {
            id: row.account_id,
            code: row.code,
            name: row.name,
            account_type: row.account_type,
          },
          opening_balance: 0,
          running_balance: 0,
          lines: [],
        });
      }
      const bucket = byAccount.get(row.account_id);
      bucket.lines.push({
        journal_entry_id: row.journal_entry_id,
        entry_number: row.entry_number,
        entry_date: row.entry_date,
        entry_description: row.entry_description,
        line_description: row.line_description,
        debit: Number(row.debit),
        credit: Number(row.credit),
      });
    }

    // ─── 3) opening_balance (استعلام واحد لكل الحسابات) ───────────────
    if (date_from) {
      const obParams = [companyId, date_from];
      const obConds = [
        'a.company_id = $1',
        `je.status = 'posted'`,
        `je.entry_date < $2`,
      ];
      if (account_type) {
        obParams.push(account_type);
        obConds.push(`a.account_type = $${obParams.length}`);
      }

      const opening = await pool.query(
        `SELECT a.id AS account_id,
                COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS bal
         FROM chart_of_accounts a
         JOIN journal_entry_lines jel ON jel.account_id = a.id
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE ${obConds.join(' AND ')}
         GROUP BY a.id`,
        obParams
      );

      for (const row of opening.rows) {
        if (byAccount.has(row.account_id)) {
          byAccount.get(row.account_id).opening_balance = Number(row.bal);
        }
      }
    }

    // ─── 4) running_balance (بدءاً من opening_balance) ────────────────
    for (const bucket of byAccount.values()) {
      let balance = bucket.opening_balance;
      for (const line of bucket.lines) {
        balance += line.debit - line.credit;
        line.running_balance = round2(balance);
      }
      bucket.running_balance = round2(balance);
    }

    // ─── 5) تحويل إلى مصفوفة (استبعاد الحسابات الفارغة) ───────────────
    const result = [];
    for (const bucket of byAccount.values()) {
      if (
        bucket.lines.length === 0 &&
        Math.abs(bucket.closing_balance || bucket.running_balance) < 0.01
      ) {
        continue;
      }
      result.push({
        account: bucket.account,
        opening_balance: round2(bucket.opening_balance),
        closing_balance: round2(bucket.running_balance),
        lines: bucket.lines,
      });
    }

    return result;
  }

  /**
   * كشف حساب واحد (يستخدمه `generalLedger` كـ helper أو خارجياً).
   * ✅ FIX #2: running_balance يبدأ من opening_balance
   */
  static async accountLedger(companyId, accountId, { date_from, date_to } = {}) {
    // 1) opening_balance أولاً
    let openingBalance = 0;
    if (date_from) {
      const ob = await pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS bal
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = $1
           AND je.company_id = $2
           AND je.status = 'posted'
           AND je.entry_date < $3`,
        [accountId, companyId, date_from]
      );
      openingBalance = Number(ob.rows[0].bal);
    }

    // 2) السطور
    const params = [accountId, companyId];
    const conds = [
      'jel.account_id = $1',
      'je.company_id = $2',
      `je.status = 'posted'`,
    ];
    if (date_from) { params.push(date_from); conds.push(`je.entry_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`je.entry_date <= $${params.length}`); }

    const r = await pool.query(
      `SELECT je.id AS journal_entry_id, je.entry_number, je.entry_date,
              je.description AS entry_description, jel.description AS line_description,
              jel.debit, jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE ${conds.join(' AND ')}
       ORDER BY je.entry_date ASC, je.entry_number ASC`,
      params
    );

    // 3) running_balance بدءاً من opening_balance
    let balance = openingBalance;
    const lines = r.rows.map((row) => {
      balance += Number(row.debit) - Number(row.credit);
      return { ...row, running_balance: round2(balance) };
    });

    return {
      opening_balance: round2(openingBalance),
      lines,
      closing_balance: round2(balance),
    };
  }

  /* ============================================================
   * AR Aging
   * ✅ FIX #5: الرصيد التاريخي — يستخدم payments حتى as_of_date
   * ============================================================ */
  static async arAging(companyId, { as_of_date } = {}) {
    const asOf = as_of_date || new Date().toISOString().slice(0, 10);

    const r = await pool.query(
      `SELECT
         c.id AS customer_id,
         c.name AS customer_name,
         i.id AS invoice_id,
         i.invoice_number,
         i.invoice_date,
         i.due_date,
         (i.total - COALESCE((
           SELECT SUM(p.amount) FROM payments p
           WHERE p.invoice_id = i.id
             AND p.payment_date <= $1::date
         ), 0))::numeric AS balance,
         GREATEST(0, ($1::date - i.due_date::date)) AS days_overdue
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.company_id = $2
         AND i.invoice_type = 'sales'
         AND i.status IN ('unpaid', 'partial', 'paid')
         AND i.invoice_date < ($1::date + INTERVAL '1 day')
       ORDER BY c.name, i.due_date`,
      [asOf, companyId]
    );

    const byCustomer = {};
    for (const row of r.rows) {
      const bal = Number(row.balance);
      if (Math.abs(bal) < 0.01) continue;  // تخطّي الفواتير المدفوعة قبل as_of

      const key = row.customer_id;
      if (!byCustomer[key]) {
        byCustomer[key] = {
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          current: 0,
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
          total: 0,
          invoices: [],
        };
      }

      const days = Number(row.days_overdue || 0);

      if (days <= 0) byCustomer[key].current += bal;
      else if (days <= 30) byCustomer[key].days_1_30 += bal;
      else if (days <= 60) byCustomer[key].days_31_60 += bal;
      else if (days <= 90) byCustomer[key].days_61_90 += bal;
      else byCustomer[key].days_over_90 += bal;

      byCustomer[key].total += bal;
      byCustomer[key].invoices.push({
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        due_date: row.due_date,
        balance: round2(bal),
        days_overdue: days,
      });
    }

    // ✅ round2 على كل المبالغ
    const customers = Object.values(byCustomer).map((c) => ({
      ...c,
      current: round2(c.current),
      days_1_30: round2(c.days_1_30),
      days_31_60: round2(c.days_31_60),
      days_61_90: round2(c.days_61_90),
      days_over_90: round2(c.days_over_90),
      total: round2(c.total),
    }));

    const totals = customers.reduce(
      (acc, c) => {
        acc.current += c.current;
        acc.days_1_30 += c.days_1_30;
        acc.days_31_60 += c.days_31_60;
        acc.days_61_90 += c.days_61_90;
        acc.days_over_90 += c.days_over_90;
        acc.total += c.total;
        return acc;
      },
      { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 0 }
    );

    // round2 على totals
    for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);

    return { as_of_date: asOf, customers, totals };
  }

  /* ============================================================
   * AP Aging
   * ✅ FIX #5: نفس منهج AR
   * ============================================================ */
  static async apAging(companyId, { as_of_date } = {}) {
    const asOf = as_of_date || new Date().toISOString().slice(0, 10);

    const r = await pool.query(
      `SELECT
         s.id AS supplier_id,
         s.name AS supplier_name,
         i.id AS invoice_id,
         i.invoice_number,
         i.invoice_date,
         i.due_date,
         (i.total - COALESCE((
           SELECT SUM(p.amount) FROM payments p
           WHERE p.invoice_id = i.id
             AND p.payment_date <= $1::date
         ), 0))::numeric AS balance,
         GREATEST(0, ($1::date - i.due_date::date)) AS days_overdue
       FROM invoices i
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.company_id = $2
         AND i.invoice_type = 'purchase'
         AND i.status IN ('unpaid', 'partial', 'paid')
         AND i.invoice_date <= $1::date
       ORDER BY s.name, i.due_date`,
      [asOf, companyId]
    );

    const bySupplier = {};
    for (const row of r.rows) {
      const bal = Number(row.balance);
      if (Math.abs(bal) < 0.01) continue;

      const key = row.supplier_id;
      if (!bySupplier[key]) {
        bySupplier[key] = {
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          current: 0,
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
          total: 0,
          invoices: [],
        };
      }

      const days = Number(row.days_overdue || 0);

      if (days <= 0) bySupplier[key].current += bal;
      else if (days <= 30) bySupplier[key].days_1_30 += bal;
      else if (days <= 60) bySupplier[key].days_31_60 += bal;
      else if (days <= 90) bySupplier[key].days_61_90 += bal;
      else bySupplier[key].days_over_90 += bal;

      bySupplier[key].total += bal;
      bySupplier[key].invoices.push({
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        due_date: row.due_date,
        balance: round2(bal),
        days_overdue: days,
      });
    }

    const suppliers = Object.values(bySupplier).map((s) => ({
      ...s,
      current: round2(s.current),
      days_1_30: round2(s.days_1_30),
      days_31_60: round2(s.days_31_60),
      days_61_90: round2(s.days_61_90),
      days_over_90: round2(s.days_over_90),
      total: round2(s.total),
    }));

    const totals = suppliers.reduce(
      (acc, s) => {
        acc.current += s.current;
        acc.days_1_30 += s.days_1_30;
        acc.days_31_60 += s.days_31_60;
        acc.days_61_90 += s.days_61_90;
        acc.days_over_90 += s.days_over_90;
        acc.total += s.total;
        return acc;
      },
      { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 0 }
    );

    for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);

    return { as_of_date: asOf, suppliers, totals };
  }

  /* ============================================================
   * Sales Report — parameterized
   * ============================================================ */
  static async salesReport(companyId, { date_from, date_to, group_by = 'day' }) {
    const params = [companyId];
    const conds = [
      `i.company_id = $1`,
      `i.invoice_type = 'sales'`,
      `i.status <> 'cancelled'`,
    ];

    if (date_from) { params.push(date_from); conds.push(`i.invoice_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`i.invoice_date <= $${params.length}`); }

    let groupExpr;
    switch (group_by) {
      case 'month': groupExpr = `DATE_TRUNC('month', i.invoice_date)`; break;
      case 'year':  groupExpr = `DATE_TRUNC('year', i.invoice_date)`; break;
      default:      groupExpr = `i.invoice_date`;
    }

    const byDate = await pool.query(
      `SELECT ${groupExpr} AS period,
              COUNT(*)::int AS invoices_count,
              COALESCE(SUM(i.total), 0)::numeric AS total_sales,
              COALESCE(SUM(i.paid_amount), 0)::numeric AS total_paid
       FROM invoices i
       WHERE ${conds.join(' AND ')}
       GROUP BY ${groupExpr}
       ORDER BY period DESC`,
      params
    );

    const byCustomer = await pool.query(
      `SELECT c.id, c.name, COUNT(i.id)::int AS invoices_count,
              COALESCE(SUM(i.total), 0)::numeric AS total
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE ${conds.join(' AND ')}
       GROUP BY c.id, c.name
       ORDER BY total DESC
       LIMIT 20`,
      params
    );

    const prodParams = [companyId];
    const prodConds = [
      `so.company_id = $1`,
      `so.status IN ('confirmed', 'invoiced')`,
    ];
    if (date_from) { prodParams.push(date_from); prodConds.push(`so.order_date >= $${prodParams.length}`); }
    if (date_to)   { prodParams.push(date_to);   prodConds.push(`so.order_date <= $${prodParams.length}`); }

    const byProduct = await pool.query(
      `SELECT p.id, p.name, p.sku,
              SUM(soi.quantity)::numeric AS quantity_sold,
              SUM(soi.line_total)::numeric AS revenue
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.order_id
       JOIN products p ON p.id = soi.product_id
       WHERE ${prodConds.join(' AND ')}
       GROUP BY p.id, p.name, p.sku
       ORDER BY revenue DESC
       LIMIT 20`,
      prodParams
    );

    const totals = byDate.rows.reduce(
      (acc, r) => {
        acc.invoices_count += r.invoices_count;
        acc.total_sales += Number(r.total_sales);
        acc.total_paid += Number(r.total_paid);
        return acc;
      },
      { invoices_count: 0, total_sales: 0, total_paid: 0 }
    );

    totals.total_sales = round2(totals.total_sales);
    totals.total_paid = round2(totals.total_paid);

    return {
      period: { date_from, date_to, group_by },
      totals,
      by_date: byDate.rows,
      by_customer: byCustomer.rows,
      by_product: byProduct.rows,
    };
  }

  /* ============================================================
   * Purchases Report
   * ============================================================ */
  static async purchasesReport(companyId, { date_from, date_to, group_by = 'day' }) {
    const params = [companyId];
    const conds = [`i.company_id = $1`, `i.invoice_type = 'purchase'`, `i.status <> 'cancelled'`];

    if (date_from) { params.push(date_from); conds.push(`i.invoice_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`i.invoice_date <= $${params.length}`); }

    const groupExpr = group_by === 'month' ? `DATE_TRUNC('month', i.invoice_date)`
                     : group_by === 'year' ? `DATE_TRUNC('year', i.invoice_date)`
                     : `i.invoice_date`;

    const byDate = await pool.query(
      `SELECT ${groupExpr} AS period,
              COUNT(*)::int AS invoices_count,
              COALESCE(SUM(i.total), 0)::numeric AS total_purchases,
              COALESCE(SUM(i.paid_amount), 0)::numeric AS total_paid
       FROM invoices i
       WHERE ${conds.join(' AND ')}
       GROUP BY ${groupExpr}
       ORDER BY period DESC`,
      params
    );

    const bySupplier = await pool.query(
      `SELECT s.id, s.name, COUNT(i.id)::int AS invoices_count,
              COALESCE(SUM(i.total), 0)::numeric AS total
       FROM invoices i
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE ${conds.join(' AND ')}
       GROUP BY s.id, s.name
       ORDER BY total DESC
       LIMIT 20`,
      params
    );

    const totals = byDate.rows.reduce(
      (acc, r) => {
        acc.invoices_count += r.invoices_count;
        acc.total_purchases += Number(r.total_purchases);
        acc.total_paid += Number(r.total_paid);
        return acc;
      },
      { invoices_count: 0, total_purchases: 0, total_paid: 0 }
    );

    totals.total_purchases = round2(totals.total_purchases);
    totals.total_paid = round2(totals.total_paid);

    return {
      period: { date_from, date_to, group_by },
      totals,
      by_date: byDate.rows,
      by_supplier: bySupplier.rows,
    };
  }

  /* ============================================================
   * Inventory Report
   * ============================================================ */
  static async inventoryReport(companyId, { warehouse_id } = {}) {
    const params = [companyId];
    let whCond = '';
    if (warehouse_id) {
      params.push(warehouse_id);
      whCond = `AND b.warehouse_id = $${params.length}`;
    }

    const r = await pool.query(
      `SELECT p.id, p.sku, p.name, p.unit, p.min_stock_level,
              w.id AS warehouse_id, w.name AS warehouse_name,
              COALESCE(SUM(b.quantity), 0)::numeric AS total_quantity,
              COALESCE(SUM(b.quantity * COALESCE(b.cost_price_base, b.cost_price)), 0)::numeric AS total_value,
              COUNT(DISTINCT b.id)::int AS batches_count,
              MIN(b.expiry_date) AS nearest_expiry
       FROM products p
       LEFT JOIN product_batches b ON b.product_id = p.id AND b.quantity > 0 ${whCond}
       LEFT JOIN warehouses w ON w.id = b.warehouse_id
       WHERE p.company_id = $1 AND p.is_active = TRUE
       GROUP BY p.id, w.id
       ORDER BY p.name`,
      params
    );

    const summary = await pool.query(
      `SELECT COUNT(*)::int AS products_count,
              COALESCE(SUM(quantity * COALESCE(cost_price_base, cost_price)), 0)::numeric AS total_value,
              COALESCE(SUM(quantity), 0)::numeric AS total_units
       FROM product_batches WHERE company_id = $1 AND quantity > 0`,
      [companyId]
    );

    const expiring = await pool.query(
      `SELECT b.id, b.batch_number, b.expiry_date, b.quantity, b.cost_price,
              p.name AS product_name, p.sku,
              w.name AS warehouse_name,
              (b.expiry_date - CURRENT_DATE) AS days_left
       FROM product_batches b
       JOIN products p ON p.id = b.product_id
       JOIN warehouses w ON w.id = b.warehouse_id
       WHERE b.company_id = $1 AND b.quantity > 0
         AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
       ORDER BY b.expiry_date ASC`,
      [companyId]
    );

    const lowStock = await pool.query(
      `SELECT p.id, p.sku, p.name, p.min_stock_level,
              COALESCE(SUM(b.quantity), 0)::numeric AS current_quantity
       FROM products p
       LEFT JOIN product_batches b ON b.product_id = p.id
       WHERE p.company_id = $1 AND p.is_active = TRUE AND p.min_stock_level > 0
       GROUP BY p.id
       HAVING COALESCE(SUM(b.quantity), 0) < p.min_stock_level
       ORDER BY (p.min_stock_level - COALESCE(SUM(b.quantity), 0)) DESC`,
      [companyId]
    );

    return {
      summary: summary.rows[0],
      items: r.rows,
      expiring_soon: expiring.rows,
      low_stock: lowStock.rows,
    };
  }

  /* ============================================================
   * Top Products
   * ============================================================ */
  static async topProducts(companyId, { date_from, date_to, limit = 10 } = {}) {
    const params = [companyId];
    const conds = [`so.company_id = $1`, `so.status IN ('confirmed', 'invoiced')`];

    if (date_from) { params.push(date_from); conds.push(`so.order_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`so.order_date <= $${params.length}`); }

    params.push(limit);

    const r = await pool.query(
      `SELECT p.id, p.sku, p.name,
              SUM(soi.quantity)::numeric AS quantity_sold,
              SUM(soi.line_total)::numeric AS revenue,
              AVG(soi.unit_price)::numeric AS avg_price
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.order_id
       JOIN products p ON p.id = soi.product_id
       WHERE ${conds.join(' AND ')}
       GROUP BY p.id, p.sku, p.name
       ORDER BY revenue DESC
       LIMIT $${params.length}`,
      params
    );

    return r.rows;
  }

  /* ============================================================
   * Tax Summary — parameterized
   * ============================================================ */
  static async taxSummary(companyId, { date_from, date_to }) {
    // ضريبة المخرجات (من invoice_items + invoices)
    const outParams = [companyId];
    const outConds = [
      `i.company_id = $1`,
      `i.invoice_type = 'sales'`,
      `i.status <> 'cancelled'`,
    ];
    if (date_from) { outParams.push(date_from); outConds.push(`i.invoice_date >= $${outParams.length}`); }
    if (date_to)   { outParams.push(date_to);   outConds.push(`i.invoice_date <= $${outParams.length}`); }

    const output = await pool.query(
      `SELECT COALESCE(SUM(ii.tax_amount), 0)::numeric AS total
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE ${outConds.join(' AND ')}`,
      outParams
    );

    // ضريبة المدخلات
    const inParams = [companyId];
    const inConds = [
      `i.company_id = $1`,
      `i.invoice_type = 'purchase'`,
      `i.status <> 'cancelled'`,
    ];
    if (date_from) { inParams.push(date_from); inConds.push(`i.invoice_date >= $${inParams.length}`); }
    if (date_to)   { inParams.push(date_to);   inConds.push(`i.invoice_date <= $${inParams.length}`); }

    const input = await pool.query(
      `SELECT COALESCE(SUM(ii.tax_amount), 0)::numeric AS total
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE ${inConds.join(' AND ')}`,
      inParams
    );

    const outputTotal = round2(Number(output.rows[0].total));
    const inputTotal = round2(Number(input.rows[0].total));

    return {
      period: { date_from, date_to },
      output_tax: outputTotal,
      input_tax: inputTotal,
      net_payable: round2(outputTotal - inputTotal),
    };
  }

  /* ============================================================
   * Trial Balance — INNER JOIN
   * ============================================================ */
  static async trialBalance(companyId, { date_from, date_to } = {}) {
    const params = [companyId];
    const conds = ['je.company_id = $1', `je.status = 'posted'`];

    if (date_from) { params.push(date_from); conds.push(`je.entry_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`je.entry_date <= $${params.length}`); }

    const r = await pool.query(
      `SELECT a.id, a.code, a.name, a.account_type,
              COALESCE(SUM(jel.debit), 0)::numeric AS total_debit,
              COALESCE(SUM(jel.credit), 0)::numeric AS total_credit,
              COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
       FROM chart_of_accounts a
       INNER JOIN journal_entry_lines jel ON jel.account_id = a.id
       INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE ${conds.join(' AND ')} AND a.company_id = $1
       GROUP BY a.id, a.code, a.name, a.account_type
       HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
       ORDER BY a.code`,
      params
    );

    const accounts = r.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      account_type: row.account_type,
      total_debit: round2(Number(row.total_debit)),
      total_credit: round2(Number(row.total_credit)),
      balance: ['asset', 'expense'].includes(row.account_type)
        ? round2(Number(row.total_debit) - Number(row.total_credit))
        : round2(Number(row.total_credit) - Number(row.total_debit)),
      balance_side:
        Math.abs(Number(row.total_debit) - Number(row.total_credit)) < 0.005
          ? 'zero'
          : Number(row.total_debit) > Number(row.total_credit)
            ? 'debit'
            : 'credit',
      raw_balance: round2(Number(row.balance)),
    }));

    const totals = accounts.reduce(
      (acc, a) => ({
        debit: acc.debit + a.total_debit,
        credit: acc.credit + a.total_credit,
      }),
      { debit: 0, credit: 0 }
    );

    return {
      date_from: date_from || null,
      date_to: date_to || new Date().toISOString().slice(0, 10),
      accounts,
      totals: {
        debit: round2(totals.debit),
        credit: round2(totals.credit),
        balanced: Math.abs(totals.debit - totals.credit) < 0.01,
        difference: round2(totals.debit - totals.credit),
      },
    };
  }
}

module.exports = Report;