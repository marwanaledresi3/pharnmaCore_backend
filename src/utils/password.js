const bcrypt = require('bcryptjs');

const hash = (plain) => bcrypt.hash(plain, 12);
const compare = (plain, hashed) => bcrypt.compare(plain, hashed);

module.exports = { hash, compare };