const ApiError = require('../errors/ApiError');

const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

const errorHandler = (err, req, res, next) => {
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Duplicate value', detail: err.detail });
  }
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Related record not found', detail: err.detail });
  }

  const status = err.statusCode || 500;
  const body = { success: false, message: err.message || 'Internal Server Error' };
  if (err.details) body.details = err.details;
  if (process.env.NODE_ENV !== 'production' && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
};

module.exports = { notFound, errorHandler };