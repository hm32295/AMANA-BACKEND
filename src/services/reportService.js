const mongoose = require('mongoose');
const {
  Beneficiary,
  Campaign,
  CampaignFunding,
  Allocation,
  AssignmentItem,
  DeliveryAttempt,
  Disbursement,
  Donation,
  DonationType,
  Family,
  FinancialLedger,
  Receipt,
  User,
} = require('../models');
const { getDonationTypeFallbackLabelAr } = require('../constants/amana');
const { maskPhone } = require('../utils/crypto');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { buildArabicTokenRegexes } = require('../utils/arabicSearch');
const { AppError } = require('../utils/errors');
const { getDistributorCustodySummary } = require('./custodyLedgerService');

function buildDateFilter(from, to, field = 'createdAt') {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    if (String(to).length <= 10) end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return { [field]: range };
}

async function getDonationTypeLabelMap() {
  const types = await DonationType.find().lean();
  const map = {};
  for (const t of types) map[t.key] = t.nameAr;
  return map;
}

async function getDashboardOverview(queryParams = {}) {
  const dateFilter = buildDateFilter(queryParams.from, queryParams.to, 'createdAt');
  const labelMap = await getDonationTypeLabelMap();

  const [
    ledgerAgg,
    donationsByType,
    distByType,
    distByCampaign,
    distByGovernorate,
    monthlyTimeline,
    familyCount,
    beneficiaryCounts,
    activeDistributors,
    activeCampaigns,
    disbursementCounts,
    failedAttemptsCount,
    allocAgg,
  ] = await Promise.all([
    FinancialLedger.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Donation.aggregate([
      { $match: { status: 'completed', ...buildDateFilter(queryParams.from, queryParams.to, 'donationDate') } },
      { $group: { _id: '$donationTypeKey', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Disbursement.aggregate([
      { $match: { status: 'COMPLETED', ...dateFilter } },
      { $group: { _id: '$assistanceType', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Disbursement.aggregate([
      { $match: { status: 'COMPLETED', ...dateFilter } },
      {
        $lookup: {
          from: 'campaigns',
          localField: 'campaignId',
          foreignField: '_id',
          as: 'campaign',
        },
      },
      { $unwind: '$campaign' },
      { $group: { _id: '$campaign._id', campaignName: { $first: '$campaign.name' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Disbursement.aggregate([
      { $match: { status: 'COMPLETED', ...dateFilter } },
      {
        $lookup: {
          from: 'beneficiaries',
          localField: 'beneficiaryId',
          foreignField: '_id',
          as: 'beneficiary',
        },
      },
      { $unwind: '$beneficiary' },
      { $group: { _id: '$beneficiary.governorate', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    FinancialLedger.aggregate([
      {
        $match: {
          type: { $in: ['DONATION_RECEIVED', 'BENEFICIARY_DISBURSEMENT'] },
          ...dateFilter,
        },
      },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            type: '$type',
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.month': 1 } },
    ]),
    Family.countDocuments(),
    Beneficiary.aggregate([{ $group: { _id: '$eligibilityStatus', count: { $sum: 1 } } }]),
    User.countDocuments({ role: 'distributor', status: 'active' }),
    Campaign.countDocuments({ status: 'active' }),
    Disbursement.aggregate([{ $match: dateFilter }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    DeliveryAttempt.countDocuments({ status: 'FAILED', ...dateFilter }),
    Allocation.aggregate([
      { $match: { status: { $ne: 'CANCELLED' }, ...dateFilter } },
      { $group: { _id: null, total: { $sum: '$allocatedAmount' } } },
    ]),
  ]);

  const byLedgerType = Object.fromEntries(ledgerAgg.map((r) => [r._id, r.total]));
  const totalDonations = Number((byLedgerType.DONATION_RECEIVED || 0).toFixed(2));
  const totalCampaignFunding = Number((byLedgerType.CAMPAIGN_FUNDING || 0).toFixed(2));
  const totalAllocated = Number((allocAgg[0]?.total || 0).toFixed(2));
  const totalCustodyTransferred = Number((byLedgerType.CUSTODY_TRANSFER || 0).toFixed(2));
  const grossDisbursed = Number((byLedgerType.BENEFICIARY_DISBURSEMENT || 0).toFixed(2));
  const totalReturned = Number((byLedgerType.CUSTODY_RETURN || 0).toFixed(2));
  const totalReversed = Number((byLedgerType.TRANSACTION_REVERSAL || 0).toFixed(2));
  const totalAdjustments = Number((byLedgerType.APPROVED_ADJUSTMENT || 0).toFixed(2));

  const netDistributed = Number((grossDisbursed - totalReversed).toFixed(2));
  const heldByDistributors = Number(
    (totalCustodyTransferred - grossDisbursed - totalReturned + totalReversed + totalAdjustments).toFixed(2)
  );
  const availableForAllocation = Number((totalDonations - totalAllocated).toFixed(2));
  const remainingUnspentDonations = Number((totalDonations - netDistributed - heldByDistributors).toFixed(2));

  const byDonTypeMap = Object.fromEntries(donationsByType.map((r) => [r._id, r.total]));
  const totalZakat = Number(((byDonTypeMap.zakat_al_mal || 0) + (byDonTypeMap.zakat_al_fitr || 0)).toFixed(2));
  const totalKaffarah = Number((byDonTypeMap.kaffarah || 0).toFixed(2));
  const totalSadaqah = Number((byDonTypeMap.general_sadaqah || 0).toFixed(2));

  const benByStatus = Object.fromEntries(beneficiaryCounts.map((r) => [r._id, r.count]));
  const dsbByStatus = Object.fromEntries(disbursementCounts.map((r) => [r._id, r.count]));

  return {
    financialSummary: {
      totalDonations,
      totalZakat,
      totalKaffarah,
      totalSadaqah,
      totalCampaignFunding,
      totalAllocated,
      totalCustodyTransferred,
      netDistributed,
      totalReturned,
      heldByDistributors,
      availableForAllocation,
      remainingUnspentDonations,
      totalReversed,
      totalAdjustments,
      reconciliationBalanced:
        Math.abs(totalDonations - (netDistributed + heldByDistributors + remainingUnspentDonations)) < 0.05,
    },
    operationalSummary: {
      totalFamilies: familyCount,
      totalBeneficiaries: Object.values(benByStatus).reduce((s, c) => s + c, 0),
      approvedBeneficiaries: benByStatus.APPROVED || 0,
      pendingBeneficiaries: benByStatus.PENDING_REVIEW || 0,
      suspendedBeneficiaries: benByStatus.SUSPENDED || 0,
      activeDistributors,
      activeCampaigns,
      completedDistributions: dsbByStatus.COMPLETED || 0,
      pendingDistributions: (dsbByStatus.PENDING || 0) + (dsbByStatus.IN_PROGRESS || 0),
      failedDeliveryAttempts: failedAttemptsCount,
      awaitingApproval: dsbByStatus.REQUIRES_APPROVAL || 0,
    },
    analytics: {
      donationsByType: donationsByType.map((r) => ({
        assistanceType: r._id,
        labelAr: labelMap[r._id] || getDonationTypeFallbackLabelAr(r._id),
        total: Number(r.total.toFixed(2)),
        count: r.count,
      })),
      distributionByType: distByType.map((r) => ({
        assistanceType: r._id,
        labelAr: labelMap[r._id] || getDonationTypeFallbackLabelAr(r._id),
        total: Number(r.total.toFixed(2)),
        count: r.count,
      })),
      distributionByCampaign: distByCampaign.map((r) => ({
        campaignId: String(r._id),
        campaignName: r.campaignName,
        total: Number(r.total.toFixed(2)),
        count: r.count,
      })),
      distributionByGovernorate: distByGovernorate.map((r) => ({
        governorate: r._id || 'غير محدد',
        total: Number(r.total.toFixed(2)),
        count: r.count,
      })),
      monthlyTimeline,
    },
  };
}

async function queryDetailedDistributions(queryParams = {}, currentUser = null) {
  const { page, limit, skip, sortSpec } = parsePagination(queryParams, {
    defaultLimit: 20,
    maxLimit: 100,
    allowedSortFields: ['createdAt', 'handoverConfirmedAt', 'amount', 'status'],
    defaultSortBy: 'createdAt',
  });

  const filter = {};
  if (currentUser && currentUser.role === 'distributor') {
    filter.distributorId = new mongoose.Types.ObjectId(currentUser.id);
  } else if (queryParams.distributorId) {
    filter.distributorId = new mongoose.Types.ObjectId(queryParams.distributorId);
  }
  if (queryParams.assistanceType) {
    filter.assistanceType = String(queryParams.assistanceType);
  }
  if (queryParams.campaignId) {
    filter.campaignId = new mongoose.Types.ObjectId(queryParams.campaignId);
  }
  if (queryParams.beneficiaryId) {
    filter.beneficiaryId = new mongoose.Types.ObjectId(queryParams.beneficiaryId);
  }
  if (queryParams.status) {
    filter.status = String(queryParams.status).toUpperCase();
  }
  Object.assign(filter, buildDateFilter(queryParams.from, queryParams.to, 'createdAt'));

  if (queryParams.q) {
    const tokenRegexes = buildArabicTokenRegexes(queryParams.q);
    if (tokenRegexes.length > 0) {
      const matchingBens = await Beneficiary.find({
        $and: tokenRegexes.map((rx) => ({ $or: [{ fullName: rx }, { fullNameNormalized: rx }, { beneficiaryCode: rx }] })),
      })
        .select('_id')
        .limit(200)
        .lean();
      const benIds = matchingBens.map((b) => b._id);
      filter.$or = [
        { reference: { $regex: queryParams.q, $options: 'i' } },
        ...(benIds.length > 0 ? [{ beneficiaryId: { $in: benIds } }] : []),
      ];
    }
  }

  const labelMap = await getDonationTypeLabelMap();

  const [total, docs, totalsAgg] = await Promise.all([
    Disbursement.countDocuments(filter),
    Disbursement.find(filter)
      .populate('beneficiaryId', 'beneficiaryCode fullName')
      .populate('familyId', 'familyCode headName')
      .populate('distributorId', 'code name')
      .populate('campaignId', 'code name')
      .populate('allocationId', 'reference allocatedAmount')
      .populate('receiptId', 'receiptNumber issuedAt')
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .lean(),
    Disbursement.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const items = docs.map((d) => ({
    id: String(d._id),
    reference: d.reference,
    date: d.handoverConfirmedAt || d.createdAt,
    beneficiaryId: String(d.beneficiaryId?._id || d.beneficiaryId),
    beneficiaryName: d.beneficiaryId?.fullName || '',
    beneficiaryCode: currentUser?.role === 'distributor' ? undefined : d.beneficiaryId?.beneficiaryCode,
    familyCode: currentUser?.role === 'distributor' ? undefined : d.familyId?.familyCode,
    familyHeadName: d.familyId?.headName || '',
    distributorId: String(d.distributorId?._id || d.distributorId),
    distributorName: d.distributorId?.name || '',
    distributorCode: d.distributorId?.code || '',
    campaignId: String(d.campaignId?._id || d.campaignId),
    campaignName: d.campaignId?.name || '',
    assistanceType: d.assistanceType,
    assistanceTypeLabelAr: labelMap[d.assistanceType] || getDonationTypeFallbackLabelAr(d.assistanceType),
    allocatedAmount: d.allocationId?.allocatedAmount || d.amount,
    deliveredAmount: d.status === 'COMPLETED' ? d.amount : 0,
    amount: d.amount,
    status: d.status,
    verificationMethod: d.verificationMethod,
    receiptNumber: d.receiptId?.receiptNumber || null,
    receiptId: d.receiptId?._id ? String(d.receiptId._id) : null,
    notes: d.notes || d.failureReason || d.reversalReason || '',
  }));

  const completedTotal = totalsAgg.find((t) => t._id === 'COMPLETED')?.amount || 0;
  const reversedTotal = totalsAgg.find((t) => t._id === 'REVERSED')?.amount || 0;

  return {
    items,
    totals: {
      totalDeliveredAmount: Number(completedTotal.toFixed(2)),
      totalReversedAmount: Number(reversedTotal.toFixed(2)),
      totalMatchingCount: total,
    },
    pagination: buildPaginationMeta(page, limit, total),
  };
}

async function getDistributorsSummaryReport(queryParams = {}) {
  const distributors = await User.find({ role: 'distributor' })
    .select('_id code name status governorate')
    .sort({ code: 1 })
    .lean();

  const items = [];
  for (const dist of distributors) {
    const custody = await getDistributorCustodySummary(dist._id, queryParams);
    const assignedItems = await AssignmentItem.find({ distributorId: dist._id }).lean();
    const dsbMatch = {
      distributorId: dist._id,
      ...buildDateFilter(queryParams.from, queryParams.to, 'createdAt'),
    };
    if (queryParams.assistanceType) dsbMatch.assistanceType = queryParams.assistanceType;
    if (queryParams.campaignId) dsbMatch.campaignId = new mongoose.Types.ObjectId(queryParams.campaignId);

    const dsbCounts = await Disbursement.aggregate([
      { $match: dsbMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const map = Object.fromEntries(dsbCounts.map((r) => [r._id, r.count]));
    const failedAttempts = await DeliveryAttempt.countDocuments({
      distributorId: dist._id,
      status: 'FAILED',
      ...buildDateFilter(queryParams.from, queryParams.to, 'createdAt'),
    });

    items.push({
      distributorId: String(dist._id),
      distributorCode: dist.code,
      distributorName: dist.name,
      status: dist.status,
      governorate: dist.governorate || '',
      totalAssignedAmount: Number(assignedItems.reduce((s, a) => s + a.approvedAmount, 0).toFixed(2)),
      assignedBeneficiariesCount: new Set(assignedItems.map((a) => String(a.beneficiaryId))).size,
      totalCustodyReceived: custody.totalTransferred,
      totalDistributed: custody.netDisbursed,
      totalReturned: custody.totalReturned,
      totalReversed: custody.totalReversed,
      totalAdjustments: custody.totalAdjustments,
      remainingCustodyBalance: custody.closingBalance,
      completedCount: map.COMPLETED || 0,
      pendingCount: (map.PENDING || 0) + (map.IN_PROGRESS || 0),
      failedAttemptsCount: failedAttempts,
      awaitingApprovalCount: map.REQUIRES_APPROVAL || 0,
    });
  }

  return items;
}

async function getSingleDistributorReport(distributorId, queryParams = {}) {
  const dist = await User.findOne({ _id: distributorId, role: 'distributor' })
    .select('_id code name phone status governorate')
    .lean();
  if (!dist) throw new AppError('المندوب غير موجود', 404);

  let openingBalance = 0;
  if (queryParams.from) {
    const beforeFrom = new Date(new Date(queryParams.from).getTime() - 1);
    const opening = await getDistributorCustodySummary(distributorId, {
      ...queryParams,
      from: undefined,
      to: beforeFrom.toISOString(),
    });
    openingBalance = opening.closingBalance;
  }

  const periodCustody = await getDistributorCustodySummary(distributorId, queryParams);
  const closingBalance = Number((openingBalance + periodCustody.closingBalance).toFixed(2));

  const assignedItems = await AssignmentItem.find({ distributorId: dist._id }).lean();
  const distributions = await queryDetailedDistributions({ ...queryParams, distributorId });

  return {
    distributor: {
      id: String(dist._id),
      code: dist.code,
      name: dist.name,
      status: dist.status,
      governorate: dist.governorate || '',
    },
    period: { from: queryParams.from || null, to: queryParams.to || null },
    summary: {
      totalAssignedAmount: Number(assignedItems.reduce((s, a) => s + a.approvedAmount, 0).toFixed(2)),
      assignedBeneficiariesCount: new Set(assignedItems.map((a) => String(a.beneficiaryId))).size,
      totalCustodyReceived: periodCustody.totalTransferred,
      totalDistributed: periodCustody.netDisbursed,
      totalReturned: periodCustody.totalReturned,
      remainingCustodyBalance: closingBalance,
      completedCount: distributions.items.filter((i) => i.status === 'COMPLETED').length,
      pendingCount: distributions.items.filter((i) => ['PENDING', 'IN_PROGRESS'].includes(i.status)).length,
      failedCount: distributions.items.filter((i) => i.status === 'FAILED').length,
      awaitingApprovalCount: distributions.items.filter((i) => i.status === 'REQUIRES_APPROVAL').length,
    },
    reconciliation: {
      openingBalance,
      newCustodyReceived: periodCustody.totalTransferred,
      completedDistributions: periodCustody.netDisbursed,
      returnedFunds: periodCustody.totalReturned,
      approvedAdjustments: periodCustody.totalAdjustments,
      reversals: periodCustody.totalReversed,
      closingBalance,
    },
    distributions,
  };
}

async function getAssistanceTypeReport(assistanceType, queryParams = {}) {
  const labelMap = await getDonationTypeLabelMap();
  const dateFilter = buildDateFilter(queryParams.from, queryParams.to, 'createdAt');
  const matchBase = { assistanceType, ...dateFilter };

  const [donationsAgg, allocationsAgg, ledgerAgg, completedBens, pendingDsb] = await Promise.all([
    Donation.aggregate([
      {
        $match: {
          donationTypeKey: assistanceType,
          status: 'completed',
          ...buildDateFilter(queryParams.from, queryParams.to, 'donationDate'),
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Allocation.aggregate([
      { $match: { assistanceType, status: { $ne: 'CANCELLED' }, ...dateFilter } },
      { $group: { _id: null, total: { $sum: '$allocatedAmount' } } },
    ]),
    FinancialLedger.aggregate([
      { $match: matchBase },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    Disbursement.distinct('beneficiaryId', {
      assistanceType,
      status: 'COMPLETED',
      ...(queryParams.distributorId ? { distributorId: new mongoose.Types.ObjectId(queryParams.distributorId) } : {}),
      ...dateFilter,
    }),
    Disbursement.countDocuments({
      assistanceType,
      status: { $in: ['PENDING', 'IN_PROGRESS', 'REQUIRES_APPROVAL'] },
      ...dateFilter,
    }),
  ]);

  const byType = Object.fromEntries(ledgerAgg.map((r) => [r._id, r.total]));
  const totalReceived = Number((donationsAgg[0]?.total || 0).toFixed(2));
  const totalAllocated = Number((allocationsAgg[0]?.total || 0).toFixed(2));
  const totalTransferred = Number((byType.CUSTODY_TRANSFER || 0).toFixed(2));
  const grossDisbursed = Number((byType.BENEFICIARY_DISBURSEMENT || 0).toFixed(2));
  const totalReversed = Number((byType.TRANSACTION_REVERSAL || 0).toFixed(2));
  const totalReturned = Number((byType.CUSTODY_RETURN || 0).toFixed(2));
  const netDistributed = Number((grossDisbursed - totalReversed).toFixed(2));
  const heldByDistributors = Number(
    (totalTransferred - grossDisbursed - totalReturned + totalReversed + (byType.APPROVED_ADJUSTMENT || 0)).toFixed(2)
  );
  const remainingAvailable = Number((totalReceived - netDistributed - heldByDistributors).toFixed(2));

  const distributions = await queryDetailedDistributions({ ...queryParams, assistanceType });

  return {
    assistanceType,
    labelAr: labelMap[assistanceType] || getDonationTypeFallbackLabelAr(assistanceType),
    summary: {
      totalReceived,
      totalAllocated,
      totalTransferred,
      totalActuallyDistributed: netDistributed,
      totalReturned,
      remainingAvailableBalance: remainingAvailable,
      heldByDistributors,
      beneficiariesCount: completedBens.length,
      completedDistributionsCount: distributions.totals.totalMatchingCount,
      pendingCount: pendingDsb,
    },
    distributions,
  };
}

async function getCampaignReport(campaignId, queryParams = {}) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw new AppError('الحملة غير موجودة', 404);

  const cid = campaign._id;
  const [fundings, allocAgg, ledgerAgg, completedBens, completedDists] = await Promise.all([
    CampaignFunding.find({ campaignId: cid }).populate('donationId', 'reference donorName donationTypeKey donationDate amount').lean(),
    Allocation.aggregate([
      { $match: { campaignId: cid, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: null, total: { $sum: '$allocatedAmount' } } },
    ]),
    FinancialLedger.aggregate([
      { $match: { campaignId: cid } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    Disbursement.distinct('beneficiaryId', { campaignId: cid, status: 'COMPLETED' }),
    Disbursement.distinct('distributorId', { campaignId: cid, status: 'COMPLETED' }),
  ]);

  const byType = Object.fromEntries(ledgerAgg.map((r) => [r._id, r.total]));
  const totalFunded = Number(fundings.reduce((s, f) => s + f.amount, 0).toFixed(2));
  const totalAllocated = Number((allocAgg[0]?.total || 0).toFixed(2));
  const totalTransferred = Number((byType.CUSTODY_TRANSFER || 0).toFixed(2));
  const netDistributed = Number(((byType.BENEFICIARY_DISBURSEMENT || 0) - (byType.TRANSACTION_REVERSAL || 0)).toFixed(2));
  const totalReturned = Number((byType.CUSTODY_RETURN || 0).toFixed(2));
  const remainingCampaignBalance = Number((totalFunded - netDistributed).toFixed(2));
  const completionPercentage = totalFunded > 0 ? Number(((netDistributed / totalFunded) * 100).toFixed(1)) : 0;

  const distributions = await queryDetailedDistributions({ ...queryParams, campaignId });

  return {
    campaign: { id: String(campaign._id), code: campaign.code, name: campaign.name, status: campaign.status },
    summary: {
      totalFunded,
      totalAllocated,
      totalTransferredToDistributors: totalTransferred,
      totalDistributed: netDistributed,
      totalReturned,
      remainingCampaignBalance,
      beneficiariesCount: completedBens.length,
      distributorsCount: completedDists.length,
      completionPercentage,
    },
    fundingSources: fundings.map((f) => ({
      id: String(f._id),
      donationReference: f.donationId?.reference || '',
      donorName: f.donationId?.donorName || '',
      assistanceType: f.assistanceType,
      amount: f.amount,
      fundedAt: f.createdAt,
    })),
    distributions,
  };
}

async function getBeneficiaryAssistanceHistory(beneficiaryId, queryParams = {}) {
  const beneficiary = await Beneficiary.findById(beneficiaryId)
    .populate('familyId', 'familyCode headName')
    .lean();
  if (!beneficiary) throw new AppError('المستفيد غير موجود', 404);

  const labelMap = await getDonationTypeLabelMap();
  const filter = {
    beneficiaryId: beneficiary._id,
    ...buildDateFilter(queryParams.from, queryParams.to, 'createdAt'),
  };
  if (queryParams.assistanceType) filter.assistanceType = queryParams.assistanceType;

  const allDsb = await Disbursement.find(filter)
    .populate('distributorId', 'code name')
    .populate('campaignId', 'code name')
    .populate('receiptId', 'receiptNumber')
    .sort({ createdAt: -1 })
    .lean();

  const mapItem = (d) => ({
    id: String(d._id),
    reference: d.reference,
    date: d.handoverConfirmedAt || d.createdAt,
    assistanceType: d.assistanceType,
    assistanceTypeLabelAr: labelMap[d.assistanceType] || getDonationTypeFallbackLabelAr(d.assistanceType),
    amount: d.amount,
    distributorName: d.distributorId?.name || '',
    campaignName: d.campaignId?.name || '',
    receiptNumber: d.receiptId?.receiptNumber || null,
    verificationMethod: d.verificationMethod,
    status: d.status,
    notes: d.failureReason || d.reversalReason || d.notes || '',
  });

  // Strict separation: ONLY COMPLETED counts as completed assistance!
  const completedAssistance = allDsb.filter((d) => d.status === 'COMPLETED').map(mapItem);
  const nonCompletedAttempts = allDsb.filter((d) => d.status !== 'COMPLETED').map(mapItem);

  return {
    beneficiary: {
      id: String(beneficiary._id),
      beneficiaryCode: beneficiary.beneficiaryCode,
      familyCode: beneficiary.familyId?.familyCode || '',
      fullName: beneficiary.fullName,
      maskedPhone: maskPhone(beneficiary.phone),
      governorate: beneficiary.governorate,
      eligibilityStatus: beneficiary.eligibilityStatus,
    },
    summary: {
      totalCompletedReceived: Number(completedAssistance.reduce((s, a) => s + a.amount, 0).toFixed(2)),
      completedCount: completedAssistance.length,
      pendingCount: nonCompletedAttempts.filter((a) => ['PENDING', 'IN_PROGRESS', 'REQUIRES_APPROVAL'].includes(a.status)).length,
      failedCount: nonCompletedAttempts.filter((a) => a.status === 'FAILED').length,
      reversedCount: nonCompletedAttempts.filter((a) => a.status === 'REVERSED').length,
      rejectedOrCancelledCount: nonCompletedAttempts.filter((a) => ['REJECTED', 'CANCELLED'].includes(a.status)).length,
    },
    completedAssistance,
    nonCompletedAttempts,
  };
}

async function getDisbursementTraceability(disbursementId) {
  const dsb = await Disbursement.findById(disbursementId)
    .populate('beneficiaryId', 'beneficiaryCode fullName governorate')
    .populate('familyId', 'familyCode headName')
    .populate('distributorId', 'code name')
    .populate('campaignId', 'code name')
    .populate('allocationId', 'reference allocatedAmount createdAt')
    .populate('receiptId')
    .lean();
  if (!dsb) throw new AppError('عملية الصرف غير موجودة', 404);

  const donationIds = (dsb.sourceBreakdown || []).map((s) => s.donationId);
  const donations = await Donation.find({ _id: { $in: donationIds } })
    .select('_id reference donorName donationTypeKey amount donationDate paymentMethod')
    .lean();
  const donMap = Object.fromEntries(donations.map((d) => [String(d._id), d]));

  const ledgerEntries = await FinancialLedger.find({
    $or: [{ disbursementId: dsb._id }, { allocationId: dsb.allocationId?._id }],
  })
    .sort({ createdAt: 1 })
    .lean();

  return {
    disbursement: {
      id: String(dsb._id),
      reference: dsb.reference,
      amount: dsb.amount,
      assistanceType: dsb.assistanceType,
      status: dsb.status,
      verificationMethod: dsb.verificationMethod,
      handoverConfirmedAt: dsb.handoverConfirmedAt,
    },
    beneficiary: dsb.beneficiaryId,
    family: dsb.familyId,
    distributor: dsb.distributorId,
    campaign: dsb.campaignId,
    allocation: dsb.allocationId,
    receipt: dsb.receiptId,
    originalDonations: (dsb.sourceBreakdown || []).map((s) => ({
      amountAttributed: s.amount,
      assistanceType: s.assistanceType,
      donation: donMap[String(s.donationId)] || null,
    })),
    ledgerEntries,
  };
}

module.exports = {
  getDashboardOverview,
  queryDetailedDistributions,
  getDistributorsSummaryReport,
  getSingleDistributorReport,
  getAssistanceTypeReport,
  getCampaignReport,
  getBeneficiaryAssistanceHistory,
  getDisbursementTraceability,
};
