// data/defaultSettings-fa.js
/**
 * إعدادات وحدة الأصول الثابتة (Fixed Assets)
 * تُدمج في data/defaultSettings.js عبر:
 *   ...require('./defaultSettings-fa')
 */

module.exports = [
  { key: 'fa_enabled',                     value: true },
  { key: 'fa_asset_number_prefix',         value: 'FA-' },
  { key: 'fa_asset_number_padding',        value: 4 },
  { key: 'fa_depreciation_number_prefix',  value: 'DEP-' },
  { key: 'fa_depreciation_number_padding', value: 4 },
  { key: 'fa_disposal_number_prefix',      value: 'DISP-' },
  { key: 'fa_disposal_number_padding',     value: 4 },
  { key: 'fa_auto_post_depreciation',      value: true },
  { key: 'fa_auto_post_disposal',        value: true },
  { key: 'fa_default_depreciation_method', value: 'straight_line' }, // straight_line | declining_balance
];