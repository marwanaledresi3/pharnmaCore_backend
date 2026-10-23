require('dotenv').config();
const db = require('../config/db');

const currencies = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'YER', name: 'Yemeni Rial', symbol: '﷼' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
];

(async () => {
  try {
    for (const c of currencies) {
      await db.query(
        `INSERT INTO currencies (code, name, symbol) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [c.code, c.name, c.symbol]
      );
    }
    console.log('✅ Currencies seeded');
    process.exit(0);
  } catch (e) {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  }
})();