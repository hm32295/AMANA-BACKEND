const beneficiaryService = require('../services/beneficiaryService');
const beneficiaryRequestService = require('../services/beneficiaryRequestService');
const { Family, FamilyMember, BeneficiaryCase } = require('../models');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

function reqMeta(req) {
  return { ipAddress: req.ip || '', userAgent: req.get('user-agent') || '' };
}

// Manual Beneficiary Search (minimal payload only)
async function searchBeneficiaries(req, res, next) {
  try {
    const data = await beneficiaryService.searchBeneficiaries(req.query, req.user);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (err) {
    next(err);
  }
}

async function listBeneficiariesAdmin(req, res, next) {
  try {
    const data = await beneficiaryService.listBeneficiariesAdmin(req.query);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (err) {
    next(err);
  }
}

async function createBeneficiaryAdmin(req, res, next) {
  try {
    const data = await beneficiaryService.createFamilyAndBeneficiary(req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تسجيل المستفيد والأسرة بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function getBeneficiaryDetailsAdmin(req, res, next) {
  try {
    const data = await beneficiaryService.getBeneficiaryDetailsAdmin(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function updateBeneficiaryAdmin(req, res, next) {
  try {
    const data = await beneficiaryService.updateBeneficiaryAdmin(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم تحديث بيانات المستفيد وتسجيل المراجعة', data });
  } catch (err) {
    next(err);
  }
}

async function reviewEligibilityAdmin(req, res, next) {
  try {
    const data = await beneficiaryService.reviewBeneficiaryEligibility(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم تحديث حالة الأهلية', data });
  } catch (err) {
    next(err);
  }
}

async function listFamilies(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [total, items] = await Promise.all([
      Family.countDocuments(),
      Family.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    res.json({
      success: true,
      data: items.map((f) => ({ ...f, id: String(f._id) })),
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
}

async function addFamilyMember(req, res, next) {
  try {
    const data = await beneficiaryService.addFamilyMember(req.params.familyId, req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم إضافة فرد الأسرة بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function removeFamilyMemberHistorical(req, res, next) {
  try {
    const data = await beneficiaryService.removeFamilyMemberHistorical(
      req.params.memberId,
      req.body.reason,
      req.user,
      reqMeta(req)
    );
    res.json({ success: true, message: 'تم أرشفة سجل فرد الأسرة تاريخياً', data });
  } catch (err) {
    next(err);
  }
}

async function listBeneficiaryCases(req, res, next) {
  try {
    const filter = {};
    if (req.query.eligibilityStatus) filter.eligibilityStatus = req.query.eligibilityStatus;
    if (req.query.beneficiaryId) filter.beneficiaryId = req.query.beneficiaryId;
    const cases = await BeneficiaryCase.find(filter)
      .populate('beneficiaryId', 'beneficiaryCode fullName eligibilityStatus')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: cases });
  } catch (err) {
    next(err);
  }
}

// Distributor Beneficiary Registration Requests
async function submitBeneficiaryRequest(req, res, next) {
  try {
    const data = await beneficiaryRequestService.submitBeneficiaryRequest(req.body, req.files, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم إرسال طلب المستفيد للمراجعة الإدارية بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function listMyRequests(req, res, next) {
  try {
    const data = await beneficiaryRequestService.listMyRequests(req.user, req.query);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (err) {
    next(err);
  }
}

async function getMyRequestById(req, res, next) {
  try {
    const data = await beneficiaryRequestService.getMyRequestById(req.params.id, req.user);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function resubmitRequest(req, res, next) {
  try {
    const data = await beneficiaryRequestService.resubmitRequest(req.params.id, req.body, req.files, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم إعادة إرسال الطلب للمراجعة بنجاح', data });
  } catch (err) {
    next(err);
  }
}

// Admin Beneficiary Registration Requests Queue
async function listAdminRequests(req, res, next) {
  try {
    const data = await beneficiaryRequestService.listAdminRequests(req.query);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (err) {
    next(err);
  }
}

async function getAdminRequestById(req, res, next) {
  try {
    const data = await beneficiaryRequestService.getAdminRequestById(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function markUnderReview(req, res, next) {
  try {
    const data = await beneficiaryRequestService.markRequestUnderReview(req.params.id, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم وضع الطلب قيد المراجعة', data });
  } catch (err) {
    next(err);
  }
}

async function requestMoreInfo(req, res, next) {
  try {
    const data = await beneficiaryRequestService.requestMoreInfoOnSubmission(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم إرسال طلب استكمال البيانات للمندوب', data });
  } catch (err) {
    next(err);
  }
}

async function rejectRequest(req, res, next) {
  try {
    const data = await beneficiaryRequestService.rejectBeneficiaryRequest(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم رفض الطلب مع الاحتفاظ بسجله التاريخي', data });
  } catch (err) {
    next(err);
  }
}

async function approveRequest(req, res, next) {
  try {
    const data = await beneficiaryRequestService.approveBeneficiaryRequest(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تمت الموافقة واعتماد المستفيد في النظام', data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  searchBeneficiaries,
  listBeneficiariesAdmin,
  createBeneficiaryAdmin,
  getBeneficiaryDetailsAdmin,
  updateBeneficiaryAdmin,
  reviewEligibilityAdmin,
  listFamilies,
  addFamilyMember,
  removeFamilyMemberHistorical,
  listBeneficiaryCases,
  submitBeneficiaryRequest,
  listMyRequests,
  getMyRequestById,
  resubmitRequest,
  listAdminRequests,
  getAdminRequestById,
  markUnderReview,
  requestMoreInfo,
  rejectRequest,
  approveRequest,
};
