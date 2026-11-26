const mongoose = require('mongoose');
const {
  User,
  Campaign,
  CustodyTransaction,
  Disbursement,
  Allocation,
  AssignmentItem,
  FinancialLedger,
} = require('../models');
const { generateReference } = require('../utils/crypto');
const { withMongoTransaction } = require('../utils/transactions');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');

async function getDistributorCustodySummary(distributorId, filters = {}, session = null) {
  const match = {
    distributorId: new mongoose.Types.ObjectId(distributorId),
    type: {
      $in: [
        'CUSTODY_TRANSFER',
        'BENEFICIARY_DISBURSEMENT',
        'CUSTODY_RETURN',
        'TRANSACTION_REVERSAL',
        'APPROVED_ADJUSTMENT',
      ],
    },
  };
  if (filters.campaignId) {
    match.campaignId = new mongoose.Types.ObjectId(filters.campaignId);
  }
  if (filters.assistanceType) {
    match.assistanceType = String(filters.assistanceType);
  }
  if (filters.from || filters.to) {
    match.createdAt = {};
    if (filters.from) match.createdAt.$gte = new Date(filters.from);
    if (filters.to) match.createdAt.$lte = new Date(filters.to);
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
      },
    },
  ];

  const agg = session
    ? await FinancialLedger.aggregate(pipeline).session(session)
    : await FinancialLedger.aggregate(pipeline);

  const byType = Object.fromEntries(agg.map((r) => [r._id, r.total]));
  const totalTransferred = Number((byType.CUSTODY_TRANSFER || 0).toFixed(2));
  const grossDisbursed = Number((byType.BENEFICIARY_DISBURSEMENT || 0).toFixed(2));
  const totalReturned = Number((byType.CUSTODY_RETURN || 0).toFixed(2));
  const totalReversed = Number((byType.TRANSACTION_REVERSAL || 0).toFixed(2));
  const totalAdjustments = Number((byType.APPROVED_ADJUSTMENT || 0).toFixed(2));
  const netDisbursed = Number((grossDisbursed - totalReversed).toFixed(2));
  const closingBalance = Number(
    (totalTransferred - grossDisbursed - totalReturned + totalReversed + totalAdjustments).toFixed(2)
  );

  return {
    totalTransferred,
    grossDisbursed,
    netDisbursed,
    totalReturned,
    totalReversed,
    totalAdjustments,
    closingBalance,
  };
}

async function getCampaignFundingPool(campaignId, assistanceType = null, session = null) {
  const { CampaignFunding } = require('../models');
  const match = { campaignId: new mongoose.Types.ObjectId(campaignId) };
  if (assistanceType) match.assistanceType = assistanceType;

  const fundingAgg = await (session
    ? CampaignFunding.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }]).session(session)
    : CampaignFunding.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }]));
  const totalFunded = Number((fundingAgg[0]?.total || 0).toFixed(2));

  const ledgerMatch = {
    campaignId: new mongoose.Types.ObjectId(campaignId),
    type: { $in: ['CUSTODY_TRANSFER', 'CUSTODY_RETURN'] },
  };
  if (assistanceType) ledgerMatch.assistanceType = assistanceType;

  const custodyAgg = await (session
    ? FinancialLedger.aggregate([{ $match: ledgerMatch }, { $group: { _id: '$type', total: { $sum: '$amount' } } }]).session(session)
    : FinancialLedger.aggregate([{ $match: ledgerMatch }, { $group: { _id: '$type', total: { $sum: '$amount' } } }]));
  const byType = Object.fromEntries(custodyAgg.map((r) => [r._id, r.total]));
  const netTransferred = Number(((byType.CUSTODY_TRANSFER || 0) - (byType.CUSTODY_RETURN || 0)).toFixed(2));

  return {
    totalFunded,
    netTransferred,
    availableToTransfer: Number((totalFunded - netTransferred).toFixed(2)),
  };
}

async function transferCustody(payload, adminUser, meta = {}) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('مبلغ العهدة يجب أن يكون أكبر من صفر', 400);
  }

  if (payload.idempotencyKey) {
    const existing = await CustodyTransaction.findOne({ idempotencyKey: payload.idempotencyKey }).lean();
    if (existing) return existing;
  }

  return withMongoTransaction(async (session) => {
    const [distributor, campaign] = await Promise.all([
      User.findOne({ _id: payload.distributorId, role: 'distributor' }).session(session),
      Campaign.findById(payload.campaignId).session(session),
    ]);
    if (!distributor) throw new AppError('المندوب غير موجود', 404);
    if (distributor.status !== 'active') throw new AppError('حساب المندوب غير مفعل', 400);
    if (!campaign) throw new AppError('الحملة غير موجودة', 404);

    const assistanceType = (payload.assistanceType || campaign.assistanceType).trim();
    const pool = await getCampaignFundingPool(campaign._id, assistanceType, session);
    if (pool.availableToTransfer + 0.0001 < amount) {
      throw new AppError(
        `الرصيد المتاح في الحملة لهذا التصنيف (${pool.availableToTransfer} ج.م) لا يكفي لتحويل عهدة بقيمة ${amount} ج.م`,
        400
      );
    }

    const reference = generateReference('CST-TR');
    const [tx] = await CustodyTransaction.create(
      [
        {
          reference,
          distributorId: distributor._id,
          campaignId: campaign._id,
          assignmentId: payload.assignmentId || null,
          assistanceType,
          type: 'CUSTODY_TRANSFER',
          amount,
          reason: (payload.reason || 'تسليم عهدة نقدية للمندوب').trim(),
          idempotencyKey: payload.idempotencyKey || undefined,
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'CUSTODY_TRANSFER',
          amount,
          assistanceType,
          campaignId: campaign._id,
          assignmentId: payload.assignmentId || undefined,
          distributorId: distributor._id,
          custodyTransactionId: tx._id,
          relatedReference: reference,
          description: `تسليم عهدة إلى المندوب ${distributor.name}`,
          reason: tx.reason,
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'CUSTODY_TRANSFERRED',
        entityType: 'CustodyTransaction',
        entityId: tx._id,
        newValues: { reference, distributorId: String(distributor._id), campaignId: String(campaign._id), assistanceType, amount },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return tx;
  });
}

async function returnCustody(payload, actorUser, meta = {}) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('مبلغ رد العهدة يجب أن يكون أكبر من صفر', 400);
  }

  const targetDistributorId =
    actorUser.role === 'distributor' ? actorUser.id : payload.distributorId;
  if (!targetDistributorId) throw new AppError('معرّف المندوب مطلوب', 400);

  return withMongoTransaction(async (session) => {
    const campaign = await Campaign.findById(payload.campaignId).session(session);
    if (!campaign) throw new AppError('الحملة غير موجودة', 404);

    const assistanceType = (payload.assistanceType || campaign.assistanceType).trim();
    const custody = await getDistributorCustodySummary(
      targetDistributorId,
      { campaignId: campaign._id, assistanceType },
      session
    );

    if (custody.closingBalance + 0.0001 < amount) {
      throw new AppError(
        `رصيد العهدة المتبقي (${custody.closingBalance} ج.م) أقل من مبلغ الرد المطلوب (${amount} ج.م)`,
        400
      );
    }

    const reference = generateReference('CST-RT');
    const [tx] = await CustodyTransaction.create(
      [
        {
          reference,
          distributorId: targetDistributorId,
          campaignId: campaign._id,
          assistanceType,
          type: 'CUSTODY_RETURN',
          amount,
          reason: (payload.reason || 'رد فائض العهدة النقدية').trim(),
          idempotencyKey: payload.idempotencyKey || undefined,
          createdBy: actorUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'CUSTODY_RETURN',
          amount,
          assistanceType,
          campaignId: campaign._id,
          distributorId: targetDistributorId,
          custodyTransactionId: tx._id,
          relatedReference: reference,
          description: 'رد فائض عهدة مالية',
          reason: tx.reason,
          createdBy: actorUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: actorUser.id,
        userRole: actorUser.role,
        action: 'CUSTODY_RETURNED',
        entityType: 'CustodyTransaction',
        entityId: tx._id,
        newValues: { reference, distributorId: String(targetDistributorId), campaignId: String(campaign._id), assistanceType, amount },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return tx;
  });
}

async function recordApprovedAdjustment(payload, adminUser, meta = {}) {
  const amount = Number(payload.amount);
  const direction = payload.direction === 'credit' ? 'credit' : 'debit';
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('مبلغ التسوية يجب أن يكون أكبر من صفر', 400);
  }
  if (!payload.reason || !String(payload.reason).trim()) {
    throw new AppError('سبب التسوية المالية المعتمدة مطلوب', 400);
  }

  return withMongoTransaction(async (session) => {
    const campaign = await Campaign.findById(payload.campaignId).session(session);
    if (!campaign) throw new AppError('الحملة غير موجودة', 404);
    const assistanceType = (payload.assistanceType || campaign.assistanceType).trim();

    if (direction === 'debit') {
      const custody = await getDistributorCustodySummary(
        payload.distributorId,
        { campaignId: campaign._id, assistanceType },
        session
      );
      if (custody.closingBalance + 0.0001 < amount) {
        throw new AppError('رصيد العهدة غير كافٍ لخصم التسوية', 400);
      }
    }

    const signedAmount = direction === 'credit' ? amount : -amount;
    const reference = generateReference('CST-ADJ');
    const [tx] = await CustodyTransaction.create(
      [
        {
          reference,
          distributorId: payload.distributorId,
          campaignId: campaign._id,
          assistanceType,
          type: 'APPROVED_ADJUSTMENT',
          amount,
          reason: `[${direction}] ${String(payload.reason).trim()}`,
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'APPROVED_ADJUSTMENT',
          amount: signedAmount,
          assistanceType,
          campaignId: campaign._id,
          distributorId: payload.distributorId,
          custodyTransactionId: tx._id,
          relatedReference: reference,
          description: `تسوية مالية معتمدة (${direction})`,
          reason: String(payload.reason).trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'FINANCIAL_ADJUSTMENT_APPROVED',
        entityType: 'CustodyTransaction',
        entityId: tx._id,
        newValues: { reference, direction, amount, assistanceType, reason: payload.reason },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return tx;
  });
}

async function reverseCompletedDisbursement(disbursementId, reason, adminUser, meta = {}) {
  if (!reason || !String(reason).trim()) {
    throw new AppError('سبب القيد العكسي مطلوب', 400);
  }

  return withMongoTransaction(async (session) => {
    const dsb = await Disbursement.findById(disbursementId).session(session);
    if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);
    if (dsb.status !== 'COMPLETED') {
      throw new AppError('لا يمكن عكس إلا عمليات الصرف المكتملة فقط', 400);
    }

    dsb.status = 'REVERSED';
    dsb.reversedAt = new Date();
    dsb.reversedBy = adminUser.id;
    dsb.reversalReason = String(reason).trim();
    await dsb.save({ session });

    await Allocation.updateOne(
      { _id: dsb.allocationId },
      {
        $inc: { distributedAmount: -dsb.amount },
        $set: { status: 'ASSIGNED' },
      },
      { session }
    );

    await AssignmentItem.updateOne(
      { _id: dsb.assignmentItemId },
      { $set: { status: 'assigned' } },
      { session }
    );

    const revRef = generateReference('REV');
    const [tx] = await CustodyTransaction.create(
      [
        {
          reference: revRef,
          distributorId: dsb.distributorId,
          campaignId: dsb.campaignId,
          assignmentId: dsb.assignmentId,
          assistanceType: dsb.assistanceType,
          type: 'TRANSACTION_REVERSAL',
          amount: dsb.amount,
          reason: String(reason).trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'TRANSACTION_REVERSAL',
          amount: dsb.amount,
          assistanceType: dsb.assistanceType,
          campaignId: dsb.campaignId,
          allocationId: dsb.allocationId,
          assignmentId: dsb.assignmentId,
          beneficiaryId: dsb.beneficiaryId,
          distributorId: dsb.distributorId,
          disbursementId: dsb._id,
          custodyTransactionId: tx._id,
          sourceBreakdown: dsb.sourceBreakdown,
          relatedReference: dsb.reference,
          description: `قيد عكسي لعملية الصرف ${dsb.reference}`,
          reason: String(reason).trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'DISBURSEMENT_REVERSED',
        entityType: 'Disbursement',
        entityId: dsb._id,
        previousValues: { status: 'COMPLETED' },
        newValues: { status: 'REVERSED', reversalReason: dsb.reversalReason, amount: dsb.amount },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return dsb;
  });
}

async function listDistributorReconciliation(filters = {}) {
  const distributors = await User.find({ role: 'distributor' })
    .select('_id code name phone email status governorate')
    .sort({ code: 1 })
    .lean();

  const items = [];
  for (const dist of distributors) {
    const summary = await getDistributorCustodySummary(dist._id, filters);
    items.push({
      distributorId: String(dist._id),
      distributorCode: dist.code,
      distributorName: dist.name,
      status: dist.status,
      governorate: dist.governorate || '',
      ...summary,
    });
  }
  return items;
}

module.exports = {
  getDistributorCustodySummary,
  getCampaignFundingPool,
  transferCustody,
  returnCustody,
  recordApprovedAdjustment,
  reverseCompletedDisbursement,
  listDistributorReconciliation,
};
