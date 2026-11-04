const ApiError = require('../../../errors/ApiError');

/**
 * يجلب الحسابات الافتراضية للمرتجع.
 * - 112 ذمم عملاء (AR)
 * - 211 ذمم موردين (AP)
 * - 411 إيرادات
 * - 213 ضريبة مخرجات
 * - 114 ضريبة مدخلات
 * - 511 COGS
 * - 113 مخزون
 */
async function getDefaultAccounts(client, companyId) {
  const codes = {
    receivable: '112',
    payable: '211',
    revenue: '411',
    vat_output: '213',
    vat_input: '114',
    cogs: '511',
    inventory: '113',
  };

  const r = await client.query(
    `SELECT code, id FROM chart_of_accounts
     WHERE company_id = $1 AND code = ANY($2::text[])`,
    [companyId, Object.values(codes)]
  );

  const map = {};
  for (const row of r.rows) {
    const key = Object.keys(codes).find((k) => codes[k] === row.code);
    if (key) map[key] = row.id;
  }

  for (const [key, code] of Object.entries(codes)) {
    if (!map[key]) {
      throw new ApiError(500, `Required account ${code} not found for company ${companyId}`);
    }
  }

  return map;
}

module.exports = { getDefaultAccounts };