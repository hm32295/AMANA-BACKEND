const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { getEnvConfig } = require('../config/env');
const { AppError } = require('../utils/errors');

async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      throw new AppError('يرجى تسجيل الدخول للمتابعة', 401);
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError('رمز الجلسة غير صالح', 401);
    }

    const { jwtSecret } = getEnvConfig();
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch (_err) {
      throw new AppError('انتهت صلاحية الجلسة أو الرمز غير صالح', 401);
    }

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      throw new AppError('المستخدم غير موجود', 401);
    }
    if (user.status !== 'active') {
      throw new AppError('الحساب غير مفعل أو موقوف حالياً', 403);
    }

    req.user = {
      id: String(user._id),
      code: user.code,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('غير مصرح بالوصول', 401));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('ليس لديك صلاحية تنفيذ هذا الإجراء', 403));
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
