// services/return/helpers/rounding.js
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { round2 };