const ApiError = require('../../../errors/ApiError');

/**
 * يقفل صف المرتجع ويتحقق من حالته.
 * ← هنا يمكن أن يتعلق إذا كانت هناك جلسة أخرى معلقة.
 */
async function lockReturn(client, companyId, returnId) {
  console.log('[confirm:1] BEGIN lockReturn, returnId =', returnId);

  const r = await client.query(
    `SELECT * FROM returns
     WHERE id = $1 AND company_id = $2
     FOR UPDATE`,
    [returnId, companyId]
  );

  console.log('[confirm:1] FOR UPDATE executed. rowCount =', r.rowCount);

  const ret = r.rows[0];
  if (!ret) throw new ApiError(404, 'Return not found');
  if (ret.status !== 'draft') {
    throw new ApiError(400, 'Only draft returns can be confirmed');
  }

  console.log('[confirm:1] return locked, type =', ret.return_type);

  // اقرأ البنود
  const itemsRes = await client.query(
    `SELECT ri.*, p.name AS product_name
     FROM return_items ri
     JOIN products p ON p.id = ri.product_id
     WHERE ri.return_id = $1`,
    [returnId]
  );

  console.log('[confirm:1] items loaded:', itemsRes.rowCount);

  return { ret, items: itemsRes.rows };
}

module.exports = { lockReturn };