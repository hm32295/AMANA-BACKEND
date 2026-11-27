const { connectDatabase } = require('./src/config/db');
const { getEnvConfig } = require('./src/config/env');
const { createApp } = require('./src/app');
const { ensureInitialSeedData } = require('./src/services/authService');
const { startVerificationCleanupJob } = require('./src/jobs/expireVerifications');
 
async function start() {
  const cfg = getEnvConfig();
  await connectDatabase();
  await ensureInitialSeedData();
  startVerificationCleanupJob();

  const app = createApp();
  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`AMANA Backend API listeningOn http://0.0.0.0:${cfg.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start AMANA backend:', err);
  process.exit(1);
});
