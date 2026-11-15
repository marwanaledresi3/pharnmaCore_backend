// services/return/index.js
module.exports = {
  ...require('./createReturn'),
  ...require('./confirm'),
  ...require('./cancel'),
};