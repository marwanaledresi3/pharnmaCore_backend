const {pool} = require('../config/pool');

class Currency {
  static async list() {
    const r = await pool.query(
      `SELECT id, code, name, symbol, created_at
       FROM currencies ORDER BY code`
    );
    return r.rows;
  }

  static async findById(id) {
    const r = await pool.query(
      `SELECT id, code, name, symbol FROM currencies WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  static async findByCode(code) {
    const r = await pool.query(
      `SELECT id, code, name, symbol FROM currencies WHERE code = $1`,
      [code.toUpperCase()]
    );
    return r.rows[0] || null;
  }

  static async create({ code, name, symbol }) {
    const r = await pool.query(
      `INSERT INTO currencies (code, name, symbol)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, symbol, created_at`,
      [code.toUpperCase(), name, symbol || null]
    );
    return r.rows[0];
  }

  static async update(id, { name, symbol }) {
    const fields = [];
    const params = [];
    if (name !== undefined) { params.push(name); fields.push(`name = $${params.length}`); }
    if (symbol !== undefined) { params.push(symbol); fields.push(`symbol = $${params.length}`); }
    if (!fields.length) return null;

    params.push(id);
    const r = await pool.query(
      `UPDATE currencies SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, code, name, symbol`,
      params
    );
    return r.rows[0] || null;
  }
}

module.exports = Currency;