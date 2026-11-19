// scripts/test-approve-phase4.js
const { pool } = require('../src/config/pool');
const service = require('../src/services/purchaseOrderService');

(async () => {
  const client = await pool.connect();
  try {
    const supplierCompanyId = '434f02b1-a952-4351-867a-98308938259b'; // نانو
    const supplierUserId = null; // ← استخدم مستخدم نانو الحقيقي
    const orderId = '<PO_ID>'; // طلب pending_approval

    // ── 1) موافقة بسيطة بدون تعديلات ──
    console.log('\n[1] موافقة بسيطة');
    const r1 = await service.approve(supplierCompanyId, supplierUserId, orderId);
    console.log('status =', r1.status, '| total =', r1.total);
    console.log('QR url =', r1.qr.url);
    console.log('QR PIN =', r1.qr.pin);
    console.log('QR expires =', r1.qr.expires_at);
    // ✅ يجب أن يظهر QR + PIN

    console.log('\n✅ Phase 4 OK');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();