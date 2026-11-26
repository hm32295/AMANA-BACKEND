const crypto = require('crypto');
const {
  Assignment,
  AssignmentItem,
  Allocation,
  Beneficiary,
  Campaign,
  CustodyTransaction,
  DeliveryAttempt,
  Disbursement,
  DonationType,
  FinancialLedger,
  Receipt,
  SystemSetting,
  User,
  VerificationRecord,
} = require('../models');
const { getDonationTypeFallbackLabelAr } = require('../constants/amana');
const {
  generateNumericOtp,
  hashVerificationSecret,
  constantTimeHexEqual,
  generateReference,
} = require('../utils/crypto');
const { withMongoTransaction } = require('../utils/transactions');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');
const { sendOtpSms } = require('./smsService');
const { getDistributorCustodySummary } = require('./custodyLedgerService');
const { formatConditionsCompact } = require('./beneficiaryService');

async function getVerificationPolicy(campaign, assignment) {
  const settingDoc = await SystemSetting.findOne({ key: 'verification_policy' }).lean();
  const sys = settingDoc?.value || {
    defaultVerificationMethod: 'OTP',
    requireAdminApprovalForUnverified: false,
  };

  let method = sys.defaultVerificationMethod || 'OTP';
  let reason = 'السياسة الافتراضية للنظام';
  if (campaign?.verificationMethodOverride) {
    method = campaign.verificationMethodOverride;
    reason = 'تخصيص سياسة الحملة';
  }
  if (assignment?.verificationMethodOverride) {
    method = assignment.verificationMethodOverride;
    reason = 'تخصيص سياسة المهمة';
  }

  const requireApprovalWhenUnverified =
    campaign?.requireApprovalWhenUnverified !== null &&
    campaign?.requireApprovalWhenUnverified !== undefined
      ? Boolean(campaign.requireApprovalWhenUnverified)
      : Boolean(sys.requireAdminApprovalForUnverified);

  return { method, requireApprovalWhenUnverified, reason };
}

async function getTypeLabelAr(key) {
  const dt = await DonationType.findOne({ key }).select('nameAr').lean();
  return dt?.nameAr || getDonationTypeFallbackLabelAr(key);
}

/**
 * Returns ONLY the minimal operational context required for a distributor
 * to complete an assigned distribution for a selected beneficiary.
 */
async function getDistributorDistributionContext(beneficiaryId, distributorUser) {
  const beneficiary = await Beneficiary.findById(beneficiaryId)
    .select('_id fullName conditions eligibilityStatus beneficiaryStatus')
    .lean();
  if (!beneficiary) throw new AppError('المستفيد غير موجود', 404);
  if (beneficiary.eligibilityStatus !== 'APPROVED' || beneficiary.beneficiaryStatus !== 'active') {
    throw new AppError('المستفيد غير معتمد للاستلام', 403);
  }

  const items = await AssignmentItem.find({
    distributorId: distributorUser.id,
    beneficiaryId: beneficiary._id,
    status: { $in: ['assigned', 'in_progress'] },
  })
    .populate('assignmentId', 'reference verificationMethodOverride status')
    .populate('campaignId', 'code name verificationMethodOverride requireApprovalWhenUnverified')
    .lean();

  if (items.length === 0) {
    throw new AppError('هذا المستفيد غير مدرج ضمن مهامك النشطة', 403);
  }

  const enrichedItems = [];
  for (const item of items) {
    const custody = await getDistributorCustodySummary(distributorUser.id, {
      campaignId: item.campaignId._id,
      assistanceType: item.assistanceType,
    });
    const policy = await getVerificationPolicy(item.campaignId, item.assignmentId);
    const activeDsb = await Disbursement.findOne({
      assignmentItemId: item._id,
      status: { $in: ['PENDING', 'IN_PROGRESS', 'REQUIRES_APPROVAL'] },
    })
      .sort({ createdAt: -1 })
      .lean();

    enrichedItems.push({
      assignmentItemId: String(item._id),
      assignmentId: String(item.assignmentId._id),
      assignmentReference: item.assignmentId.reference,
      allocationId: String(item.allocationId),
      campaignId: String(item.campaignId._id),
      campaignName: item.campaignId.name,
      assistanceType: item.assistanceType,
      assistanceTypeLabelAr: await getTypeLabelAr(item.assistanceType),
      approvedAmount: item.approvedAmount,
      status: item.status,
      custodyAvailable: custody.closingBalance,
      verificationPolicy: policy,
      activeDisbursement: activeDsb
        ? {
            id: String(activeDsb._id),
            reference: activeDsb.reference,
            status: activeDsb.status,
            verificationMethod: activeDsb.verificationMethod,
          }
        : null,
    });
  }

  return {
    beneficiary: {
      id: String(beneficiary._id),
      fullName: beneficiary.fullName,
      conditions: formatConditionsCompact(beneficiary.conditions),
    },
    assignments: enrichedItems,
  };
}

async function startDisbursement(assignmentItemId, distributorUser, meta = {}) {
  const item = await AssignmentItem.findById(assignmentItemId);
  if (!item) throw new AppError('عنصر التكليف غير موجود', 404);
  if (String(item.distributorId) !== String(distributorUser.id)) {
    throw new AppError('هذه المهمة مخصصة لمندوب آخر', 403);
  }
  if (!['assigned', 'in_progress'].includes(item.status)) {
    throw new AppError('تم إغلاق أو إتمام هذا التكليف مسبقاً', 400);
  }

  const [assignment, allocation, campaign, beneficiary, distributor] = await Promise.all([
    Assignment.findById(item.assignmentId),
    Allocation.findById(item.allocationId),
    Campaign.findById(item.campaignId),
    Beneficiary.findById(item.beneficiaryId),
    User.findById(distributorUser.id),
  ]);

  if (!distributor || distributor.status !== 'active') throw new AppError('حساب المندوب غير مفعل', 403);
  if (!beneficiary || beneficiary.eligibilityStatus !== 'APPROVED') {
    throw new AppError('أهلية المستفيد غير معتمدة', 400);
  }
  if (!allocation || allocation.status === 'CANCELLED') {
    throw new AppError('التخصيص المالي غير صالح', 400);
  }
  const remainingAlloc = Number((allocation.allocatedAmount - allocation.distributedAmount).toFixed(2));
  if (remainingAlloc + 0.0001 < item.approvedAmount) {
    throw new AppError('الرصيد المتبقي في التخصيص لا يكفي للصرف', 400);
  }

  const custody = await getDistributorCustodySummary(distributorUser.id, {
    campaignId: item.campaignId,
    assistanceType: item.assistanceType,
  });
  if (custody.closingBalance + 0.0001 < item.approvedAmount) {
    throw new AppError(
      `رصيد عهدتك المتاح في هذا التصنيف (${custody.closingBalance} ج.م) غير كافٍ لصرف مبلغ ${item.approvedAmount} ج.م`,
      400
    );
  }

  const alreadyCompleted = await Disbursement.exists({
    assignmentItemId: item._id,
    status: 'COMPLETED',
  });
  if (alreadyCompleted) {
    throw new AppError('تم صرف هذه المساعدة مسبقاً ولا يمكن تكرار الصرف', 409);
  }

  const policy = await getVerificationPolicy(campaign, assignment);

  // Supersede older pending verification records for same item
  const oldPending = await Disbursement.find({
    assignmentItemId: item._id,
    status: { $in: ['PENDING', 'IN_PROGRESS'] },
  }).select('_id');
  if (oldPending.length > 0) {
    await VerificationRecord.updateMany(
      { disbursementId: { $in: oldPending.map((d) => d._id) }, status: 'pending' },
      { $set: { status: 'superseded' } }
    );
    await Disbursement.updateMany(
      { _id: { $in: oldPending.map((d) => d._id) } },
      { $set: { status: 'CANCELLED' } }
    );
  }

  const disbursement = await Disbursement.create({
    reference: generateReference('DSB'),
    assignmentId: assignment._id,
    assignmentItemId: item._id,
    allocationId: allocation._id,
    campaignId: campaign._id,
    beneficiaryId: beneficiary._id,
    familyId: beneficiary.familyId,
    distributorId: distributor._id,
    assistanceType: item.assistanceType,
    amount: item.approvedAmount,
    sourceBreakdown: allocation.sourceBreakdown.map((s) => ({
      donationId: s.donationId,
      campaignFundingId: s.campaignFundingId,
      assistanceType: s.assistanceType,
      amount: Number(((s.amount / allocation.allocatedAmount) * item.approvedAmount).toFixed(2)),
    })),
    verificationMethod: policy.method,
    verificationPolicyReason: policy.reason,
    status: 'IN_PROGRESS',
  });

  item.status = 'in_progress';
  await item.save();

  const attemptsCount = await DeliveryAttempt.countDocuments({ assignmentItemId: item._id });
  await DeliveryAttempt.create({
    disbursementId: disbursement._id,
    assignmentId: assignment._id,
    assignmentItemId: item._id,
    beneficiaryId: beneficiary._id,
    distributorId: distributor._id,
    attemptNumber: attemptsCount + 1,
    status: 'IN_PROGRESS',
    notes: `بدء تسليم بوضع تحقق ${policy.method}`,
  });

  let qrToken = null;
  let verificationInfo = {
    method: policy.method,
    verified: policy.method === 'NONE',
    requireApprovalWhenUnverified: policy.requireApprovalWhenUnverified,
  };

  if (policy.method === 'OTP') {
    const code = generateNumericOtp(6);
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashVerificationSecret(code, salt);
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
    const smsRes = await sendOtpSms({
      phone: beneficiary.phone,
      code,
      beneficiaryName: beneficiary.fullName,
      expiresMinutes: 3,
    });

    await VerificationRecord.create({
      disbursementId: disbursement._id,
      assignmentId: assignment._id,
      beneficiaryId: beneficiary._id,
      distributorId: distributor._id,
      amount: item.approvedAmount,
      method: 'OTP',
      targetPhone: beneficiary.phone,
      otpSalt: salt,
      otpHash,
      attempts: 0,
      maxAttempts: 5,
      lastSentAt: new Date(),
      expiresAt,
      status: 'pending',
      smsProvider: smsRes.provider,
      smsGatewayConfigured: smsRes.gatewayConfigured,
      smsDeliveryStatus: smsRes.deliveryStatus,
      smsProviderRef: smsRes.providerRef,
    });

    verificationInfo = {
      method: 'OTP',
      verified: false,
      expiresAt,
      smsDeliveryStatus: smsRes.deliveryStatus,
      smsGatewayConfigured: smsRes.gatewayConfigured,
    };
  } else if (policy.method === 'QR_CODE') {
    qrToken = `AMANA-QR-${crypto.randomBytes(18).toString('hex')}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashVerificationSecret(qrToken, salt);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await VerificationRecord.create({
      disbursementId: disbursement._id,
      assignmentId: assignment._id,
      beneficiaryId: beneficiary._id,
      distributorId: distributor._id,
      amount: item.approvedAmount,
      method: 'QR_CODE',
      otpSalt: salt,
      otpHash,
      attempts: 0,
      maxAttempts: 5,
      lastSentAt: new Date(),
      expiresAt,
      status: 'pending',
    });

    verificationInfo = {
      method: 'QR_CODE',
      verified: false,
      expiresAt,
      qrToken,
    };
  }

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: 'DISBURSEMENT_STARTED',
    entityType: 'Disbursement',
    entityId: disbursement._id,
    newValues: {
      reference: disbursement.reference,
      verificationMethod: policy.method,
      amount: disbursement.amount,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    disbursement: {
      id: String(disbursement._id),
      reference: disbursement.reference,
      status: disbursement.status,
      amount: disbursement.amount,
      assistanceType: disbursement.assistanceType,
      verificationMethod: disbursement.verificationMethod,
    },
    verification: verificationInfo,
  };
}

async function verifyCodeOrQr(disbursementId, methodExpected, inputCode, distributorUser, meta = {}) {
  const dsb = await Disbursement.findById(disbursementId);
  if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);
  if (String(dsb.distributorId) !== String(distributorUser.id)) {
    throw new AppError('غير مصرح لك بتأكيد هذه العملية', 403);
  }
  if (dsb.status === 'COMPLETED') {
    throw new AppError('هذه العملية مكتملة مسبقاً', 409);
  }

  const record = await VerificationRecord.findOne({
    disbursementId: dsb._id,
    method: methodExpected,
    status: { $in: ['pending', 'verified'] },
  })
    .sort({ createdAt: -1 })
    .select('+otpSalt +otpHash');

  if (!record) throw new AppError('لا توجد جلسة تحقق نشطة لهذه العملية', 404);
  if (record.status === 'verified') {
    throw new AppError('تم استخدام رمز التحقق مسبقاً (لا يسمح بإعادة الاستخدام)', 400);
  }
  if (record.expiresAt.getTime() < Date.now()) {
    record.status = 'expired';
    await record.save();
    throw new AppError('انتهت صلاحية رمز التحقق', 400);
  }
  if (record.attempts >= record.maxAttempts) {
    record.status = 'locked';
    await record.save();
    throw new AppError('تم تجاوز الحد الأقصى لمحاولات التحقق', 429);
  }

  const candidateHash = hashVerificationSecret(String(inputCode || '').trim(), record.otpSalt);
  const valid = constantTimeHexEqual(candidateHash, record.otpHash);

  if (!valid) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      record.status = 'locked';
    }
    await record.save();
    throw new AppError(
      record.status === 'locked'
        ? 'تم قفل التحقق لتجاوز عدد المحاولات المسموح'
        : `رمز التحقق غير صحيح (المتبقي ${record.maxAttempts - record.attempts} محاولات)`,
      400
    );
  }

  record.status = 'verified';
  record.verifiedAt = new Date();
  await record.save();

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: `${methodExpected}_VERIFIED`,
    entityType: 'Disbursement',
    entityId: dsb._id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { verified: true, method: methodExpected };
}

async function resendOtp(disbursementId, distributorUser, meta = {}) {
  const dsb = await Disbursement.findById(disbursementId);
  if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);
  if (String(dsb.distributorId) !== String(distributorUser.id)) throw new AppError('غير مصرح', 403);
  if (dsb.verificationMethod !== 'OTP') throw new AppError('وضع التحقق لهذه العملية ليس OTP', 400);

  const prev = await VerificationRecord.findOne({ disbursementId: dsb._id, method: 'OTP' }).sort({ createdAt: -1 });
  if (prev && Date.now() - prev.lastSentAt.getTime() < 30 * 1000) {
    throw new AppError('يرجى الانتظار 30 ثانية قبل إعادة إرسال الرمز', 429);
  }
  if (prev && prev.resendCount >= 3) {
    throw new AppError('تم استهلاك الحد الأقصى لإعادة إرسال رمز التحقق', 429);
  }

  const beneficiary = await Beneficiary.findById(dsb.beneficiaryId);
  const targetPhone = prev?.targetPhone || beneficiary.phone;
  if (prev && prev.status === 'pending') {
    prev.status = 'superseded';
    await prev.save();
  }

  const code = generateNumericOtp(6);
  const salt = crypto.randomBytes(16).toString('hex');
  const otpHash = hashVerificationSecret(code, salt);
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
  const smsRes = await sendOtpSms({
    phone: targetPhone,
    code,
    beneficiaryName: beneficiary.fullName,
    expiresMinutes: 3,
  });

  await VerificationRecord.create({
    disbursementId: dsb._id,
    assignmentId: dsb.assignmentId,
    beneficiaryId: dsb.beneficiaryId,
    distributorId: dsb.distributorId,
    amount: dsb.amount,
    method: 'OTP',
    targetPhone,
    otpSalt: salt,
    otpHash,
    resendCount: (prev?.resendCount || 0) + 1,
    lastSentAt: new Date(),
    expiresAt,
    status: 'pending',
    smsProvider: smsRes.provider,
    smsGatewayConfigured: smsRes.gatewayConfigured,
    smsDeliveryStatus: smsRes.deliveryStatus,
    smsProviderRef: smsRes.providerRef,
  });

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: 'OTP_RESENT',
    entityType: 'Disbursement',
    entityId: dsb._id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { resent: true, expiresAt };
}

async function finalizeDisbursementInSession(dsb, actorUser, session) {
  const [allocation, item, campaign, beneficiary, distributor] = await Promise.all([
    Allocation.findById(dsb.allocationId).session(session),
    AssignmentItem.findById(dsb.assignmentItemId).session(session),
    Campaign.findById(dsb.campaignId).session(session),
    Beneficiary.findById(dsb.beneficiaryId).session(session),
    User.findById(dsb.distributorId).session(session),
  ]);

  if (!distributor || distributor.status !== 'active') throw new AppError('حساب المندوب غير مفعل', 403);
  if (!beneficiary || beneficiary.eligibilityStatus !== 'APPROVED') {
    throw new AppError('المستفيد غير معتمد للصرف', 400);
  }
  const remainingAlloc = Number((allocation.allocatedAmount - allocation.distributedAmount).toFixed(2));
  if (remainingAlloc + 0.0001 < dsb.amount) {
    throw new AppError('الرصيد المتاح بالتخصيص غير كافٍ لإتمام الصرف', 400);
  }

  const custody = await getDistributorCustodySummary(
    dsb.distributorId,
    { campaignId: dsb.campaignId, assistanceType: dsb.assistanceType },
    session
  );
  if (custody.closingBalance + 0.0001 < dsb.amount) {
    throw new AppError(
      `رصيد عهدة المندوب غير كافٍ لإتمام الصرف (${custody.closingBalance} ج.م متاح)`,
      400
    );
  }

  dsb.status = 'COMPLETED';
  dsb.handoverConfirmedAt = new Date();
  await dsb.save({ session });

  allocation.distributedAmount = Number((allocation.distributedAmount + dsb.amount).toFixed(2));
  allocation.status =
    allocation.distributedAmount + 0.001 >= allocation.allocatedAmount ? 'COMPLETED' : 'PARTIALLY_DISTRIBUTED';
  await allocation.save({ session });

  item.status = 'completed';
  await item.save({ session });

  const remainingItems = await AssignmentItem.countDocuments({
    assignmentId: dsb.assignmentId,
    status: { $in: ['assigned', 'in_progress'] },
  }).session(session);
  if (remainingItems === 0) {
    await Assignment.updateOne({ _id: dsb.assignmentId }, { $set: { status: 'completed' } }, { session });
  }

  await DeliveryAttempt.updateOne(
    { disbursementId: dsb._id },
    { $set: { status: 'COMPLETED' } },
    { session }
  );

  const typeLabelAr = await getTypeLabelAr(dsb.assistanceType);
  const receiptNumber = generateReference('RCP');
  const [receipt] = await Receipt.create(
    [
      {
        receiptNumber,
        disbursementId: dsb._id,
        campaignId: campaign._id,
        campaignName: campaign.name,
        beneficiaryId: beneficiary._id,
        beneficiaryName: beneficiary.fullName,
        familyId: beneficiary.familyId,
        distributorId: distributor._id,
        distributorName: distributor.name,
        assistanceType: dsb.assistanceType,
        assistanceTypeLabelAr: typeLabelAr,
        amount: dsb.amount,
        currency: 'EGP',
        verificationMethod: dsb.verificationMethod,
        transactionReference: dsb.reference,
        notes: dsb.notes || '',
        issuedAt: dsb.handoverConfirmedAt,
      },
    ],
    { session }
  );

  dsb.receiptId = receipt._id;
  await dsb.save({ session });

  const custodyRef = generateReference('CST-DB');
  const [custodyTx] = await CustodyTransaction.create(
    [
      {
        reference: custodyRef,
        distributorId: distributor._id,
        campaignId: campaign._id,
        assignmentId: dsb.assignmentId,
        assistanceType: dsb.assistanceType,
        type: 'BENEFICIARY_DISBURSEMENT',
        amount: dsb.amount,
        reason: `صرف مساعدة (${typeLabelAr}) للمستفيد ${beneficiary.fullName}`,
        createdBy: actorUser.id,
      },
    ],
    { session }
  );

  await FinancialLedger.create(
    [
      {
        reference: generateReference('LDG'),
        type: 'BENEFICIARY_DISBURSEMENT',
        amount: dsb.amount,
        assistanceType: dsb.assistanceType,
        campaignId: campaign._id,
        allocationId: allocation._id,
        assignmentId: dsb.assignmentId,
        beneficiaryId: beneficiary._id,
        distributorId: distributor._id,
        disbursementId: dsb._id,
        custodyTransactionId: custodyTx._id,
        sourceBreakdown: dsb.sourceBreakdown.map((s) => ({
          donationId: s.donationId,
          assistanceType: s.assistanceType,
          amount: s.amount,
        })),
        relatedReference: dsb.reference,
        description: `صرف ${typeLabelAr} للمستفيد ${beneficiary.fullName} عبر ${distributor.name}`,
        createdBy: actorUser.id,
      },
    ],
    { session }
  );

  await recordAuditLog(
    {
      userId: actorUser.id,
      userRole: actorUser.role,
      action: 'DISBURSEMENT_COMPLETED',
      entityType: 'Disbursement',
      entityId: dsb._id,
      newValues: {
        reference: dsb.reference,
        receiptNumber,
        amount: dsb.amount,
        assistanceType: dsb.assistanceType,
        verificationMethod: dsb.verificationMethod,
      },
    },
    session
  );

  return { disbursement: dsb, receipt };
}

async function confirmPhysicalHandover(disbursementId, payload, distributorUser, meta = {}) {
  if (payload.physicalHandoverConfirmed !== true) {
    throw new AppError('يجب تأكيد تسليم المساعدة النقدية فعلياً يداً بيد لإتمام العملية', 400);
  }

  if (payload.idempotencyKey) {
    const existing = await Disbursement.findOne({ idempotencyKey: payload.idempotencyKey })
      .populate('receiptId')
      .lean();
    if (existing && existing.status === 'COMPLETED') {
      return { disbursement: existing, receipt: existing.receiptId };
    }
  }

  return withMongoTransaction(async (session) => {
    const dsb = await Disbursement.findById(disbursementId).session(session);
    if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);
    if (String(dsb.distributorId) !== String(distributorUser.id)) {
      throw new AppError('غير مصرح لك بتأكيد هذه العملية', 403);
    }
    if (dsb.status === 'COMPLETED') {
      throw new AppError('تم تأكيد وصرف هذه العملية مسبقاً', 409);
    }

    // Check duplicate payment on same assignment item
    const dupCompleted = await Disbursement.exists({
      assignmentItemId: dsb.assignmentItemId,
      status: 'COMPLETED',
      _id: { $ne: dsb._id },
    }).session(session);
    if (dupCompleted) {
      throw new AppError('تم صرف مساعدة هذا التكليف مسبقاً', 409);
    }

    if (payload.notes) dsb.notes = String(payload.notes).trim();
    if (payload.idempotencyKey) dsb.idempotencyKey = String(payload.idempotencyKey).trim();

    if (dsb.verificationMethod === 'OTP' || dsb.verificationMethod === 'QR_CODE') {
      const verifiedRec = await VerificationRecord.exists({
        disbursementId: dsb._id,
        method: dsb.verificationMethod,
        status: 'verified',
      }).session(session);
      if (!verifiedRec) {
        throw new AppError(`يجب إتمام التحقق عبر ${dsb.verificationMethod} قبل تأكيد التسليم النقدي`, 400);
      }
      return finalizeDisbursementInSession(dsb, distributorUser, session);
    }

    // Verification mode is NONE
    const [campaign, assignment] = await Promise.all([
      Campaign.findById(dsb.campaignId).session(session),
      Assignment.findById(dsb.assignmentId).session(session),
    ]);
    const policy = await getVerificationPolicy(campaign, assignment);

    if (policy.requireApprovalWhenUnverified) {
      dsb.status = 'REQUIRES_APPROVAL';
      dsb.handoverConfirmedAt = new Date();
      await dsb.save({ session });

      await recordAuditLog(
        {
          userId: distributorUser.id,
          userRole: distributorUser.role,
          action: 'DISBURSEMENT_SUBMITTED_FOR_APPROVAL',
          entityType: 'Disbursement',
          entityId: dsb._id,
          newValues: { status: 'REQUIRES_APPROVAL', verificationMethod: 'NONE' },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        session
      );

      return { disbursement: dsb, receipt: null, awaitingApproval: true };
    }

    return finalizeDisbursementInSession(dsb, distributorUser, session);
  });
}

async function reviewUnverifiedDisbursement(disbursementId, { decision, reason }, adminUser, meta = {}) {
  if (!['approve', 'reject'].includes(decision)) {
    throw new AppError('القرار يجب أن يكون approve أو reject', 400);
  }

  return withMongoTransaction(async (session) => {
    const dsb = await Disbursement.findById(disbursementId).session(session);
    if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);
    if (dsb.status !== 'REQUIRES_APPROVAL') {
      throw new AppError('هذه العملية ليست بانتظار موافقة الإدارة', 400);
    }

    dsb.approvalDecisionBy = adminUser.id;
    dsb.approvalDecisionAt = new Date();
    dsb.approvalDecisionReason = (reason || '').trim();

    if (decision === 'reject') {
      dsb.status = 'REJECTED';
      await dsb.save({ session });
      await AssignmentItem.updateOne({ _id: dsb.assignmentItemId }, { $set: { status: 'assigned' } }, { session });
      await recordAuditLog(
        {
          userId: adminUser.id,
          userRole: adminUser.role,
          action: 'UNVERIFIED_DISBURSEMENT_REJECTED',
          entityType: 'Disbursement',
          entityId: dsb._id,
          newValues: { status: 'REJECTED', reason: dsb.approvalDecisionReason },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        session
      );
      return { disbursement: dsb, receipt: null };
    }

    return finalizeDisbursementInSession(dsb, adminUser, session);
  });
}

async function recordFailedAttempt(assignmentItemId, { failureReason, notes }, distributorUser, meta = {}) {
  const item = await AssignmentItem.findById(assignmentItemId);
  if (!item) throw new AppError('عنصر التكليف غير موجود', 404);
  if (String(item.distributorId) !== String(distributorUser.id)) throw new AppError('غير مصرح', 403);
  if (!failureReason || !String(failureReason).trim()) {
    throw new AppError('سبب تعذر التسليم مطلوب', 400);
  }

  const attemptsCount = await DeliveryAttempt.countDocuments({ assignmentItemId: item._id });
  const attempt = await DeliveryAttempt.create({
    assignmentId: item.assignmentId,
    assignmentItemId: item._id,
    beneficiaryId: item.beneficiaryId,
    distributorId: distributorUser.id,
    attemptNumber: attemptsCount + 1,
    status: 'FAILED',
    failureReason: String(failureReason).trim(),
    notes: (notes || '').trim(),
  });

  await Disbursement.updateMany(
    { assignmentItemId: item._id, status: { $in: ['PENDING', 'IN_PROGRESS'] } },
    {
      $set: {
        status: 'FAILED',
        failureReason: String(failureReason).trim(),
        failureNotes: (notes || '').trim(),
      },
    }
  );

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: 'DELIVERY_ATTEMPT_FAILED',
    entityType: 'AssignmentItem',
    entityId: item._id,
    newValues: { failureReason, attemptNumber: attempt.attemptNumber },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return attempt;
}

async function requestException(disbursementId, { reason, notes }, distributorUser, meta = {}) {
  const dsb = await Disbursement.findById(disbursementId);
  if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);
  if (String(dsb.distributorId) !== String(distributorUser.id)) throw new AppError('غير مصرح', 403);
  if (dsb.status === 'COMPLETED') throw new AppError('العملية مكتملة مسبقاً', 400);
  if (!reason || !String(reason).trim()) throw new AppError('سبب طلب الاستثناء مطلوب', 400);

  dsb.status = 'REQUIRES_APPROVAL';
  dsb.exceptionReason = String(reason).trim();
  dsb.exceptionNotes = (notes || '').trim();
  await dsb.save();

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: 'EXCEPTION_REQUESTED',
    entityType: 'Disbursement',
    entityId: dsb._id,
    newValues: { exceptionReason: dsb.exceptionReason },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return dsb;
}

module.exports = {
  getVerificationPolicy,
  getDistributorDistributionContext,
  startDisbursement,
  verifyCodeOrQr,
  resendOtp,
  confirmPhysicalHandover,
  reviewUnverifiedDisbursement,
  recordFailedAttempt,
  requestException,
};
