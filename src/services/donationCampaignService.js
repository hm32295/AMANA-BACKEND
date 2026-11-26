const mongoose = require('mongoose');
const {
  DonationType,
  Donation,
  Campaign,
  CampaignFunding,
  Allocation,
  FinancialLedger,
} = require('../models');
const { generateReference } = require('../utils/crypto');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { withMongoTransaction } = require('../utils/transactions');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');

async function listDonationTypes(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  return DonationType.find(filter).sort({ sortOrder: 1, nameAr: 1 }).lean();
}

async function createDonationType(payload, adminUser, meta = {}) {
  const key = String(payload.key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!key || !/^[a-z0-9_]+$/.test(key)) {
    throw new AppError('مفتاح نوع التبرع يجب أن يتكون من أحرف إنجليزية وأرقام وشرطة سفلية فقط', 400);
  }
  const exists = await DonationType.exists({ key });
  if (exists) throw new AppError('نوع التبرع موجود مسبقاً', 409);

  const created = await DonationType.create({
    key,
    nameAr: payload.nameAr.trim(),
    nameEn: (payload.nameEn || '').trim(),
    description: (payload.description || '').trim(),
    restrictedByDefault: payload.restrictedByDefault !== false,
    isActive: true,
    sortOrder: Number(payload.sortOrder || 50),
    createdBy: adminUser.id,
  });

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'DONATION_TYPE_CREATED',
    entityType: 'DonationType',
    entityId: created._id,
    newValues: { key, nameAr: created.nameAr, restrictedByDefault: created.restrictedByDefault },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return created;
}

async function updateDonationType(id, updates, adminUser, meta = {}) {
  const doc = await DonationType.findById(id);
  if (!doc) throw new AppError('نوع التبرع غير موجود', 404);

  const prev = { nameAr: doc.nameAr, isActive: doc.isActive, restrictedByDefault: doc.restrictedByDefault };
  if (updates.nameAr !== undefined) doc.nameAr = String(updates.nameAr).trim();
  if (updates.nameEn !== undefined) doc.nameEn = String(updates.nameEn).trim();
  if (updates.description !== undefined) doc.description = String(updates.description).trim();
  if (updates.restrictedByDefault !== undefined) doc.restrictedByDefault = Boolean(updates.restrictedByDefault);
  if (updates.isActive !== undefined) doc.isActive = Boolean(updates.isActive);
  if (updates.sortOrder !== undefined) doc.sortOrder = Number(updates.sortOrder);
  await doc.save();

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'DONATION_TYPE_UPDATED',
    entityType: 'DonationType',
    entityId: doc._id,
    previousValues: prev,
    newValues: { nameAr: doc.nameAr, isActive: doc.isActive, restrictedByDefault: doc.restrictedByDefault },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return doc;
}

async function deleteDonationType(id, adminUser, meta = {}) {
  const doc = await DonationType.findById(id);
  if (!doc) throw new AppError('نوع التبرع غير موجود', 404);

  const [usedInDonations, usedInLedger] = await Promise.all([
    Donation.exists({ donationTypeKey: doc.key }),
    FinancialLedger.exists({ assistanceType: doc.key }),
  ]);

  if (usedInDonations || usedInLedger) {
    throw new AppError('لا يمكن حذف نوع تبرع مستخدم في سجلات مالية. يمكنك إلغاء تفعيله بدلاً من ذلك.', 409);
  }

  await doc.deleteOne();
  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'DONATION_TYPE_DELETED',
    entityType: 'DonationType',
    entityId: id,
    previousValues: { key: doc.key, nameAr: doc.nameAr },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { deleted: true };
}

async function getDonationRemainingAmount(donationId, session = null) {
  const donation = await (session ? Donation.findById(donationId).session(session) : Donation.findById(donationId));
  if (!donation) throw new AppError('التبرع غير موجود', 404);
  if (donation.status === 'reversed') return 0;

  const agg = await (session
    ? CampaignFunding.aggregate([
        { $match: { donationId: donation._id } },
        { $group: { _id: null, funded: { $sum: '$amount' } } },
      ]).session(session)
    : CampaignFunding.aggregate([
        { $match: { donationId: donation._id } },
        { $group: { _id: null, funded: { $sum: '$amount' } } },
      ]));
  const funded = agg[0]?.funded || 0;
  return Number((donation.amount - funded).toFixed(2));
}

async function createDonation(payload, files, adminUser, meta = {}) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('مبلغ التبرع يجب أن يكون أكبر من صفر', 400);
  }

  const donationType = await DonationType.findOne({ key: payload.donationTypeKey, isActive: true });
  if (!donationType) {
    throw new AppError('نوع التبرع المختار غير موجود أو غير مفعل', 400);
  }

  return withMongoTransaction(async (session) => {
    const reference = payload.reference?.trim() || generateReference('DON');
    const supportingDocuments = (files || []).map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    }));

    const [donation] = await Donation.create(
      [
        {
          reference,
          amount,
          currency: 'EGP',
          donationTypeKey: donationType.key,
          donationTypeId: donationType._id,
          donorName: (payload.donorName || 'فاعل خير').trim(),
          donorPhone: (payload.donorPhone || '').trim(),
          donationDate: payload.donationDate ? new Date(payload.donationDate) : new Date(),
          paymentMethod: payload.paymentMethod.trim(),
          restrictedCampaignId: payload.restrictedCampaignId || null,
          restrictionsNote: (payload.restrictionsNote || '').trim(),
          description: (payload.description || '').trim(),
          supportingDocuments,
          status: 'completed',
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'DONATION_RECEIVED',
          amount,
          assistanceType: donationType.key,
          donationId: donation._id,
          campaignId: donation.restrictedCampaignId || undefined,
          relatedReference: reference,
          description: `استلام تبرع ${donationType.nameAr} من ${donation.donorName}`,
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'DONATION_REGISTERED',
        entityType: 'Donation',
        entityId: donation._id,
        newValues: { reference, amount, donationTypeKey: donationType.key, donorName: donation.donorName },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return donation;
  });
}

async function listDonations(queryParams = {}) {
  const { page, limit, skip } = parsePagination(queryParams, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (queryParams.donationTypeKey) filter.donationTypeKey = queryParams.donationTypeKey;
  if (queryParams.status) filter.status = queryParams.status;

  const [total, donations] = await Promise.all([
    Donation.countDocuments(filter),
    Donation.find(filter).sort({ donationDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const ids = donations.map((d) => d._id);
  const fundedAgg = await CampaignFunding.aggregate([
    { $match: { donationId: { $in: ids } } },
    { $group: { _id: '$donationId', funded: { $sum: '$amount' } } },
  ]);
  const fundedMap = Object.fromEntries(fundedAgg.map((r) => [String(r._id), r.funded]));

  const items = donations.map((d) => {
    const fundedAmount = Number((fundedMap[String(d._id)] || 0).toFixed(2));
    return {
      ...d,
      id: String(d._id),
      fundedAmount,
      availableAmount: Number((d.amount - fundedAmount).toFixed(2)),
    };
  });

  return { items, pagination: buildPaginationMeta(page, limit, total) };
}

async function createCampaign(payload, adminUser, meta = {}) {
  const allowed = Array.isArray(payload.allowedDonationCategories) && payload.allowedDonationCategories.length > 0
    ? payload.allowedDonationCategories
    : [payload.assistanceType];

  const code = payload.code?.trim() || generateReference('CMP');
  const campaign = await Campaign.create({
    code,
    name: payload.name.trim(),
    description: (payload.description || '').trim(),
    assistanceType: payload.assistanceType.trim(),
    allowedDonationCategories: [...new Set(allowed)],
    startDate: new Date(payload.startDate),
    endDate: payload.endDate ? new Date(payload.endDate) : undefined,
    status: payload.status || 'active',
    targetAmount: Number(payload.targetAmount || 0),
    verificationMethodOverride: payload.verificationMethodOverride || null,
    requireApprovalWhenUnverified:
      payload.requireApprovalWhenUnverified !== undefined ? payload.requireApprovalWhenUnverified : null,
    notes: (payload.notes || '').trim(),
    createdBy: adminUser.id,
  });

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'CAMPAIGN_CREATED',
    entityType: 'Campaign',
    entityId: campaign._id,
    newValues: { code, name: campaign.name, assistanceType: campaign.assistanceType, allowedDonationCategories: campaign.allowedDonationCategories },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return campaign;
}

async function getCampaignCategoryBreakdown(campaignId, session = null) {
  const cid = new mongoose.Types.ObjectId(campaignId);
  const [fundingAgg, allocAgg, ledgerAgg] = await Promise.all([
    session
      ? CampaignFunding.aggregate([
          { $match: { campaignId: cid } },
          { $group: { _id: '$assistanceType', fundedAmount: { $sum: '$amount' } } },
        ]).session(session)
      : CampaignFunding.aggregate([
          { $match: { campaignId: cid } },
          { $group: { _id: '$assistanceType', fundedAmount: { $sum: '$amount' } } },
        ]),
    session
      ? Allocation.aggregate([
          { $match: { campaignId: cid, status: { $ne: 'CANCELLED' } } },
          {
            $group: {
              _id: '$assistanceType',
              allocatedAmount: { $sum: '$allocatedAmount' },
              distributedAmount: { $sum: '$distributedAmount' },
            },
          },
        ]).session(session)
      : Allocation.aggregate([
          { $match: { campaignId: cid, status: { $ne: 'CANCELLED' } } },
          {
            $group: {
              _id: '$assistanceType',
              allocatedAmount: { $sum: '$allocatedAmount' },
              distributedAmount: { $sum: '$distributedAmount' },
            },
          },
        ]),
    session
      ? FinancialLedger.aggregate([
          {
            $match: {
              campaignId: cid,
              type: { $in: ['CUSTODY_TRANSFER', 'CUSTODY_RETURN'] },
            },
          },
          { $group: { _id: { assistanceType: '$assistanceType', type: '$type' }, total: { $sum: '$amount' } } },
        ]).session(session)
      : FinancialLedger.aggregate([
          {
            $match: {
              campaignId: cid,
              type: { $in: ['CUSTODY_TRANSFER', 'CUSTODY_RETURN'] },
            },
          },
          { $group: { _id: { assistanceType: '$assistanceType', type: '$type' }, total: { $sum: '$amount' } } },
        ]),
  ]);

  const map = new Map();
  const ensure = (cat) => {
    if (!map.has(cat)) {
      map.set(cat, {
        assistanceType: cat,
        fundedAmount: 0,
        allocatedAmount: 0,
        availableToAllocate: 0,
        distributedAmount: 0,
        netCustodyTransferred: 0,
      });
    }
    return map.get(cat);
  };

  for (const f of fundingAgg) ensure(f._id).fundedAmount = Number(f.fundedAmount.toFixed(2));
  for (const a of allocAgg) {
    const row = ensure(a._id);
    row.allocatedAmount = Number(a.allocatedAmount.toFixed(2));
    row.distributedAmount = Number(a.distributedAmount.toFixed(2));
  }
  for (const l of ledgerAgg) {
    const row = ensure(l._id.assistanceType || 'other_donations');
    if (l._id.type === 'CUSTODY_TRANSFER') row.netCustodyTransferred += l.total;
    if (l._id.type === 'CUSTODY_RETURN') row.netCustodyTransferred -= l.total;
  }

  return Array.from(map.values()).map((r) => ({
    ...r,
    netCustodyTransferred: Number(r.netCustodyTransferred.toFixed(2)),
    availableToAllocate: Number((r.fundedAmount - r.allocatedAmount).toFixed(2)),
    remainingCashBalance: Number((r.fundedAmount - r.distributedAmount).toFixed(2)),
  }));
}

async function fundCampaignFromDonation(campaignId, { donationId, amount, notes }, adminUser, meta = {}) {
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    throw new AppError('مبلغ التمويل يجب أن يكون أكبر من صفر', 400);
  }

  return withMongoTransaction(async (session) => {
    const [campaign, donation] = await Promise.all([
      Campaign.findById(campaignId).session(session),
      Donation.findById(donationId).session(session),
    ]);
    if (!campaign) throw new AppError('الحملة غير موجودة', 404);
    if (!donation) throw new AppError('التبرع غير موجود', 404);
    if (donation.status !== 'completed') throw new AppError('التبرع معكوس ولا يمكن استخدامه', 400);

    // Restricted category & campaign check
    if (!campaign.allowedDonationCategories.includes(donation.donationTypeKey)) {
      throw new AppError(
        `لا يمكن تمويل الحملة بتبرع من فئة (${donation.donationTypeKey}) لعدم تطابقها مع التصنيفات المسموح بها للحملة`,
        400
      );
    }
    if (donation.restrictedCampaignId && String(donation.restrictedCampaignId) !== String(campaign._id)) {
      throw new AppError('هذا التبرع مقيد لحملة أخرى محددة ولا يمكن تحويله لحملة مختلفة', 400);
    }

    const available = await getDonationRemainingAmount(donation._id, session);
    if (available + 0.0001 < numAmount) {
      throw new AppError(`المتبقي من التبرع (${available} ج.م) لا يكفي لتمويل مبلغ ${numAmount} ج.م`, 400);
    }

    const [funding] = await CampaignFunding.create(
      [
        {
          campaignId: campaign._id,
          donationId: donation._id,
          assistanceType: donation.donationTypeKey,
          amount: numAmount,
          notes: (notes || '').trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'CAMPAIGN_FUNDING',
          amount: numAmount,
          assistanceType: donation.donationTypeKey,
          donationId: donation._id,
          campaignId: campaign._id,
          relatedReference: donation.reference,
          description: `تمويل الحملة ${campaign.name} من التبرع ${donation.reference}`,
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'CAMPAIGN_FUNDED',
        entityType: 'CampaignFunding',
        entityId: funding._id,
        newValues: {
          campaignId: String(campaign._id),
          donationId: String(donation._id),
          assistanceType: donation.donationTypeKey,
          amount: numAmount,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return funding;
  });
}

async function listCampaigns(queryParams = {}) {
  const filter = {};
  if (queryParams.status) filter.status = queryParams.status;
  const campaigns = await Campaign.find(filter).sort({ createdAt: -1 }).lean();

  const result = [];
  for (const c of campaigns) {
    const categoryBreakdown = await getCampaignCategoryBreakdown(c._id);
    const totalFunded = categoryBreakdown.reduce((s, r) => s + r.fundedAmount, 0);
    const totalAllocated = categoryBreakdown.reduce((s, r) => s + r.allocatedAmount, 0);
    const totalDistributed = categoryBreakdown.reduce((s, r) => s + r.distributedAmount, 0);
    result.push({
      ...c,
      id: String(c._id),
      totalFunded: Number(totalFunded.toFixed(2)),
      totalAllocated: Number(totalAllocated.toFixed(2)),
      totalDistributed: Number(totalDistributed.toFixed(2)),
      remainingBalance: Number((totalFunded - totalDistributed).toFixed(2)),
      availableToAllocate: Number((totalFunded - totalAllocated).toFixed(2)),
      categoryBreakdown,
    });
  }
  return result;
}

module.exports = {
  listDonationTypes,
  createDonationType,
  updateDonationType,
  deleteDonationType,
  getDonationRemainingAmount,
  createDonation,
  listDonations,
  createCampaign,
  getCampaignCategoryBreakdown,
  fundCampaignFromDonation,
  listCampaigns,
};
