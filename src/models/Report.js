const {pool} = require('../config/pool');

class Report {
  /**
   * ═══════════════════════════════════════════
   * Dashboard - ملخص شامل
   * ═══════════════════════════════════════════
   */
  static async dashboard(companyId) {
    const [
      salesToday, salesMonth,
      purchasesMonth,
      receivables, payables,
      cashBalance, bankBalance,
      lowStockCount, expiringCount,
      overdueInvoices,
    ] = await Promise.all([
      // مبيعات اليوم
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'sale'
           AND invoice_date = CURRENT_DATE AND status <> 'cancelled'`,
        [companyId]
      ),
      // مبيعات الشهر
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'sale'
           AND DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
           AND status <> 'cancelled'`,
        [companyId]
      ),
      // مشتريات الشهر
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS amount
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'purchase'
           AND DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
           AND status <> 'cancelled'`,
        [companyId]
      ),
      // ذمم مدينة
      pool.query(
        `SELECT COALESCE(SUM(total - paid_amount), 0)::numeric AS balance
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'sale'
           AND status IN ('unpaid', 'partial')`,
        [companyId]
      ),
      // ذمم دائنة
      pool.query(
        `SELECT COALESCE(SUM(total - paid_amount), 0)::numeric AS balance
         FROM invoices
         WHERE company_id = $1 AND invoice_type = 'purchase'
           AND status IN ('unpaid', 'partial')`,
        [companyId]
      ),
      // رصيد الصندوق (من القيود)
      pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts a ON a.id = jel.account_id
         WHERE je.company_id = $1 AND je.status = 'posted'
           AND a.code = '1111'`,
        [companyId]
      ),
      // رصيد البنك
      pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts a ON a.id = jel.account_id
         WHERE je.company_id = $1 AND je.status = 'posted'
           AND a.code = '1112'`,
        [companyId]
      ),
      // منتجات تحت الحد الأدنى
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM products p
         WHERE p.company_id = $1 AND p.is_active = TRUE
           AND COALESCE((SELECT SUM(quantity) FROM product_batches WHERE product_id = p.id), 0) < p.min_stock_level`,
        [companyId]
      ),
      // batches قرب الانتهاء (30 يوم)
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM product_batches
         WHERE company_id = $1 AND quantity > 0
           AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`,
        [companyId]
      ),
      // فواتير متأخرة
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

  /**
   * ═══════════════════════════════════════════
   * Balance Sheet - الميزانية العمومية
   * ═══════════════════════════════════════════
   */
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
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${conds.join(' AND ')}
       WHERE a.company_id = $1
         AND a.account_type IN ('asset', 'liability', 'equity')
       GROUP BY a.id
       ORDER BY a.account_type, a.code`,
      params
    );

    // تصنيف حسب النوع
    const assets = [];
    const liabilities = [];
    const equity = [];

    for (const row of r.rows) {
      // الأصول رصيدها مدين (+)، الخصوم وحقوق الملكية رصيدها دائن (-)
      const normalBalance = row.account_type === 'asset'
        ? Number(row.balance)
        : -Number(row.balance);

      const item = {
        code: row.code,
        name: row.name,
        balance: normalBalance,
      };

      if (row.account_type === 'asset') assets.push(item);
      else if (row.account_type === 'liability') liabilities.push(item);
      else equity.push(item);
    }

    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
    const totalEquity = equity.reduce((s, a) => s + a.balance, 0);

    return {
      date_to: date_to || new Date().toISOString().slice(0, 10),
      assets,
      liabilities,
      equity,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        liabilities_plus_equity: totalLiabilities + totalEquity,
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      },
    };
  }

  /**
   * ═══════════════════════════════════════════
   * Income Statement - قائمة الدخل
   * ═══════════════════════════════════════════
   */
  static async incomeStatement(companyId, { date_from, date_to }) {
    const params = [companyId];
    const conds = ['je.company_id = $1', `je.status = 'posted'`];

    if (date_from) {
      params.push(date_from);
      conds.push(`je.entry_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conds.push(`je.entry_date <= $${params.length}`);
    }

    const r = await pool.query(
      `SELECT a.account_type, a.code, a.name,
              COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${conds.join(' AND ')}
       WHERE a.company_id = $1
         AND a.account_type IN ('revenue', 'expense')
       GROUP BY a.id
       ORDER BY a.account_type, a.code`,
      params
    );

    const revenues = [];
    const expenses = [];

    for (const row of r.rows) {
      // الإيرادات رصيدها دائن (-) → نعكس الإشارة للعرض
      // المصروفات رصيدها مدين (+) → تبقى
      const display = row.account_type === 'revenue'
        ? -Number(row.balance)
        : Number(row.balance);

      const item = { code: row.code, name: row.name, balance: display };

      if (row.account_type === 'revenue') revenues.push(item);
      else expenses.push(item);
    }

    const totalRevenue = revenues.reduce((s, a) => s + a.balance, 0);
    const totalExpense = expenses.reduce((s, a) => s + a.balance, 0);
    const netProfit = totalRevenue - totalExpense;

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

  /**
   * ═══════════════════════════════════════════
   * General Ledger - دفتر الأستاذ (كل الحسابات)
   * ═══════════════════════════════════════════
   */
  static async generalLedger(companyId, { date_from, date_to, account_type } = {}) {
    const params = [companyId];
    const conds = ['a.company_id = $1'];

    if (account_type) {
      params.push(account_type);
      conds.push(`a.account_type = $${params.length}`);
    }

    // جلب الحسابات
    const accounts = await pool.query(
      `SELECT id, code, name, account_type FROM chart_of_accounts a
       WHERE ${conds.join(' AND ')}
       ORDER BY code`,
      params
    );

    // جلب حركات كل حساب
    const result = [];
    for (const acc of accounts.rows) {
      const lines = await this.accountLedger(companyId, acc.id, { date_from, date_to });
      if (lines.lines.length === 0 && Math.abs(lines.closing_balance) < 0.01) {
        continue; // تخطى الحسابات الفارغة
      }
      result.push({
        account: acc,
        opening_balance: lines.opening_balance,
        closing_balance: lines.closing_balance,
        lines: lines.lines,
      });
    }

    return result;
  }

  /**
   * كشف حساب واحد (يُستخدم من AccountController + generalLedger)
   */
  static async accountLedger(companyId, accountId, { date_from, date_to } = {}) {
    const params = [accountId, companyId];
    const conds = ['jel.account_id = $1', 'je.company_id = $2', `je.status = 'posted'`];

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

    let runningBalance = 0;
    const lines = r.rows.map((row) => {
      runningBalance += Number(row.debit) - Number(row.credit);
      return { ...row, running_balance: runningBalance };
    });

    let openingBalance = 0;
    if (date_from) {
      const ob = await pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS bal
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = $1 AND je.company_id = $2
           AND je.status = 'posted' AND je.entry_date < $3`,
        [accountId, companyId, date_from]
      );
      openingBalance = Number(ob.rows[0].bal);
    }

    return {
      opening_balance: openingBalance,
      lines,
      closing_balance: openingBalance + runningBalance,
    };
  }

  /**
   * ═══════════════════════════════════════════
   * AR Aging - أعمار الذمم المدينة
   * ═══════════════════════════════════════════
   */
  static async arAging(companyId, { as_of_date } = {}) {
    const asOf = as_of_date || new Date().toISOString().slice(0, 10);

    const r = await pool.query(
      `SELECT c.id AS customer_id, c.name AS customer_name,
              i.id AS invoice_id, i.invoice_number, i.invoice_date, i.due_date,
              (i.total - i.paid_amount)::numeric AS balance,
              (DATE $1::date - i.due_date) AS days_overdue
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.company_id = $2 AND i.invoice_type = 'sale'
         AND i.status IN ('unpaid', 'partial')
         AND i.invoice_date <= $1::date
       ORDER BY c.name, i.due_date`,
      [asOf, companyId]
    );

    // تجميع حسب العميل مع buckets
    const byCustomer = {};
    for (const row of r.rows) {
      const key = row.customer_id;
      if (!byCustomer[key]) {
        byCustomer[key] = {
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          current: 0,        // لم يستحق بعد
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
          total: 0,
          invoices: [],
        };
      }

      const bal = Number(row.balance);
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
        balance: bal,
        days_overdue: days,
      });
    }

    const customers = Object.values(byCustomer);
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

    return { as_of_date: asOf, customers, totals };
  }

  /**
   * ═══════════════════════════════════════════
   * AP Aging - أعمار الذمم الدائنة
   * ═══════════════════════════════════════════
   */
  static async apAging(companyId, { as_of_date } = {}) {
    const asOf = as_of_date || new Date().toISOString().slice(0, 10);

    const r = await pool.query(
      `SELECT s.id AS supplier_id, s.name AS supplier_name,
              i.id AS invoice_id, i.invoice_number, i.invoice_date, i.due_date,
              (i.total - i.paid_amount)::numeric AS balance,
              (DATE $1::date - i.due_date) AS days_overdue
       FROM invoices i
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.company_id = $2 AND i.invoice_type = 'purchase'
         AND i.status IN ('unpaid', 'partial')
         AND i.invoice_date <= $1::date
       ORDER BY s.name, i.due_date`,
      [asOf, companyId]
    );

    const bySupplier = {};
    for (const row of r.rows) {
      const key = row.supplier_id;
      if (!bySupplier[key]) {
        bySupplier[key] = {
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0,
          total: 0, invoices: [],
        };
      }

      const bal = Number(row.balance);
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
        balance: bal,
        days_overdue: days,
      });
    }

    const suppliers = Object.values(bySupplier);
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

    return { as_of_date: asOf, suppliers, totals };
  }

  /**
   * ═══════════════════════════════════════════
   * Sales Report
   * ═══════════════════════════════════════════
   */
  static async salesReport(companyId, { date_from, date_to, group_by = 'day' }) {
    const params = [companyId];
    const conds = [
      `i.company_id = $1`,
      `i.invoice_type = 'sale'`,
      `i.status <> 'cancelled'`,
    ];

    if (date_from) { params.push(date_from); conds.push(`i.invoice_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`i.invoice_date <= $${params.length}`); }

    let groupExpr;
    let dateFormat;
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

    const byProduct = await pool.query(
      `SELECT p.id, p.name, p.sku,
              SUM(soi.quantity)::numeric AS quantity_sold,
              SUM(soi.line_total)::numeric AS revenue
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.order_id
       JOIN products p ON p.id = soi.product_id
       WHERE so.company_id = $1 AND so.status IN ('confirmed', 'invoiced')
         ${date_from ? `AND so.order_date >= '${date_from}'` : ''}
         ${date_to ? `AND so.order_date <= '${date_to}'` : ''}
       GROUP BY p.id, p.name, p.sku
       ORDER BY revenue DESC
       LIMIT 20`,
      [companyId]
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

    return {
      period: { date_from, date_to, group_by },
      totals,
      by_date: byDate.rows,
      by_customer: byCustomer.rows,
      by_product: byProduct.rows,
    };
  }

  /**
   * ═══════════════════════════════════════════
   * Purchases Report
   * ═══════════════════════════════════════════
   */
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

    return {
      period: { date_from, date_to, group_by },
      totals,
      by_date: byDate.rows,
      by_supplier: bySupplier.rows,
    };
  }

  /**
   * ═══════════════════════════════════════════
   * Inventory Report
   * ═══════════════════════════════════════════
   */
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
              COALESCE(SUM(b.quantity * b.cost_price), 0)::numeric AS total_value,
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

    // ملخص
    const summary = await pool.query(
      `SELECT COUNT(*)::int AS products_count,
              COALESCE(SUM(quantity * cost_price), 0)::numeric AS total_value,
              COALESCE(SUM(quantity), 0)::numeric AS total_units
       FROM product_batches WHERE company_id = $1 AND quantity > 0`,
      [companyId]
    );

    // قرب الانتهاء
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

    // تحت الحد الأدنى
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

  /**
   * ═══════════════════════════════════════════
   * Top Products
   * ═══════════════════════════════════════════
   */
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
       GROUP BY p.id
       ORDER BY revenue DESC
       LIMIT $${params.length}`,
      params
    );

    return r.rows;
  }

  /**
   * ═══════════════════════════════════════════
   * Tax Summary
   * ═══════════════════════════════════════════
   */
  static async taxSummary(companyId, { date_from, date_to }) {
    const params = [companyId];
    const conds = ['je.company_id = $1', `je.status = 'posted'`];

    if (date_from) { params.push(date_from); conds.push(`je.entry_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conds.push(`je.entry_date <= $${params.length}`); }

    // ضريبة المخرجات (من فواتير البيع)
    const output = await pool.query(
      `SELECT COALESCE(SUM(soi.tax_amount), 0)::numeric AS total
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.order_id
       WHERE so.company_id = $1 AND so.status IN ('confirmed', 'invoiced')
         ${date_from ? `AND so.order_date >= '${date_from}'` : ''}
         ${date_to ? `AND so.order_date <= '${date_to}'` : ''}`,
      [companyId]
    );

    // ضريبة المدخلات (من فواتير الشراء)
    const input = await pool.query(
      `SELECT COALESCE(SUM(poi.tax_amount), 0)::numeric AS total
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.order_id
       WHERE po.company_id = $1 AND po.status IN ('confirmed', 'invoiced')
         ${date_from ? `AND po.order_date >= '${date_from}'` : ''}
         ${date_to ? `AND po.order_date <= '${date_to}'` : ''}`,
      [companyId]
    );

    const outputTotal = Number(output.rows[0].total);
    const inputTotal = Number(input.rows[0].total);

    return {
      period: { date_from, date_to },
      output_tax: outputTotal,
      input_tax: inputTotal,
      net_payable: outputTotal - inputTotal,
    };
  }
}

module.exports = Report;