const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, DonationType, SystemSetting } = require('../models');
const { getEnvConfig } = require('../config/env');
const { INITIAL_DONATION_TYPES, ROLES } = require('../constants/amana');
const { normalizeEgyptianPhone, isValidEgyptianPhone } = require('../utils/crypto');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');

async function generateNextUserCode(role) {
  const prefix = role === ROLES.ADMIN ? 'ADM' : 'DST';
  const count = await User.countDocuments({ role });
  let seq = count + 1;
  while (seq < count + 500) {
    const candidate = `${prefix}-${String(seq).padStart(4, '0')}`;
    const exists = await User.exists({ code: candidate });
    if (!exists) return candidate;
    seq += 1;
  }
  return `${prefix}-${Date.now()}`;
}

async function ensureInitialSeedData() {
  for (const dt of INITIAL_DONATION_TYPES) {
    await DonationType.updateOne(
      { key: dt.key },
      { $setOnInsert: { ...dt, isActive: true } },
      { upsert: true }
    );
  }

  const defaults = [
    {
      key: 'verification_policy',
      value: {
        defaultVerificationMethod: 'OTP',
        requireAdminApprovalForUnverified: false,
      },
    },
    {
      key: 'distributor_submission_policy',
      value: {
        allowDistributorSupportingDocs: true,
        requireNationalIdInDistributorSubmission: false,
      },
    },
    {
      key: 'privacy_and_retention',
      value: {
        dataRetentionMonths: 60,
        maskNationalIdForDistributors: true,
        hideMedicalDetailsOnReceipts: true,
      },
    },
  ];

  for (const setting of defaults) {
    await SystemSetting.updateOne(
      { key: setting.key },
      { $setOnInsert: { key: setting.key, value: setting.value } },
      { upsert: true }
    );
  }
}

function issueJwtForUser(user) {
  const cfg = getEnvConfig();
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      code: user.code,
      name: user.name,
    },
    cfg.jwtSecret,
    { expiresIn: cfg.jwtExpiresIn }
  );
}

async function getAuthStatus() {
  const adminCount = await User.countDocuments({ role: ROLES.ADMIN });
  return {
    needsAdminBootstrap: adminCount === 0,
  };
}

async function bootstrapFirstAdmin({ name, email, phone, password }, meta = {}) {
  const adminCount = await User.countDocuments({ role: ROLES.ADMIN });
  if (adminCount > 0) {
    throw new AppError('تم تفعيل حساب المدير مسبقاً ولا يمكن إنشاء مدير عام آخر عبر هذه الواجهة', 409);
  }

  const cleanPhone = normalizeEgyptianPhone(phone);
  if (!isValidEgyptianPhone(cleanPhone)) {
    throw new AppError('يرجى إدخال رقم هاتف مصري صحيح مكون من 11 رقماً يبدأ بـ 01', 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const code = await generateNextUserCode(ROLES.ADMIN);
  const admin = await User.create({
    code,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: cleanPhone,
    passwordHash,
    role: ROLES.ADMIN,
    status: 'active',
  });

  await ensureInitialSeedData();

  await recordAuditLog({
    userId: admin._id,
    userRole: ROLES.ADMIN,
    action: 'ADMIN_BOOTSTRAPPED',
    entityType: 'User',
    entityId: admin._id,
    newValues: { code, email: admin.email, role: admin.role },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const token = issueJwtForUser(admin);
  return {
    token,
    user: {
      id: String(admin._id),
      code: admin.code,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      role: admin.role,
      status: admin.status,
    },
  };
}

async function login({ email, password }, meta = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      newValues: { email: normalizedEmail, reason: 'USER_NOT_FOUND' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw new AppError('بيانات الدخول غير صحيحة', 401);
  }

  if (user.status !== 'active') {
    await recordAuditLog({
      userId: user._id,
      userRole: user.role,
      action: 'LOGIN_BLOCKED_INACTIVE',
      entityType: 'User',
      entityId: user._id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw new AppError('هذا الحساب غير مفعل أو موقوف حالياً. تواصل مع الإدارة.', 403);
  }

  const isMatch = await bcrypt.compare(String(password), user.passwordHash);
  if (!isMatch) {
    await recordAuditLog({
      userId: user._id,
      userRole: user.role,
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user._id,
      newValues: { reason: 'INVALID_PASSWORD' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw new AppError('بيانات الدخول غير صحيحة', 401);
  }

  await ensureInitialSeedData();

  await recordAuditLog({
    userId: user._id,
    userRole: user.role,
    action: 'LOGIN_SUCCESS',
    entityType: 'User',
    entityId: user._id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const token = issueJwtForUser(user);
  return {
    token,
    user: {
      id: String(user._id),
      code: user.code,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      governorate: user.governorate,
    },
  };
}

async function changeOwnPassword(userId, { currentPassword, newPassword }, meta = {}) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new AppError('المستخدم غير موجود', 404);

  const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
  if (!ok) throw new AppError('كلمة المرور الحالية غير صحيحة', 400);

  if (String(newPassword).length < 8) {
    throw new AppError('كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف', 400);
  }

  user.passwordHash = await bcrypt.hash(String(newPassword), 12);
  await user.save();

  await recordAuditLog({
    userId: user._id,
    userRole: user.role,
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: user._id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { changed: true };
}

async function createPasswordResetToken(email) {
  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  if (!user) {
    return { requested: true };
  }
  const rawToken = crypto.randomBytes(24).toString('hex');
  user.passwordResetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  return { requested: true, resetToken: process.env.NODE_ENV === 'test' ? rawToken : undefined };
}

async function resetPasswordWithToken({ email, resetToken, newPassword }, meta = {}) {
  const tokenHash = crypto.createHash('sha256').update(String(resetToken || '')).digest('hex');
  const user = await User.findOne({
    email: String(email || '').trim().toLowerCase(),
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');

  if (!user) {
    throw new AppError('رمز إعادة التعيين غير صالح أو منتهي الصلاحية', 400);
  }
  if (String(newPassword || '').length < 8) {
    throw new AppError('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف', 400);
  }
  user.passwordHash = await bcrypt.hash(String(newPassword), 12);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();

  await recordAuditLog({
    userId: user._id,
    userRole: user.role,
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'User',
    entityId: user._id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { reset: true };
}

module.exports = {
  generateNextUserCode,
  ensureInitialSeedData,
  getAuthStatus,
  bootstrapFirstAdmin,
  login,
  changeOwnPassword,
  createPasswordResetToken,
  resetPasswordWithToken,
};
