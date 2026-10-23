const {pool} = require('../config/pool');
const Notification = require('../models/Notification');

/**
 * يفحص كل شيء وينشئ الإشعارات
 * يُستدعى من Cron أو يدوياً
 */
const scanAll = async (companyId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stats = {
      low_stock: 0,
      expiring_soon: 0,
      expired: 0,
      invoice_overdue: 0,
      invoice_due_soon: 0,
    };

    // ─── 1) مخزون منخفض ───
    stats.low_stock = await scanLowStock(client, companyId);

    // ─── 2) batches قرب الانتهاء ───
    const expiring = await scanExpiringBatches(client, companyId);
    stats.expiring_soon = expiring.expiring;
    stats.expired = expiring.expired;

    // ─── 3) فواتير متأخرة ───
    stats.invoice_overdue = await scanOverdueInvoices(client, companyId);

    // ─── 4) فواتير تستحق قريباً ───
    stats.invoice_due_soon = await scanDueSoonInvoices(client, companyId);

    await client.query('COMMIT');
    return stats;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * منتجات تحت الحد الأدنى
 */
async function scanLowStock(client, companyId) {
  const r = await client.query(
    `SELECT p.id, p.sku, p.name, p.unit, p.min_stock_level,
            COALESCE(SUM(b.quantity), 0)::numeric AS current_quantity
     FROM products p
     LEFT JOIN product_batches b ON b.product_id = p.id
     WHERE p.company_id = $1 AND p.is_active = TRUE AND p.min_stock_level > 0
     GROUP BY p.id
     HAVING COALESCE(SUM(b.quantity), 0) < p.min_stock_level`,
    [companyId]
  );

  const notifications = r.rows.map((row) => ({
    companyId,
    type: 'low_stock',
    title: `مخزون منخفض: ${row.name}`,
    message: `الكمية الحالية (${row.current_quantity}) أقل من الحد الأدنى (${row.min_stock_level}).`,
    metadata: {
      product_id: row.id,
      sku: row.sku,
      current_quantity: Number(row.current_quantity),
      min_stock_level: Number(row.min_stock_level),
      unit: row.unit,
    },
    referenceType: 'product',
    referenceId: row.id,
    uniqueKey: `low_stock:${row.id}`,
  }));

  return Notification.createMany(client, notifications);
}

/**
 * batches قرب الانتهاء / منتهية
 */
async function scanExpiringBatches(client, companyId) {
  // قرب الانتهاء (خلال 30 يوم)
  const expiringRes = await client.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity,
            p.name AS product_name, p.sku,
            (b.expiry_date - CURRENT_DATE) AS days_left
     FROM product_batches b
     JOIN products p ON p.id = b.product_id
     WHERE b.company_id = $1 AND b.quantity > 0
       AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`,
    [companyId]
  );

  const expiringNotifications = expiringRes.rows.map((row) => ({
    companyId,
    type: 'expiry_warning',
    title: `قرب الانتهاء: ${row.product_name}`,
    message: `التشغيلة ${row.batch_number} تنتهي خلال ${row.days_left} يوم. الكمية: ${row.quantity}.`,
    metadata: {
      batch_id: row.id,
      batch_number: row.batch_number,
      expiry_date: row.expiry_date,
      quantity: Number(row.quantity),
      days_left: Number(row.days_left),
    },
    referenceType: 'batch',
    referenceId: row.id,
    // نعيد الإشعار كل 7 أيام (لتذكير)
    uniqueKey: `expiry_warning:${row.id}:${Math.floor(Number(row.days_left) / 7)}`,
  }));

  // منتهية الصلاحية وما زال بها مخزون
  const expiredRes = await client.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity,
            p.name AS product_name, p.sku
     FROM product_batches b
     JOIN products p ON p.id = b.product_id
     WHERE b.company_id = $1 AND b.quantity > 0
       AND b.expiry_date < CURRENT_DATE`,
    [companyId]
  );

  const expiredNotifications = expiredRes.rows.map((row) => ({
    companyId,
    type: 'expired_batch',
    title: `منتهي الصلاحية: ${row.product_name}`,
    message: `التشغيلة ${row.batch_number} انتهت في ${row.expiry_date}. الكمية المتبقية: ${row.quantity}.`,
    metadata: {
      batch_id: row.id,
      batch_number: row.batch_number,
      expiry_date: row.expiry_date,
      quantity: Number(row.quantity),
    },
    referenceType: 'batch',
    referenceId: row.id,
    uniqueKey: `expired:${row.id}`,
  }));

  const expiring = await Notification.createMany(client, expiringNotifications);
  const expired = await Notification.createMany(client, expiredNotifications);
  return { expiring, expired };
}

/**
 * فواتير متأخرة (due_date < اليوم)
 */
async function scanOverdueInvoices(client, companyId) {
  const r = await client.query(
    `SELECT i.id, i.invoice_number, i.invoice_type, i.due_date,
            (i.total - i.paid_amount)::numeric AS balance,
            (CURRENT_DATE - i.due_date) AS days_overdue,
            COALESCE(c.name, s.name) AS party_name
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.company_id = $1
       AND i.status IN ('unpaid', 'partial')
       AND i.due_date IS NOT NULL
       AND i.due_date < CURRENT_DATE`,
    [companyId]
  );

  const notifications = r.rows.map((row) => {
    const label = row.invoice_type === 'sale' ? 'عميل' : 'مورد';
    return {
      companyId,
      type: 'invoice_overdue',
      title: `فاتورة متأخرة: ${row.invoice_number}`,
      message: `الفاتورة متأخرة ${row.days_overdue} يوم. المتبقي: ${row.balance}. ${label}: ${row.party_name}.`,
      metadata: {
        invoice_id: row.id,
        invoice_number: row.invoice_number,
        invoice_type: row.invoice_type,
        due_date: row.due_date,
        balance: Number(row.balance),
        days_overdue: Number(row.days_overdue),
        party_name: row.party_name,
      },
      referenceType: 'invoice',
      referenceId: row.id,
      // نعيد التنبيه كل 7 أيام
      uniqueKey: `overdue:${row.id}:${Math.floor(Number(row.days_overdue) / 7)}`,
    };
  });

  return Notification.createMany(client, notifications);
}

/**
 * فواتير تستحق خلال 3 أيام
 */
async function scanDueSoonInvoices(client, companyId) {
  const r = await client.query(
    `SELECT i.id, i.invoice_number, i.invoice_type, i.due_date,
            (i.total - i.paid_amount)::numeric AS balance,
            (i.due_date - CURRENT_DATE) AS days_left,
            COALESCE(c.name, s.name) AS party_name
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.company_id = $1
       AND i.status IN ('unpaid', 'partial')
       AND i.due_date IS NOT NULL
       AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'`,
    [companyId]
  );

  const notifications = r.rows.map((row) => ({
    companyId,
    type: 'invoice_due_soon',
    title: `فاتورة تستحق قريباً: ${row.invoice_number}`,
    message: `تستحق خلال ${row.days_left} يوم. المتبقي: ${row.balance}.`,
    metadata: {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      due_date: row.due_date,
      balance: Number(row.balance),
      days_left: Number(row.days_left),
    },
    referenceType: 'invoice',
    referenceId: row.id,
    uniqueKey: `due_soon:${row.id}:${row.days_left}`,
  }));

  return Notification.createMany(client, notifications);
}

module.exports = { scanAll };