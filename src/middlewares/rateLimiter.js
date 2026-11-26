const rateLimit = require('express-rate-limit');

const isTestEnv = () => process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_RATE_LIMIT !== 'true';

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv(),
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح لمحاولات تسجيل الدخول. يرجى المحاولة بعد قليل.',
  },
});

const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv(),
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح لمحاولات التحقق. يرجى المحاولة لاحقاً.',
  },
});

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv(),
  message: {
    success: false,
    message: 'تم إرسال عدد كبير جداً من الطلبات. يرجى الانتظار قليلاً.',
  },
});

module.exports = {
  loginRateLimiter,
  otpRateLimiter,
  apiRateLimiter,
};
