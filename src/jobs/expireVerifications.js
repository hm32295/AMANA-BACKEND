const { VerificationRecord } = require('../models');

async function expireStaleVerifications() {
  const result = await VerificationRecord.updateMany(
    { status: 'pending', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount || 0;
}

function startVerificationCleanupJob(intervalMs = 60 * 1000) {
  const timer = setInterval(() => {
    expireStaleVerifications().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { expireStaleVerifications, startVerificationCleanupJob };
