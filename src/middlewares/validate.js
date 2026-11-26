const { validationResult } = require('express-validator');
const { AppError } = require('../utils/errors');

function validateRequest(req, _res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array().map((e) => ({
      field: e.path || e.param,
      message: e.msg,
    }));
    return next(new AppError(errors[0].message, 400, errors));
  }
  return next();
}

module.exports = { validateRequest };
