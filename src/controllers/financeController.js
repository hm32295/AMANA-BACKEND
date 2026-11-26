const donationCampaignService = require('../services/donationCampaignService');
const allocationAssignmentService = require('../services/allocationAssignmentService');
const custodyLedgerService = require('../services/custodyLedgerService');
const { Campaign, CustodyTransaction, FinancialLedger } = require('../models');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { AppError } = require('../utils/errors');

function reqMeta(req) {
  return { ipAddress: req.ip || '', userAgent: req.get('user-agent') || '' };
}

async function listDonationTypes(req, res, next) {
  try {
    const includeInactive = req.user.role === 'admin' && req.query.includeInactive === 'true';
    const data = await donationCampaignService.listDonationTypes(includeInactive);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function createDonationType(req, res, next) {
  try {
    const data = await donationCampaignService.createDonationType(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم إضافة نوع التبرع بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function updateDonationType(req, res, next) {
  try {
    const data = await donationCampaignService.updateDonationType(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم تحديث نوع التبرع', data });
  } catch (err) {
    next(err);
  }
}

async function deleteDonationType(req, res, next) {
  try {
    const data = await donationCampaignService.deleteDonationType(req.params.id, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم حذف نوع التبرع', data });
  } catch (err) {
    next(err);
  }
}

async function listDonations(req, res, next) {
  try {
    const data = await donationCampaignService.listDonations(req.query);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (err) {
    next(err);
  }
}

async function createDonation(req, res, next) {
  try {
    const data = await donationCampaignService.createDonation(req.body, req.files, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تسجيل التبرع في الدفتر المالي بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function listCampaigns(req, res, next) {
  try {
    const data = await donationCampaignService.listCampaigns(req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function createCampaign(req, res, next) {
  try {
    const data = await donationCampaignService.createCampaign(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم إنشاء الحملة بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function updateCampaign(req, res, next) {
  try {
    const camp = await Campaign.findById(req.params.id);
    if (!camp) throw new AppError('الحملة غير موجودة', 404);
    for (const f of ['name', 'description', 'status', 'notes', 'verificationMethodOverride', 'requireApprovalWhenUnverified']) {
      if (req.body[f] !== undefined) camp[f] = req.body[f];
    }
    if (req.body.targetAmount !== undefined) camp.targetAmount = Number(req.body.targetAmount);
    await camp.save();
    res.json({ success: true, message: 'تم تحديث بيانات الحملة', data: camp });
  } catch (err) {
    next(err);
  }
}

async function fundCampaign(req, res, next) {
  try {
    const data = await donationCampaignService.fundCampaignFromDonation(req.params.id, req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تمويل الحملة من التبرع بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function listAllocations(req, res, next) {
  try {
    const data = await allocationAssignmentService.listAllocations(req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function createAllocation(req, res, next) {
  try {
    const data = await allocationAssignmentService.createAllocation(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تخصيص المبلغ للمستفيد بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function listAssignments(req, res, next) {
  try {
    const data = await allocationAssignmentService.listAssignments(req.user, req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function createAssignment(req, res, next) {
  try {
    const data = await allocationAssignmentService.createAssignment(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم إنشاء تكليف المندوب بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function transferCustody(req, res, next) {
  try {
    const data = await custodyLedgerService.transferCustody(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تسليم العهدة للمندوب بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function returnCustody(req, res, next) {
  try {
    const data = await custodyLedgerService.returnCustody(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تسجيل رد العهدة بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function recordAdjustment(req, res, next) {
  try {
    const data = await custodyLedgerService.recordApprovedAdjustment(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تسجيل التسوية المالية المعتمدة', data });
  } catch (err) {
    next(err);
  }
}

async function getCustodyReconciliation(req, res, next) {
  try {
    if (req.user.role === 'distributor') {
      const summary = await custodyLedgerService.getDistributorCustodySummary(req.user.id, req.query);
      const txs = await CustodyTransaction.find({ distributorId: req.user.id })
        .populate('campaignId', 'name code')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      return res.json({ success: true, data: { summary, transactions: txs } });
    }
    const items = await custodyLedgerService.listDistributorReconciliation(req.query);
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

async function listFinancialLedger(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.assistanceType) filter.assistanceType = req.query.assistanceType;
    if (req.query.campaignId) filter.campaignId = req.query.campaignId;
    if (req.query.distributorId) filter.distributorId = req.query.distributorId;

    const [total, items] = await Promise.all([
      FinancialLedger.countDocuments(filter),
      FinancialLedger.find(filter)
        .populate('campaignId', 'name code')
        .populate('distributorId', 'name code')
        .populate('beneficiaryId', 'beneficiaryCode fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    res.json({ success: true, data: items, pagination: buildPaginationMeta(page, limit, total) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDonationTypes,
  createDonationType,
  updateDonationType,
  deleteDonationType,
  listDonations,
  createDonation,
  listCampaigns,
  createCampaign,
  updateCampaign,
  fundCampaign,
  listAllocations,
  createAllocation,
  listAssignments,
  createAssignment,
  transferCustody,
  returnCustody,
  recordAdjustment,
  getCustodyReconciliation,
  listFinancialLedger,
};
