const {pool} = require('../config/pool');

class BaseModel {
  static get table() { throw new Error('table is required'); }
  static get pool() { return pool; }

  static async query(sql, params) {
    return pool.query(sql, params);
  }
}

module.exports = BaseModel;