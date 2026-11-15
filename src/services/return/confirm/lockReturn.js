// services/return/confirm/lockReturn.js
const ApiError = require('../../../errors/ApiError');

async function lockReturn(client, companyId, returnId) {
  const r = await client.query(
    `SELECT * FROM returns
     WHERE id = $1 AND company_id = $2
     FOR UPDATE`,
    [returnId, companyId]
  );

  const ret = r.rows[0];
  if (!ret) throw new ApiError(404, 'Return not found');
  if (ret.status !== 'draft') {
    throw new ApiError(400, 'Only draft returns can be confirmed');
  }

  // البنود + conversion_factor (مضمّن)
  const itemsRes = await client.query(
    `SELECT ri.*, p.name AS product_name
     FROM return_items ri
     JOIN products p ON p.id = ri.product_id
     WHERE ri.return_id = $1`,
    [returnId]
  );

  return { ret, items: itemsRes.rows };
}

module.exports = { lockReturn };