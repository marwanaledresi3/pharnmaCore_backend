// services/return/helpers/accounts.js
const ApiError = require('../../../errors/ApiError');

/**
 * أكواد الحسابات الافتراضية — يجب أن تطابق ما يُنشئه fn_setup_new_company.
 *
 * البنية:
 *   111  = النقدية بالصندوق والبنوك (أب — ليس postable)
 *   1111 = الصندوق (postable)
 *   1112 = البنك (postable)
 *   112  = ذمم عملاء (postable)
 *   113  = مخزون (postable)
 *   114  = ضريبة مدخلات (postable)
 *   211  = ذمم موردين (postable)
 *   213  = ضريبة مخرجات (postable)
 *   411  = إيرادات مبيعات (postable)
 *   511  = تكلفة مبيعات (postable)
 */
const CODES = {
  cash_box:   '1111',
  bank:       '1112',
  receivable: '112',
  inventory:  '113',
  vat_input:  '114',
  payable:    '211',
  vat_output: '213',
  revenue:    '411',
  cogs:       '511',
};

/* ============================================================
 * 1) حسابات مرتجع البيع (Sales Return)
 *
 * - Dr revenue    (411) — عكس الإيراد
 * - Dr vat_output (213) — عكس ضريبة المخرجات
 *   Cr receivable (112) — تخفيض ذمم العميل
 * - Dr inventory  (113) — إرجاع المخزون
 *   Cr cogs       (511) — عكس تكلفة المبيعات
 * ============================================================ */
async function getSalesReturnAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    revenue:    CODES.revenue,     // 411
    vat_output: CODES.vat_output,  // 213
    receivable: CODES.receivable,  // 112
    inventory:  CODES.inventory,   // 113
    cogs:       CODES.cogs,        // 511
  });
}

/* ============================================================
 * 2) حسابات مرتجع الشراء (Purchase Return)
 *
 * - Dr payable    (211) — تخفيض ذمم المورد
 *   Cr inventory  (113) — إخراج مخزون
 *   Cr vat_input  (114) — عكس ضريبة المدخلات
 * ============================================================ */
async function getPurchaseReturnAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    payable:   CODES.payable,    // 211
    inventory: CODES.inventory,  // 113
    vat_input: CODES.vat_input,  // 114
  });
}

/* ============================================================
 * 3) حسابات افتراضية (كل ما قد يلزم)
 *
 * تُستخدم في confirm/index.js — buildJournalLines
 * تُرجع كل الحسابات الممكنة (بيع + شراء) — يُستخدم منها ما يلزم.
 * ============================================================ */
async function getDefaultAccounts(client, companyId) {
  return getAccountsByCodes(client, companyId, {
    // مرتجع بيع
    revenue:    CODES.revenue,
    vat_output: CODES.vat_output,
    receivable: CODES.receivable,
    inventory:  CODES.inventory,
    cogs:       CODES.cogs,
    // مرتجع شراء
    payable:    CODES.payable,
    vat_input:  CODES.vat_input,
  });
}

/* ============================================================
 * 4) حساب النقدية/البنك حسب طريقة الدفع
 *
 * (اختياري — لمرتجعات نقدية)
 * - cash / other / undefined → 1111 (الصندوق)
 * - bank / cheque / card / wallet → 1112 (البنك)
 * ============================================================ */
async function getCashAccount(client, companyId, method = 'cash') {
  const m = String(method || 'cash').toLowerCase();
  const useBank = ['bank', 'cheque', 'card', 'wallet'].includes(m);
  const code = useBank ? CODES.bank : CODES.cash_box;

  const r = await client.query(
    `SELECT id FROM chart_of_accounts
     WHERE company_id = $1 AND code = $2 AND is_active = TRUE
     LIMIT 1`,
    [companyId, code]
  );

  if (!r.rowCount) {
    throw new ApiError(
      500,
      `Cash/Bank account ${code} (${useBank ? 'bank' : 'cash'}) not found for company ${companyId}. ` +
      `Please ensure the company setup has created the default chart of accounts.`
    );
  }
  return r.rows[0].id;
}

/* ============================================================
 * 5) مساعد: جلب الحسابات من أكواد
 * ============================================================ */
async function getAccountsByCodes(client, companyId, codes) {
  const r = await client.query(
    `SELECT code, id FROM chart_of_accounts
     WHERE company_id = $1
       AND code = ANY($2::text[])
       AND is_active = TRUE`,
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
        `Required account ${code} (${key}) not found or inactive for company ${companyId}. ` +
        `Please ensure the company setup has created the default chart of accounts.`
      );
    }
  }
  return map;
}

module.exports = {
  CODES,
  getSalesReturnAccounts,
  getPurchaseReturnAccounts,
  getDefaultAccounts,
  getCashAccount,
  getAccountsByCodes,
};