const ApiError = require('../../../errors/ApiError');

/**
 * أكواد حسابات المشتري (أوامر الشراء):
 * - 113 = مخزون (أصل)
 * - 211 = ذمم موردين (التزام)
 * - 114 = ضريبة مدخلات (أصل)
 */
async function getBuyerAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    inventory: '113',
    payable: '211',
    vat_input: '114',
  });
}

/**
 * أكواد حسابات المورد (فواتير المبيعات):
 * - 112 = ذمم عملاء (أصل)
 * - 411 = إيرادات مبيعات (إيراد)
 * - 213 = ضريبة مخرجات (التزام)
 * - 511 = تكلفة مبيعات (مصروف)
 * - 113 = مخزون (أصل)
 */
async function getSupplierAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    receivable: '112',
    sales_revenue: '411',
    vat_output: '213',
    cogs: '511',
    inventory: '113',
  });
}

async function getCashAccount(client, companyId) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts
     WHERE company_id = $1 AND code = '111' LIMIT 1`,
    [companyId]
  );
  if (!r.rowCount) {
    throw new ApiError(500, `Cash account 111 not found for company ${companyId}`);
  }
  return r.rows[0].id;
}

async function getAccountsByCodes(client, companyId, codes) {
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
      throw new ApiError(
        500,
        `Required account ${code} not found for company ${companyId}`
      );
    }
  }
  return map;
}

module.exports = {
  getBuyerAccounts,
  getSupplierAccounts,
  getCashAccount,
  getAccountsByCodes,
};