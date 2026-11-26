const bcrypt = require('bcryptjs');
const { connectDatabase, disconnectDatabase } = require('../config/db');
const { getEnvConfig } = require('../config/env');
const { User } = require('../models');
const { ensureInitialSeedData, generateNextUserCode } = require('../services/authService');
const { normalizeEgyptianPhone, isValidEgyptianPhone } = require('../utils/crypto');

async function seedAdminFromEnv() {
  const cfg = getEnvConfig();
  if (!cfg.adminSeedEmail || !cfg.adminSeedPassword) {
    console.error('Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in .env before running seed:admin.');
    process.exit(1);
  }
  const cleanPhone = normalizeEgyptianPhone(cfg.adminSeedPhone || '01000000000');
  if (!isValidEgyptianPhone(cleanPhone)) {
    console.error('Invalid ADMIN_SEED_PHONE. Must be an 11-digit Egyptian mobile number starting with 01.');
    process.exit(1);
  }

  await connectDatabase();
  const existing = await User.findOne({ email: cfg.adminSeedEmail.toLowerCase() });
  if (existing) {
    console.log(`Admin already exists: ${existing.email} (${existing.code})`);
  } else {
    const code = await generateNextUserCode('admin');
    const passwordHash = await bcrypt.hash(cfg.adminSeedPassword, 12);
    await User.create({
      code,
      name: cfg.adminSeedName,
      email: cfg.adminSeedEmail.toLowerCase(),
      phone: cleanPhone,
      passwordHash,
      role: 'admin',
      status: 'active',
    });
    console.log(`Created admin account ${cfg.adminSeedEmail} (${code})`);
  }
  await ensureInitialSeedData();
  await disconnectDatabase();
}

seedAdminFromEnv().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
