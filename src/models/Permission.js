const {pool} = require('../config/pool');

class Permission {
  static async listGroupedByModule() {
    const r = await pool.query(
      `SELECT id, code, name, module FROM permissions ORDER BY module, code`
    );
    const grouped = {};
    for (const p of r.rows) (grouped[p.module] ||= []).push(p);
    return grouped;
  }

  static async list() {
    const r = await pool.query(`SELECT id, code, name, module FROM permissions ORDER BY module, code`);
    return r.rows;
  }

  static async validateIds(client, ids) {
    if (!ids.length) return true;
    const r = await client.query(`SELECT id FROM permissions WHERE id = ANY($1::uuid[])`, [ids]);
    return r.rowCount === ids.length;
  }
}

module.exports = Permission;