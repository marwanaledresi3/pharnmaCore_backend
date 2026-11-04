const QRService = require('../../qrService');

/**
 * يعلّم QR كمستخدم (بعد confirm).
 */
async function markQRUsed(client, { token, userId, usedMode }) {
  const userRow = await client.query(
    `SELECT company_id FROM users WHERE id = $1`,
    [userId]
  );
  const companyId = userRow.rows[0]?.company_id;

  const { deliveryToken } = await QRService.verify(client, token, {
    mode: usedMode || 'authenticated',
    userCompanyId: companyId,
  });

  await QRService.markUsed(client, deliveryToken.id, {
    userId,
    mode: usedMode || 'authenticated',
  });
}

module.exports = { markQRUsed };