const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    const err = new ApiError(422, 'Validation failed');
    err.details = details;
    return next(err);
  }
  next();
};

module.exports = validate;