/**
 * اختبار confirmByToken (QR).
 * - ينشئ طلباً + يوافق
 * - يستخرج token من QR URL
 * - يؤكد عبر confirmByToken
 * - يتحقق من أن QR أصبح مستخدماً
 */
const { pool } = require('../src/config/pool');
const service = require('../src/services/purchaseOrderService');
const QRService = require('../src/services/qrService');

const BUYER_COMPANY_ID = process.env.BUYER_COMPANY_ID || 'b0000000-0000-0000-0000-000000000001';
const SUPPLIER_COMPANY_ID = process.env.SUPPLIER_COMPANY_ID || '434f02b1-a952-4351-867a-98308938259b';
const NETWORK_SUPPLIER_ID = process.env.SUPPLIER_ID || 'a643808d-640a-4250-a3a0-d768c46c8410';
const CURRENCY_ID = process.env.CURRENCY_ID || 'ce15fcb9-4e1f-4feb-9c34-6f0771b35e6f';
const SUPPLIER_PRODUCT_ID = process.env.SUPPLIER_PRODUCT_ID || 'ef0267cc-61ad-4c1c-97e2-0afea87ee4ff';
const LOCAL_PRODUCT_ID = process.env.LOCAL_PRODUCT_ID || '17079b16-b5b4-4813-89b2-95f7cf050c40';

const BUYER_USER_ID    = process.env.BUYER_USER_ID    || 'b8505554-6f90-44aa-bfd1-d8b03000fb6c';
const SUPPLIER_USER_ID = process.env.SUPPLIER_USER_ID || '1df08bc3-5362-4309-b1ce-2c7cdf15831d';

if (!BUYER_USER_ID || !SUPPLIER_USER_ID) {
  console.error('❌ ضع BUYER_USER_ID و SUPPLIER_USER_ID في البيئة');
  process.exit(1);
}

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  اختبار confirmByToken (QR)');
  console.log('═══════════════════════════════════════════\n');

  const checks = [];
  const addCheck = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // ── 1) إنشاء + اعتماد ──
  console.log('📝 تحضير الطلب (create + approve)...');

  const created = await service.create(BUYER_COMPANY_ID, BUYER_USER_ID, {
    supplier_id: NETWORK_SUPPLIER_ID,
    currency_id: CURRENCY_ID,
    items: [{
      product_id: LOCAL_PRODUCT_ID,
      supplier_product_id: SUPPLIER_PRODUCT_ID,
      paid_quantity: 2,
    }],
    payment_type: 'cash',
    payment_method: 'bank',
  });
  console.log(`   ✓ create: ${created.order_number} (${created.status})`);

  const approved = await service.approve(
    SUPPLIER_COMPANY_ID,
    SUPPLIER_USER_ID,
    created.id,
    { qrMode: 'both', qrTtlDays: 7 }
  );
  console.log(`   ✓ approve: ${approved.status}`);
  console.log(`   ✓ QR PIN: ${approved.qr.pin}`);
  console.log(`   ✓ QR expires: ${approved.qr.expires_at}`);

  // ── 2) استخرج token من URL ──
  const url = approved.qr.url;
  const tokenMatch = url.match(/token=([^&]+)/);
  if (!tokenMatch) {
    console.error('❌ لم أجد token في QR URL:', url);
    process.exit(1);
  }
  const token = decodeURIComponent(tokenMatch[1]);
  console.log(`   ✓ token مستخرج (${token.length} حرف)`);

  // ── 3) معاينة عبر QR (قبل التأكيد) ──
  console.log('\n🔍 معاينة عبر QR...');
  const preview = await service.previewByToken(token);
  addCheck('previewByToken يعيد بيانات', Boolean(preview), preview ? `order = ${preview.order.order_number}` : 'null');
  if (preview) {
    addCheck('preview: حالة الطلب approved', preview.order.status === 'approved', `status = ${preview.order.status}`);
    addCheck('preview: بنود موجودة', preview.items.length > 0, `عدد = ${preview.items.length}`);
    addCheck('preview: token لم يُستخدم بعد', preview.delivery_token.used_at === null, `used_at = ${preview.delivery_token.used_at}`);
  }

  // ── 4) التقط snapshot قبل ──
  const before = await snapshot(created.id);

  // ── 5) تأكيد عبر QR ──
  console.log('\n⏳ تنفيذ confirmByToken...');
  const t0 = Date.now();
  let result;
  try {
    result = await service.confirmByToken(BUYER_COMPANY_ID, BUYER_USER_ID, token);
  } catch (err) {
    console.error('\n❌ فشل confirmByToken:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
  const elapsed = Date.now() - t0;
  console.log(`✅ confirmByToken نجح (${elapsed}ms)`);
  console.log(JSON.stringify(result, null, 2));

  // ── 6) snapshot بعد ──
  const after = await snapshot(created.id);

  // ── 7) فحوصات ──
  addCheck('حالة الطلب = confirmed', after.order?.status === 'confirmed', `status = ${after.order?.status}`);
  addCheck('journal_entry_id موجود', Boolean(after.order?.journal_entry_id), after.order?.journal_entry_id);
  addCheck('مخزون المورد نقص', before.supplierStock.total - after.supplierStock.total > 0,
    `قبل: ${before.supplierStock.total}، بعد: ${after.supplierStock.total}`);
  addCheck('مخزون المشتري زاد', after.buyerStock.total - before.buyerStock.total > 0,
    `قبل: ${before.buyerStock.total}، بعد: ${after.buyerStock.total}`);
  addCheck('فاتورة مبيعات موجودة', after.supplierInvoices.length === 1, `عدد = ${after.supplierInvoices.length}`);
  addCheck('دفعة موجودة (cash) - طرفان', after.payments.length === 2, `عدد = ${after.payments.length}`);

  // ← الأهم: QR يجب أن يكون مستخدماً
  addCheck(
    'QR: used_at مملوء',
    after.qr?.used_at !== null,
    `used_at = ${after.qr?.used_at}`
  );
  addCheck(
    'QR: used_mode = authenticated',
    after.qr?.used_mode === 'authenticated',
    `used_mode = ${after.qr?.used_mode}`
  );
  addCheck(
    'QR: used_by = المشتري',
    after.qr?.used_by === BUYER_USER_ID,
    `used_by = ${after.qr?.used_by}`
  );
  addCheck(
    'QR: لا يوجد QR نشط',
    after.activeQR === 0,
    `active = ${after.activeQR}`
  );

  // ── 8) محاولة استخدام QR مرة ثانية → يجب أن تفشل ──
  console.log('\n🔒 محاولة استخدام QR مرة ثانية...');
  try {
    await service.confirmByToken(BUYER_COMPANY_ID, BUYER_USER_ID, token);
    addCheck('رفض إعادة استخدام QR', false, 'لم يفشل (متوقع 409)');
  } catch (err) {
    const expected = err.statusCode === 409 || /مستخدم مسبقاً/.test(err.message);
    addCheck('رفض إعادة استخدام QR', expected, `خطأ = ${err.message}`);
  }

  // ── 9) محاولة استخدام token خاطئ ──
  console.log('\n🔒 محاولة token مزيف...');
  try {
    await service.confirmByToken(BUYER_COMPANY_ID, BUYER_USER_ID, 'eyJhbGciOiJIUzI1NiJ9.fake.fake');
    addCheck('رفض token مزيف', false, 'لم يفشل');
  } catch (err) {
    addCheck('رفض token مزيف', true, `خطأ = ${err.message}`);
  }

  // ── النتيجة ──
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  النتيجة: ${passed}/${total}`);
  console.log(`═══════════════════════════════════════════\n`);

  if (passed !== total) {
    console.log('❌ فشل الاختبار');
    process.exit(1);
  }
  console.log('✅ نجح الاختبار بالكامل');
}

async function snapshot(orderId) {
  const client = await pool.connect();
  try {
    const order = (await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1`, [orderId]
    )).rows[0];

    const supplierStock = (await client.query(
      `SELECT COALESCE(SUM(pb.quantity), 0)::numeric AS total
       FROM product_batches pb JOIN warehouses w ON w.id = pb.warehouse_id
       WHERE w.company_id = $1`, [SUPPLIER_COMPANY_ID]
    )).rows[0];

    const buyerStock = (await client.query(
      `SELECT COALESCE(SUM(pb.quantity), 0)::numeric AS total
       FROM product_batches pb JOIN warehouses w ON w.id = pb.warehouse_id
       WHERE w.company_id = $1`, [BUYER_COMPANY_ID]
    )).rows[0];

    const supplierInvoices = (await client.query(
      `SELECT id, invoice_number, status, paid_amount, total
       FROM invoices
       WHERE company_id = $1 AND reference_type = 'purchase_order' AND reference_id = $2`,
      [SUPPLIER_COMPANY_ID, orderId]
    )).rows;

    const payments = (await client.query(
      `SELECT id, company_id, payment_type, amount, method, reference
       FROM payments WHERE reference = 'PO-' || $1`,
      [order.order_number]
    )).rows;

    const qr = (await client.query(
      `SELECT id, mode, expires_at, used_at, used_by, used_mode
       FROM delivery_tokens WHERE order_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    )).rows[0] || null;

    const activeQR = (await client.query(
      `SELECT COUNT(*)::int AS n FROM delivery_tokens
       WHERE order_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [orderId]
    )).rows[0].n;

    return { order, supplierStock, buyerStock, supplierInvoices, payments, qr, activeQR };
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('\n❌ خطأ غير متوقع:', err);
  console.error(err.stack);
  process.exit(1);
});