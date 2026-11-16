// services/purchaseOrder/helpers/accounts.js
const ApiError = require('../../../errors/ApiError');
const CashRegister = require('../../../models/CashRegister');

const CODES = {
  cash_box: '1111',
  bank: '1112',
  inventory: '113',
  receivable: '112',
  payable: '211',
  vat_input: '114',
  vat_output: '213',
  sales_revenue: '411',
  cogs: '511',
};

async function getBuyerAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    inventory: CODES.inventory,
    payable: CODES.payable,
    vat_input: CODES.vat_input,
  });
}

async function getSupplierAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    receivable: CODES.receivable,
    sales_revenue: CODES.sales_revenue,
    vat_output: CODES.vat_output,
    cogs: CODES.cogs,
    inventory: CODES.inventory,
  });
}

/**
 * تحديد الحساب النقدي/البنكي + cash_register_id
 * إذا كانت طريقة الدفع نقدية ('cash'):
 *   يستخدم الصندوق المحدد أو صندوق الفرع أو الصندوق الافتراضي للشركة عبر CashRegister.resolveAccount
 * وإلا (بنك / شيك / بطاقة / محفظة):
 *   يستخدم حساب البنك 1112
 */
async function getCashAccount(client, companyId, method = 'cash', cashRegisterId = null, branchId = null) {
  const m = String(method || 'cash').toLowerCase();
  const useBank = ['bank', 'cheque', 'card', 'wallet'].includes(m);

  if (!useBank) {
    const resolved = await CashRegister.resolveAccount(client, companyId, {
      cash_register_id: cashRegisterId,
      branch_id: branchId,
    });
    return {
      accountId: resolved.account_id,
      cashRegisterId: resolved.id,
      label: resolved.name,
    };
  }

  const r = await client.query(
    `SELECT id, name FROM chart_of_accounts WHERE company_id = $1 AND code = $2 AND is_active = TRUE LIMIT 1`,
    [companyId, CODES.bank]
  );

  if (!r.rowCount) {
    throw new ApiError(500, `Bank account ${CODES.bank} not found for company ${companyId}.`);
  }
  return {
    accountId: r.rows[0].id,
    cashRegisterId: null,
    label: r.rows[0].name || 'البنك',
  };
}

async function getAccountsByCodes(client, companyId, codes) {
  const r = await client.query(
    `SELECT code, id FROM chart_of_accounts WHERE company_id = $1 AND code = ANY($2::text[]) AND is_active = TRUE`,
    [companyId, Object.values(codes)]
  );

  const map = {};
  for (const row of r.rows) {
    const key = Object.keys(codes).find((k) => codes[k] === row.code);
    if (key) map[key] = row.id;
  }

  for (const [key, code] of Object.entries(codes)) {
    if (!map[key]) {
      throw new ApiError(500, `Required account ${code} (${key}) not found or inactive for company ${companyId}`);
    }
  }
  return map;
}

module.exports = { CODES, getBuyerAccounts, getSupplierAccounts, getCashAccount, getAccountsByCodes };