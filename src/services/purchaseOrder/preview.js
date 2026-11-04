const { pool } = require('../../config/pool');
const QRService = require('../qrService');

async function previewByToken(token) {
  const client = await pool.connect();
  try {
    const peek = await QRService.peek(client, token);
    if (!peek) return null;

    const { payload } = peek;

    const orderRes = await client.query(
      `SELECT id, order_number, status, total, order_date,
              company_id, supplier_company_id, due_date, payment_type,
              payment_method
       FROM purchase_orders WHERE id = $1`,
      [payload.order_id]
    );
    if (!orderRes.rowCount) return null;
    const order = orderRes.rows[0];

    const items = await client.query(
      `SELECT poi.id, poi.product_id, poi.quantity, poi.unit_price,
              poi.line_total, p.name AS product_name, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.order_id = $1`,
      [order.id]
    );

    return {
      order,
      items: items.rows,
      delivery_token: {
        mode: peek.deliveryToken.mode,
        expires_at: peek.deliveryToken.expires_at,
        used_at: peek.deliveryToken.used_at,
      },
      buyer_company_name: peek.deliveryToken.buyer_company_name,
      supplier_company_name: peek.deliveryToken.supplier_company_name,
    };
  } finally {
    client.release();
  }
}

module.exports = { previewByToken };