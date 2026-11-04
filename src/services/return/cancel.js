const { pool } = require('../../config/pool');
const ApiError = require('../../errors/ApiError');
const Return = require('../../models/Return');

const cancel = async (companyId, returnId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ret = await client.query(
      `SELECT status FROM returns WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [returnId, companyId]
    );
    if (!ret.rowCount) throw new ApiError(404, 'Return not found');
    if (ret.rows[0].status !== 'draft') {
      throw new ApiError(400, 'Only draft returns can be cancelled');
    }

    await Return.updateStatus(companyId, returnId, 'cancelled', client);
    await client.query('COMMIT');
    return { id: returnId, status: 'cancelled' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { cancel };