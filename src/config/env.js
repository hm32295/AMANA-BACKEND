const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const fallbackJwtSecret = crypto.randomBytes(32).toString('hex');
const fallbackOtpSecret = crypto.randomBytes(32).toString('hex');
const fallbackEncryptionKey = crypto.randomBytes(32).toString('hex');

function getEnvConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const jwtSecret = process.env.JWT_SECRET?.trim() || fallbackJwtSecret;
  const otpHmacSecret = process.env.OTP_HMAC_SECRET?.trim() || fallbackOtpSecret;
  const rawEncKey = process.env.FIELD_ENCRYPTION_KEY?.trim() || fallbackEncryptionKey;
  const fieldEncryptionKey = crypto.createHash('sha256').update(rawEncKey).digest();

  const corsOriginsRaw = process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000';
  const corsOrigins = corsOriginsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const smsProvider = (process.env.SMS_PROVIDER || 'mock').trim().toLowerCase();
  const smsApiKey = (process.env.SMS_API_KEY || '').trim();
  const smsApiSecret = (process.env.SMS_API_SECRET || '').trim();
  const smsApiUrl = (process.env.SMS_API_URL || '').trim();

  return {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT || 5000),
    mongodbUri: (process.env.MONGODB_URI || '').trim(),
    useInMemoryMongo: process.env.USE_IN_MEMORY_MONGO === 'true',
    corsOrigins,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    otpHmacSecret,
    fieldEncryptionKey,
    adminSeedName: (process.env.ADMIN_SEED_NAME || 'مدير النظام').trim(),
    adminSeedEmail: (process.env.ADMIN_SEED_EMAIL || '').trim(),
    adminSeedPhone: (process.env.ADMIN_SEED_PHONE || '').trim(),
    adminSeedPassword: (process.env.ADMIN_SEED_PASSWORD || '').trim(),
    uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'),
    maxUploadSizeBytes: Number(process.env.MAX_UPLOAD_SIZE_MB || 5) * 1024 * 1024,
    sms: {
      provider: smsProvider,
      apiUrl: smsApiUrl,
      apiKey: smsApiKey,
      apiSecret: smsApiSecret,
      senderId: (process.env.SMS_SENDER_ID || 'AMANA').trim(),
      isLiveConfigured: Boolean(
        smsProvider &&
          smsProvider !== 'mock' &&
          smsProvider !== 'unconfigured' &&
          smsApiKey &&
          (smsProvider === 'twilio' ? smsApiSecret : smsApiUrl)
      ),
    },
  };
}

module.exports = { getEnvConfig };
