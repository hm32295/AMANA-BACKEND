const {
  Beneficiary,
  Campaign,
  CampaignFunding,
  Allocation,
  Assignment,
  AssignmentItem,
  User,
  FinancialLedger,
} = require('../models');
const { generateReference } = require('../utils/crypto');
const { withMongoTransaction } = require('../utils/transactions');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');
const { getCampaignCategoryBreakdown } = require('./donationCampaignService');

/**
 * Allocates funds FIFO across CampaignFunding records matching (campaignId, assistanceType)
 * so every allocation preserves exact donation source attribution.
 */
async function buildFifoSourceBreakdown(campaignId, assistanceType, neededAmount, session) {
  const fundings = await CampaignFunding.find({ campaignId, assistanceType })
    .sort({ createdAt: 1, _id: 1 })
    .session(session)
    .lean();

  const existingAllocations = await Allocation.find({
    campaignId,
    assistanceType,
    status: { $ne: 'CANCELLED' },
  })
    .select('sourceBreakdown')
    .session(session)
    .lean();

  const usedByFundingId = {};
  for (const al of existingAllocations) {
    for (const src of al.sourceBreakdown || []) {
      const fid = String(src.campaignFundingId || '');
      usedByFundingId[fid] = (usedByFundingId[fid] || 0) + src.amount;
    }
  }

  let remaining = Number(neededAmount.toFixed(2));
  const sources = [];

  for (const f of fundings) {
    if (remaining <= 0.0001) break;
    const used = usedByFundingId[String(f._id)] || 0;
    const avail = Number((f.amount - used).toFixed(2));
    if (avail <= 0.0001) continue;

    const take = Number(Math.min(avail, remaining).toFixed(2));
    sources.push({
      campaignFundingId: f._id,
      donationId: f.donationId,
      assistanceType,
      amount: take,
    });
    remaining = Number((remaining - take).toFixed(2));
  }

  if (remaining > 0.01) {
    throw new AppError(`رصيد مصادر التمويل غير كافٍ للتصنيف (${assistanceType})`, 400);
  }
  return sources;
}

async function createAllocation(payload, adminUser, meta = {}) {
  const allocatedAmount = Number(payload.allocatedAmount);
  if (!Number.isFinite(allocatedAmount) || allocatedAmount <= 0) {
    throw new AppError('المبلغ المخصص يجب أن يكون أكبر من صفر', 400);
  }

  return withMongoTransaction(async (session) => {
    const [campaign, beneficiary] = await Promise.all([
      Campaign.findById(payload.campaignId).session(session),
      Beneficiary.findById(payload.beneficiaryId).session(session),
    ]);

    if (!campaign) throw new AppError('الحملة غير موجودة', 404);
    if (campaign.status !== 'active') throw new AppError('الحملة غير نشطة للتخصيص', 400);
    if (!beneficiary) throw new AppError('المستفيد غير موجود', 404);
    if (beneficiary.eligibilityStatus !== 'APPROVED' || beneficiary.beneficiaryStatus !== 'active') {
      throw new AppError('لا يمكن تخصيص أموال لمستفيد غير معتمد الأهلية (يجب موافقة الإدارة أولاً)', 400);
    }

    const assistanceType = payload.assistanceType.trim();
    if (!campaign.allowedDonationCategories.includes(assistanceType)) {
      throw new AppError(`نوع المساعدة (${assistanceType}) غير مسموح به ضمن هذه الحملة`, 400);
    }

    // Prevent duplicate active allocation for same beneficiary/campaign/category unless explicitly allowed
    const duplicate = await Allocation.exists({
      campaignId: campaign._id,
      beneficiaryId: beneficiary._id,
      assistanceType,
      status: { $in: ['DRAFT', 'APPROVED', 'ASSIGNED', 'PARTIALLY_DISTRIBUTED'] },
    }).session(session);
    if (duplicate && !payload.allowMultipleInSameCampaign) {
      throw new AppError('يوجد تخصيص نشط مسبقاً لنفس المستفيد في هذه الحملة ونفس نوع المساعدة', 409);
    }

    const breakdown = await getCampaignCategoryBreakdown(campaign._id, session);
    const catRow = breakdown.find((r) => r.assistanceType === assistanceType);
    const available = catRow ? catRow.availableToAllocate : 0;
    if (available + 0.0001 < allocatedAmount) {
      throw new AppError(
        `الرصيد المتاح للتخصيص في تصنيف (${assistanceType}) هو ${available} ج.م فقط ولا يكفي لمبلغ ${allocatedAmount} ج.م`,
        400
      );
    }

    const sourceBreakdown = await buildFifoSourceBreakdown(campaign._id, assistanceType, allocatedAmount, session);
    const reference = generateReference('ALC');

    const [allocation] = await Allocation.create(
      [
        {
          reference,
          campaignId: campaign._id,
          assistanceType,
          beneficiaryId: beneficiary._id,
          familyId: beneficiary.familyId,
          allocatedAmount,
          distributedAmount: 0,
          allocationDate: new Date(),
          expirationDate: payload.expirationDate ? new Date(payload.expirationDate) : undefined,
          status: 'APPROVED',
          sourceBreakdown,
          notes: (payload.notes || '').trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await FinancialLedger.create(
      [
        {
          reference: generateReference('LDG'),
          type: 'FUND_ALLOCATION',
          amount: allocatedAmount,
          assistanceType,
          campaignId: campaign._id,
          allocationId: allocation._id,
          beneficiaryId: beneficiary._id,
          sourceBreakdown: sourceBreakdown.map((s) => ({
            donationId: s.donationId,
            assistanceType: s.assistanceType,
            amount: s.amount,
          })),
          relatedReference: reference,
          description: `تخصيص مبلغ ${allocatedAmount} ج.م للمستفيد ${beneficiary.fullName}`,
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'ALLOCATION_CREATED',
        entityType: 'Allocation',
        entityId: allocation._id,
        newValues: { reference, campaignId: String(campaign._id), beneficiaryId: String(beneficiary._id), assistanceType, allocatedAmount },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return allocation;
  });
}

async function createAssignment(payload, adminUser, meta = {}) {
  return withMongoTransaction(async (session) => {
    const [distributor, campaign] = await Promise.all([
      User.findOne({ _id: payload.distributorId, role: 'distributor' }).session(session),
      Campaign.findById(payload.campaignId).session(session),
    ]);
    if (!distributor) throw new AppError('المندوب غير موجود', 404);
    if (distributor.status !== 'active') throw new AppError('حساب المندوب غير مفعل', 400);
    if (!campaign) throw new AppError('الحملة غير موجودة', 404);

    const allocationIds = payload.items.map((i) => i.allocationId);
    const allocations = await Allocation.find({ _id: { $in: allocationIds } }).session(session);
    if (allocations.length !== allocationIds.length) {
      throw new AppError('بعض التخصيصات المحددة غير موجودة', 404);
    }

    const firstType = allocations[0].assistanceType;
    const reference = generateReference('ASG');
    const [assignment] = await Assignment.create(
      [
        {
          reference,
          distributorId: distributor._id,
          campaignId: campaign._id,
          assistanceType: payload.assistanceType || firstType,
          dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
          verificationMethodOverride: payload.verificationMethodOverride || null,
          status: 'assigned',
          notes: (payload.notes || '').trim(),
          assignedBy: adminUser.id,
        },
      ],
      { session }
    );

    const itemDocs = [];
    for (const itemInput of payload.items) {
      const alloc = allocations.find((a) => String(a._id) === String(itemInput.allocationId));
      if (String(alloc.campaignId) !== String(campaign._id)) {
        throw new AppError('جميع التخصيصات في المهمة يجب أن تنتمي إلى نفس الحملة', 400);
      }
      if (!['APPROVED', 'PARTIALLY_DISTRIBUTED'].includes(alloc.status)) {
        throw new AppError(`التخصيص ${alloc.reference} مسند بالفعل أو غير متاح للتكليف`, 400);
      }
      const remaining = Number((alloc.allocatedAmount - alloc.distributedAmount).toFixed(2));
      const approvedAmount = Number(itemInput.approvedAmount || remaining);
      if (approvedAmount <= 0 || approvedAmount > remaining + 0.0001) {
        throw new AppError(`المبلغ المعتمد (${approvedAmount}) يتجاوز المتبقي من التخصيص (${remaining})`, 400);
      }

      itemDocs.push({
        assignmentId: assignment._id,
        allocationId: alloc._id,
        campaignId: campaign._id,
        distributorId: distributor._id,
        beneficiaryId: alloc.beneficiaryId,
        familyId: alloc.familyId,
        assistanceType: alloc.assistanceType,
        approvedAmount,
        status: 'assigned',
        instructions: (itemInput.instructions || '').trim(),
      });

      alloc.status = 'ASSIGNED';
      await alloc.save({ session });
    }

    const createdItems = await AssignmentItem.create(itemDocs, { session, ordered: true });

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'ASSIGNMENT_CREATED',
        entityType: 'Assignment',
        entityId: assignment._id,
        newValues: {
          reference,
          distributorId: String(distributor._id),
          campaignId: String(campaign._id),
          itemsCount: createdItems.length,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return { assignment, items: createdItems };
  });
}

async function listAllocations(queryParams = {}) {
  const filter = {};
  if (queryParams.campaignId) filter.campaignId = queryParams.campaignId;
  if (queryParams.assistanceType) filter.assistanceType = queryParams.assistanceType;
  if (queryParams.status) filter.status = queryParams.status;

  return Allocation.find(filter)
    .populate('beneficiaryId', 'beneficiaryCode fullName eligibilityStatus')
    .populate('campaignId', 'code name')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

async function listAssignments(currentUser, queryParams = {}) {
  const filter = {};
  if (currentUser.role === 'distributor') {
    filter.distributorId = currentUser.id;
  } else if (queryParams.distributorId) {
    filter.distributorId = queryParams.distributorId;
  }
  if (queryParams.campaignId) filter.campaignId = queryParams.campaignId;
  if (queryParams.status) filter.status = queryParams.status;

  const assignments = await Assignment.find(filter)
    .populate('distributorId', 'code name phone')
    .populate('campaignId', 'code name assistanceType verificationMethodOverride')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const ids = assignments.map((a) => a._id);
  const items = await AssignmentItem.find({ assignmentId: { $in: ids } })
    .populate('beneficiaryId', 'fullName conditions')
    .lean();

  const itemsByAsg = {};
  for (const it of items) {
    const k = String(it.assignmentId);
    if (!itemsByAsg[k]) itemsByAsg[k] = [];
    itemsByAsg[k].push({
      id: String(it._id),
      allocationId: String(it.allocationId),
      beneficiaryId: String(it.beneficiaryId?._id || it.beneficiaryId),
      beneficiaryName: it.beneficiaryId?.fullName || '',
      assistanceType: it.assistanceType,
      approvedAmount: it.approvedAmount,
      status: it.status,
    });
  }

  return assignments.map((a) => ({
    ...a,
    id: String(a._id),
    items: itemsByAsg[String(a._id)] || [],
  }));
}

module.exports = {
  createAllocation,
  createAssignment,
  listAllocations,
  listAssignments,
};
