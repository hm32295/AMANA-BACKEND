const { AuditLog } = require('../models');
const { maskNationalIdLast4, maskPhone } = require('../utils/crypto');

function maskSensitivePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitivePayload);
  const copy = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (lower.includes('password') || lower.includes('otp') || lower.includes('secret') || lower.includes('token')) {
      copy[k] = '[REDACTED]';
    } else if (lower === 'nationalid' || lower === 'nationalidencrypted' || lower === 'nationalidhash') {
      copy[k] = typeof v === 'string' && v.length >= 4 ? maskNationalIdLast4(v.slice(-4)) : '**************';
    } else if (lower.includes('phone') && typeof v === 'string' && v.length >= 7) {
      copy[k] = maskPhone(v);
    } else if (v && typeof v === 'object') {
      copy[k] = maskSensitivePayload(v);
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

async function recordAuditLog(
  {
    userId = null,
    userRole = null,
    action,
    entityType,
    entityId = null,
    changedFields = [],
    previousValues = null,
    newValues = null,
    ipAddress = '',
    userAgent = '',
  },
  session = null
) {
  const payload = {
    userId: userId || undefined,
    userRole: userRole || undefined,
    action,
    entityType,
    entityId: entityId ? String(entityId) : undefined,
    changedFields,
    previousValues: maskSensitivePayload(previousValues),
    newValues: maskSensitivePayload(newValues),
    ipAddress: ipAddress || undefined,
    userAgent: userAgent ? String(userAgent).slice(0, 200) : undefined,
  };

  if (session) {
    await AuditLog.create([payload], { session });
  } else {
    await AuditLog.create(payload);
  }
}

module.exports = {
  recordAuditLog,
  maskSensitivePayload,
};
