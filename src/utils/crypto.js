const crypto = require('crypto');
const { getEnvConfig } = require('../config/env');

function normalizeEgyptianPhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).trim().replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+20')) cleaned = `0${cleaned.slice(3)}`;
  else if (cleaned.startsWith('0020')) cleaned = `0${cleaned.slice(4)}`;
  else if (cleaned.startsWith('20') && cleaned.length === 12) cleaned = `0${cleaned.slice(2)}`;
  return cleaned;
}

function isValidEgyptianPhone(phone) {
  return /^01[0125][0-9]{8}$/.test(normalizeEgyptianPhone(phone));
}

function normalizeNationalId(nid) {
  return String(nid || '').trim().replace(/\s+/g, '');
}

function isValidEgyptianNationalId(nid) {
  return /^[23][0-9]{13}$/.test(normalizeNationalId(nid));
}

function hashNationalId(nid) {
  const { otpHmacSecret } = getEnvConfig();
  return crypto
    .createHmac('sha256', otpHmacSecret)
    .update(`nid:${normalizeNationalId(nid)}`)
    .digest('hex');
}

function encryptSensitiveField(plaintext) {
  if (!plaintext) return '';
  const { fieldEncryptionKey } = getEnvConfig();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fieldEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSensitiveField(payload) {
  if (!payload || !String(payload).includes(':')) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 3) return '';
  const { fieldEncryptionKey } = getEnvConfig();
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const data = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', fieldEncryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function maskPhone(phone) {
  const clean = normalizeEgyptianPhone(phone) || String(phone || '');
  if (clean.length < 7) return '****';
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

function maskNationalIdLast4(last4) {
  if (!last4) return '**************';
  return `**********${String(last4).slice(-4)}`;
}

function generateNumericOtp(digits = 6) {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits);
  return String(crypto.randomInt(min, max));
}

function hashVerificationSecret(code, salt) {
  const { otpHmacSecret } = getEnvConfig();
  return crypto
    .createHmac('sha256', otpHmacSecret)
    .update(`${salt}:${String(code)}`)
    .digest('hex');
}

function constantTimeHexEqual(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hexA, 'hex'), Buffer.from(hexB, 'hex'));
}

function generateReference(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

module.exports = {
  normalizeEgyptianPhone,
  isValidEgyptianPhone,
  normalizeNationalId,
  isValidEgyptianNationalId,
  hashNationalId,
  encryptSensitiveField,
  decryptSensitiveField,
  maskPhone,
  maskNationalIdLast4,
  generateNumericOtp,
  hashVerificationSecret,
  constantTimeHexEqual,
  generateReference,
};
