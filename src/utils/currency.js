const ExchangeRate = require('../models/ExchangeRate');
const ApiError = require('../errors/ApiError');

/**
 * يحوّل مبلغ من عملة إلى العملة الأساسية للشركة
 * @returns {Promise<{rate: number, amount_base: number, rate_date: string}>}
 */
const toBase = async (companyId, amount, currencyId, asOfDate = null) => {
  const rateInfo = await ExchangeRate.getCurrent(companyId, currencyId, asOfDate);
  if (!rateInfo) {
    throw new ApiError(400, `Exchange rate not found for currency. Please set a rate first.`);
  }
  const amountBase = Math.round(Number(amount) * Number(rateInfo.rate) * 100) / 100;
  return {
    rate: Number(rateInfo.rate),
    amount_base: amountBase,
    rate_date: rateInfo.rate_date,
    is_base: rateInfo.is_base,
  };
};

/**
 * يحوّل مبلغ من العملة الأساسية إلى عملة أخرى
 */
const fromBase = async (companyId, amountBase, currencyId, asOfDate = null) => {
  const rateInfo = await ExchangeRate.getCurrent(companyId, currencyId, asOfDate);
  if (!rateInfo) throw new ApiError(400, 'Exchange rate not found');
  return {
    amount: Math.round((Number(amountBase) / Number(rateInfo.rate)) * 100) / 100,
    rate: Number(rateInfo.rate),
    rate_date: rateInfo.rate_date,
  };
};

module.exports = { toBase, fromBase };