const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { getEnvConfig } = require('./env');

const ALLOWED_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

function ensureUploadDir() {
  const { uploadDir } = getEnvConfig();
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = ALLOWED_MIME_TO_EXT[file.mimetype] || '';
    const safeName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
    cb(null, safeName);
  },
});

const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: getEnvConfig().maxUploadSizeBytes,
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TO_EXT[file.mimetype]) {
      return cb(new Error('نوع الملف غير مدعوم. المسموح: JPG, PNG, WEBP, PDF'));
    }
    cb(null, true);
  },
});

function resolveUploadPathSafe(filename) {
  const baseDir = ensureUploadDir();
  const cleanName = path.basename(String(filename || ''));
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('مسار ملف غير صالح');
  }
  return resolved;
}

module.exports = {
  uploadMiddleware,
  ensureUploadDir,
  resolveUploadPathSafe,
  ALLOWED_MIME_TO_EXT,
};
