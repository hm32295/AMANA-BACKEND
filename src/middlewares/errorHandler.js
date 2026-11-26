const { AppError } = require('../utils/errors');

function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { errors: err.details } : {}),
    });
  }

  if (err && err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      message: errors[0]?.message || 'بيانات غير صالحة',
      errors,
    });
  }

  if (err && err.code === 11000) {
    const dupFields = Object.keys(err.keyPattern || {});
    return res.status(409).json({
      success: false,
      message: `القيمة مسجلة مسبقاً في النظام (${dupFields.join(', ') || 'مكرر'})`,
    });
  }

  if (err && err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'معرّف السجل غير صالح',
    });
  }

  if (err && err.message && err.message.includes('نوع الملف غير مدعوم')) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'حجم الملف يتجاوز الحد الأقصى المسموح به',
    });
  }

  console.error('Unhandled API Error:', err);
  return res.status(500).json({
    success: false,
    message: 'حدث خطأ غير متوقع في الخادم',
  });
}

function notFoundHandler(_req, res) {
  return res.status(404).json({
    success: false,
    message: 'المسار المطلوب غير موجود',
  });
}

module.exports = { errorHandler, notFoundHandler };
