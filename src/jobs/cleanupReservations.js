const { pool } = require('../config/pool');
const ReservationService = require('../services/reservationService');

const cleanup = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await ReservationService.cleanupExpired(client);
    await client.query('COMMIT');
    if (result.expired > 0) {
      console.log(`[cleanupReservations] expired ${result.expired} reservations`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cleanupReservations] error:', err);
  } finally {
    client.release();
  }
};

module.exports = { cleanup };