const bcrypt = require('bcryptjs');
const { User, AuditLog, SystemSetting } = require('../models');
const authService = require('../services/authService');
const { generateNextUserCode } = require('../services/authService');
const { recordAuditLog } = require('../services/auditService');
const { normalizeEgyptianPhone, isValidEgyptianPhone } = require('../utils/crypto');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { AppError } = require('../utils/errors');

function reqMeta(req) {
  return {
    ipAddress: req.ip || '',
    userAgent: req.get('user-agent') || '',
  };
}

async function getAuthStatus(_req, res, next) {
  try {
    const data = await authService.getAuthStatus();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function bootstrapAdmin(req, res, next) {
  try {
    const data = await authService.bootstrapFirstAdmin(req.body, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تفعيل حساب المدير العام بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const data = await authService.login(req.body, reqMeta(req));
    res.json({ success: true, message: 'تم تسجيل الدخول بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash').lean();
    res.json({ success: true, data: { ...user, id: String(user._id) } });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const data = await authService.changeOwnPassword(req.user.id, req.body, reqMeta(req));
    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function requestPasswordReset(req, res, next) {
  try {
    const data = await authService.createPasswordResetToken(req.body.email);
    res.json({ success: true, message: 'إذا كان البريد مسجلاً تم إنشاء طلب إعادة التعيين', data });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const data = await authService.resetPasswordWithToken(req.body, reqMeta(req));
    res.json({ success: true, message: 'تم إعادة تعيين كلمة المرور بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function listDistributors(_req, res, next) {
  try {
    const users = await User.find({ role: 'distributor' }).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      data: users.map((u) => ({ ...u, id: String(u._id) })),
    });
  } catch (err) {
    next(err);
  }
}

async function createDistributor(req, res, next) {
  try {
    const cleanPhone = normalizeEgyptianPhone(req.body.phone);
    if (!isValidEgyptianPhone(cleanPhone)) {
      throw new AppError('رقم الهاتف المصري غير صالح', 400);
    }
    const passwordHash = await bcrypt.hash(String(req.body.password), 12);
    const code = await generateNextUserCode('distributor');
    const user = await User.create({
      code,
      name: req.body.name.trim(),
      email: req.body.email.trim().toLowerCase(),
      phone: cleanPhone,
      passwordHash,
      role: 'distributor',
      status: 'active',
      governorate: (req.body.governorate || '').trim(),
      address: (req.body.address || '').trim(),
      notes: (req.body.notes || '').trim(),
      createdBy: req.user.id,
    });

    await recordAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'DISTRIBUTOR_CREATED',
      entityType: 'User',
      entityId: user._id,
      newValues: { code, name: user.name, email: user.email, phone: cleanPhone },
      ...reqMeta(req),
    });

    res.status(201).json({
      success: true,
      message: 'تم إنشاء حساب المندوب بنجاح',
      data: { id: String(user._id), code: user.code, name: user.name, email: user.email, phone: user.phone, status: user.status },
    });
  } catch (err) {
    next(err);
  }
}

async function updateDistributor(req, res, next) {
  try {
    const user = await User.findOne({ _id: req.params.id, role: 'distributor' });
    if (!user) throw new AppError('المندوب غير موجود', 404);
    const prev = { name: user.name, phone: user.phone, status: user.status, governorate: user.governorate };

    if (req.body.name) user.name = String(req.body.name).trim();
    if (req.body.phone) {
      const clean = normalizeEgyptianPhone(req.body.phone);
      if (!isValidEgyptianPhone(clean)) throw new AppError('رقم الهاتف غير صالح', 400);
      user.phone = clean;
    }
    if (req.body.governorate !== undefined) user.governorate = String(req.body.governorate).trim();
    if (req.body.address !== undefined) user.address = String(req.body.address).trim();
    if (req.body.notes !== undefined) user.notes = String(req.body.notes).trim();
    if (req.body.status && ['active', 'inactive', 'suspended'].includes(req.body.status)) {
      user.status = req.body.status;
    }
    if (req.body.newPassword && String(req.body.newPassword).length >= 8) {
      user.passwordHash = await bcrypt.hash(String(req.body.newPassword), 12);
    }
    await user.save();

    await recordAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'DISTRIBUTOR_UPDATED',
      entityType: 'User',
      entityId: user._id,
      previousValues: prev,
      newValues: { name: user.name, phone: user.phone, status: user.status, governorate: user.governorate },
      ...reqMeta(req),
    });

    res.json({ success: true, message: 'تم تحديث بيانات المندوب بنجاح', data: { id: String(user._id), status: user.status } });
  } catch (err) {
    next(err);
  }
}

async function listAuditLogs(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
    const filter = {};
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.action) filter.action = req.query.action;

    const [total, items] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).populate('userId', 'name code role').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    res.json({ success: true, data: items, pagination: buildPaginationMeta(page, limit, total) });
  } catch (err) {
    next(err);
  }
}

async function getSettings(_req, res, next) {
  try {
    const settings = await SystemSetting.find().lean();
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    res.json({ success: true, data: map });
  } catch (err) {
    next(err);
  }
}

async function updateVerificationPolicy(req, res, next) {
  try {
    const value = {
      defaultVerificationMethod: req.body.defaultVerificationMethod,
      requireAdminApprovalForUnverified: Boolean(req.body.requireAdminApprovalForUnverified),
    };
    await SystemSetting.updateOne(
      { key: 'verification_policy' },
      { $set: { value, updatedBy: req.user.id } },
      { upsert: true }
    );
    await recordAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'VERIFICATION_POLICY_UPDATED',
      entityType: 'SystemSetting',
      entityId: 'verification_policy',
      newValues: value,
      ...reqMeta(req),
    });
    res.json({ success: true, message: 'تم تحديث سياسة التحقق بنجاح', data: value });
  } catch (err) {
    next(err);
  }
}

async function updateDistributorSubmissionPolicy(req, res, next) {
  try {
    const value = {
      allowDistributorSupportingDocs: Boolean(req.body.allowDistributorSupportingDocs),
      requireNationalIdInDistributorSubmission: Boolean(req.body.requireNationalIdInDistributorSubmission),
    };
    await SystemSetting.updateOne(
      { key: 'distributor_submission_policy' },
      { $set: { value, updatedBy: req.user.id } },
      { upsert: true }
    );
    await recordAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'DISTRIBUTOR_SUBMISSION_POLICY_UPDATED',
      entityType: 'SystemSetting',
      entityId: 'distributor_submission_policy',
      newValues: value,
      ...reqMeta(req),
    });
    res.json({ success: true, message: 'تم تحديث إعدادات تسجيل المستفيدين للمناديب', data: value });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAuthStatus,
  bootstrapAdmin,
  login,
  getMe,
  changePassword,
  requestPasswordReset,
  resetPassword,
  listDistributors,
  createDistributor,
  updateDistributor,
  listAuditLogs,
  getSettings,
  updateVerificationPolicy,
  updateDistributorSubmissionPolicy,
};
