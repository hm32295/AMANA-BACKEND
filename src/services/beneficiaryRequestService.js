const {
  Beneficiary,
  BeneficiaryCase,
  BeneficiaryRequest,
  Family,
  FamilyMember,
  SystemSetting,
} = require('../models');
const { getConditionLabelAr } = require('../constants/amana');
const {
  normalizeEgyptianPhone,
  isValidEgyptianPhone,
  normalizeNationalId,
  isValidEgyptianNationalId,
  hashNationalId,
  encryptSensitiveField,
  maskPhone,
  maskNationalIdLast4,
  generateReference,
} = require('../utils/crypto');
const { normalizeArabicText } = require('../utils/arabicSearch');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { withMongoTransaction } = require('../utils/transactions');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');
const {
  formatConditionsCompact,
  generateNextFamilyCode,
  generateNextBeneficiaryCode,
} = require('./beneficiaryService');

function parseConditionsInput(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch (_e) {
      arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return Array.isArray(arr) ? [...new Set(arr.filter(Boolean))] : [];
}

function parseMembersInput(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }
  return [];
}

async function detectPossibleDuplicates({ nationalIdHash, phone, fullNameNormalized, excludeBeneficiaryId }) {
  const orConds = [];
  if (nationalIdHash) orConds.push({ nationalIdHash });
  if (phone) orConds.push({ phone }, { alternativePhone: phone });
  if (fullNameNormalized) orConds.push({ fullNameNormalized });

  if (orConds.length === 0) return [];

  const query = { $or: orConds };
  if (excludeBeneficiaryId) {
    query._id = { $ne: excludeBeneficiaryId };
  }

  const matches = await Beneficiary.find(query)
    .select('_id beneficiaryCode fullName nationalIdHash phone fullNameNormalized')
    .limit(10)
    .lean();

  return matches.map((m) => {
    const reasons = [];
    if (nationalIdHash && m.nationalIdHash === nationalIdHash) reasons.push('تطابق الرقم القومي');
    if (phone && m.phone === phone) reasons.push('تطابق رقم الهاتف');
    if (fullNameNormalized && m.fullNameNormalized === fullNameNormalized) reasons.push('تطابق الاسم');
    return {
      beneficiaryId: m._id,
      beneficiaryCode: m.beneficiaryCode,
      fullName: m.fullName,
      matchReason: reasons.join(' و ') || 'تشابه محتمل',
    };
  });
}

function formatRequestSummary(doc, isAdmin = false) {
  return {
    id: String(doc._id),
    requestNumber: doc.requestNumber,
    requestType: doc.requestType,
    targetBeneficiaryId: doc.targetBeneficiaryId ? String(doc.targetBeneficiaryId) : null,
    submittedBy: doc.submittedBy?._id
      ? {
          id: String(doc.submittedBy._id),
          name: doc.submittedBy.name,
          code: doc.submittedBy.code,
        }
      : String(doc.submittedBy),
    fullName: doc.fullName,
    phone: isAdmin ? doc.phone : maskPhone(doc.phone),
    maskedPhone: maskPhone(doc.phone),
    alternativePhone: isAdmin ? doc.alternativePhone || '' : '',
    maskedNationalId: doc.nationalIdLast4 ? maskNationalIdLast4(doc.nationalIdLast4) : '',
    governorate: doc.governorate,
    cityDistrict: doc.cityDistrict,
    village: doc.village || '',
    detailedAddress: doc.detailedAddress,
    familyHeadName: doc.familyHeadName || doc.fullName,
    familySize: doc.familySize,
    familyMembers: doc.familyMembers || [],
    socialCondition: doc.socialCondition,
    economicCondition: doc.economicCondition,
    conditions: formatConditionsCompact(doc.conditions),
    caseDescription: doc.caseDescription || '',
    notes: doc.notes || '',
    supportingDocuments: doc.supportingDocuments || [],
    status: doc.status,
    possibleDuplicates: isAdmin ? doc.possibleDuplicates || [] : [],
    hasPossibleDuplicate: Array.isArray(doc.possibleDuplicates) && doc.possibleDuplicates.length > 0,
    reviewedAt: doc.reviewedAt || null,
    reviewNotes: doc.reviewNotes || '',
    rejectionReason: doc.rejectionReason || '',
    requestedInfoNotes: doc.requestedInfoNotes || '',
    approvedBeneficiaryId: doc.approvedBeneficiaryId ? String(doc.approvedBeneficiaryId) : null,
    resubmissionHistory: doc.resubmissionHistory || [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function submitBeneficiaryRequest(payload, files, distributorUser, meta = {}) {
  const policyDoc = await SystemSetting.findOne({ key: 'distributor_submission_policy' }).lean();
  const policy = policyDoc?.value || {
    allowDistributorSupportingDocs: true,
    requireNationalIdInDistributorSubmission: false,
  };

  if (files && files.length > 0 && !policy.allowDistributorSupportingDocs) {
    throw new AppError('رفع المستندات من المندوبين غير مفعل حالياً في إعدادات الإدارة', 403);
  }

  const conditions = parseConditionsInput(payload.conditions);
  if (conditions.length === 0) {
    throw new AppError('يجب اختيار حالة واحدة على الأقل للمستفيد', 400);
  }

  const requestType = payload.requestType;
  let targetBeneficiary = null;

  if (requestType === 'ADD_CASE_FOR_EXISTING') {
    if (payload.targetBeneficiaryId) {
      targetBeneficiary = await Beneficiary.findById(payload.targetBeneficiaryId).lean();
    } else if (payload.existingLookup) {
      const lookup = String(payload.existingLookup).trim();
      const cleanPhone = normalizeEgyptianPhone(lookup);
      targetBeneficiary = await Beneficiary.findOne({
        $or: [{ beneficiaryCode: lookup.toUpperCase() }, ...(cleanPhone ? [{ phone: cleanPhone }] : [])],
      }).lean();
    }
    if (!targetBeneficiary) {
      throw new AppError('المستفيد المسجل غير موجود لتقديم حالة جديدة له', 404);
    }
  }

  const fullName = (payload.fullName || targetBeneficiary?.fullName || '').trim();
  const rawPhone = payload.phone || targetBeneficiary?.phone;
  const cleanPhone = normalizeEgyptianPhone(rawPhone);
  if (!fullName || fullName.length < 2) {
    throw new AppError('الاسم الكامل للمستفيد مطلوب', 400);
  }
  if (!isValidEgyptianPhone(cleanPhone)) {
    throw new AppError('رقم الهاتف المصري غير صالح (11 رقماً يبدأ بـ 01)', 400);
  }

  let cleanAltPhone = '';
  if (payload.alternativePhone) {
    cleanAltPhone = normalizeEgyptianPhone(payload.alternativePhone);
    if (!isValidEgyptianPhone(cleanAltPhone)) {
      throw new AppError('رقم الهاتف البديل غير صالح', 400);
    }
  }

  let nidHash = undefined;
  let nidEncrypted = undefined;
  let nidLast4 = undefined;
  if (payload.nationalId) {
    const cleanNid = normalizeNationalId(payload.nationalId);
    if (!isValidEgyptianNationalId(cleanNid)) {
      throw new AppError('الرقم القومي يجب أن يتكون من 14 رقماً صحيحاً', 400);
    }
    nidHash = hashNationalId(cleanNid);
    nidEncrypted = encryptSensitiveField(cleanNid);
    nidLast4 = cleanNid.slice(-4);
  } else if (policy.requireNationalIdInDistributorSubmission && requestType === 'ADD_NEW_BENEFICIARY') {
    throw new AppError('الرقم القومي مطلوب وفق إعدادات الإدارة الحالية', 400);
  }

  const governorate = (payload.governorate || targetBeneficiary?.governorate || '').trim();
  const cityDistrict = (payload.cityDistrict || targetBeneficiary?.cityDistrict || '').trim();
  const detailedAddress = (payload.detailedAddress || targetBeneficiary?.address || '').trim();
  if (!governorate || !cityDistrict || !detailedAddress) {
    throw new AppError('المحافظة والمركز والعنوان التفصيلي مطلوبة', 400);
  }

  const fullNameNormalized = normalizeArabicText(fullName);
  const possibleDuplicates =
    requestType === 'ADD_NEW_BENEFICIARY'
      ? await detectPossibleDuplicates({
          nationalIdHash: nidHash,
          phone: cleanPhone,
          fullNameNormalized,
        })
      : [];

  const supportingDocuments = (files || []).map((f) => ({
    filename: f.filename,
    originalName: f.originalname,
    mimeType: f.mimetype,
    size: f.size,
  }));

  const members = parseMembersInput(payload.familyMembers);

  const reqDoc = await BeneficiaryRequest.create({
    requestNumber: generateReference('REQ'),
    requestType,
    targetBeneficiaryId: targetBeneficiary ? targetBeneficiary._id : null,
    targetFamilyId: targetBeneficiary ? targetBeneficiary.familyId : null,
    submittedBy: distributorUser.id,
    fullName,
    fullNameNormalized,
    phone: cleanPhone,
    alternativePhone: cleanAltPhone || undefined,
    nationalIdHash: nidHash,
    nationalIdEncrypted: nidEncrypted,
    nationalIdLast4: nidLast4,
    governorate,
    cityDistrict,
    village: (payload.village || targetBeneficiary?.village || '').trim(),
    detailedAddress,
    familyHeadName: (payload.familyHeadName || fullName).trim(),
    familySize: Math.max(1, Number(payload.familySize || 1)),
    familyMembers: members,
    socialCondition: (payload.socialCondition || targetBeneficiary?.socialStatus || 'يحتاج دراسة').trim(),
    economicCondition: (payload.economicCondition || targetBeneficiary?.economicSituation || 'دخل محدود').trim(),
    conditions,
    caseDescription: (payload.caseDescription || '').trim(),
    notes: (payload.notes || '').trim(),
    supportingDocuments,
    status: 'PENDING_REVIEW',
    possibleDuplicates,
  });

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: 'BENEFICIARY_REQUEST_SUBMITTED',
    entityType: 'BeneficiaryRequest',
    entityId: reqDoc._id,
    newValues: {
      requestNumber: reqDoc.requestNumber,
      requestType,
      fullName,
      conditions,
      status: 'PENDING_REVIEW',
      possibleDuplicatesCount: possibleDuplicates.length,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return formatRequestSummary(reqDoc, false);
}

async function listMyRequests(distributorUser, queryParams = {}) {
  const { page, limit, skip } = parsePagination(queryParams, { defaultLimit: 20, maxLimit: 50 });
  const filter = { submittedBy: distributorUser.id };
  if (queryParams.status) {
    filter.status = String(queryParams.status).toUpperCase();
  }

  const [total, rows] = await Promise.all([
    BeneficiaryRequest.countDocuments(filter),
    BeneficiaryRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);

  return {
    items: rows.map((r) => formatRequestSummary(r, false)),
    pagination: buildPaginationMeta(page, limit, total),
  };
}

async function getMyRequestById(requestId, distributorUser) {
  const doc = await BeneficiaryRequest.findById(requestId).lean();
  if (!doc) throw new AppError('الطلب غير موجود', 404);
  if (String(doc.submittedBy) !== String(distributorUser.id)) {
    throw new AppError('ليس لديك صلاحية الاطلاع على طلبات مندوبين آخرين', 403);
  }
  return formatRequestSummary(doc, false);
}

async function resubmitRequest(requestId, payload, files, distributorUser, meta = {}) {
  const doc = await BeneficiaryRequest.findById(requestId);
  if (!doc) throw new AppError('الطلب غير موجود', 404);
  if (String(doc.submittedBy) !== String(distributorUser.id)) {
    throw new AppError('ليس لديك صلاحية تعديل طلب لا يخصك', 403);
  }
  if (doc.status !== 'NEEDS_MORE_INFORMATION') {
    throw new AppError('لا يمكن إعادة التقديم إلا للطلبات التي طُلب لها استكمال بيانات', 400);
  }

  const updatedFields = [];
  if (payload.fullName) {
    doc.fullName = payload.fullName.trim();
    doc.fullNameNormalized = normalizeArabicText(doc.fullName);
    updatedFields.push('fullName');
  }
  if (payload.phone) {
    const cleanPhone = normalizeEgyptianPhone(payload.phone);
    if (!isValidEgyptianPhone(cleanPhone)) throw new AppError('رقم الهاتف غير صالح', 400);
    doc.phone = cleanPhone;
    updatedFields.push('phone');
  }
  for (const k of ['governorate', 'cityDistrict', 'village', 'detailedAddress', 'socialCondition', 'economicCondition', 'caseDescription', 'notes', 'familyHeadName']) {
    if (payload[k] !== undefined) {
      doc[k] = String(payload[k]).trim();
      updatedFields.push(k);
    }
  }
  if (payload.familySize !== undefined) {
    doc.familySize = Math.max(1, Number(payload.familySize));
    updatedFields.push('familySize');
  }
  if (payload.conditions !== undefined) {
    const parsedConds = parseConditionsInput(payload.conditions);
    if (parsedConds.length === 0) throw new AppError('يجب اختيار حالة واحدة على الأقل', 400);
    doc.conditions = parsedConds;
    updatedFields.push('conditions');
  }
  if (files && files.length > 0) {
    const added = files.map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    }));
    doc.supportingDocuments.push(...added);
    updatedFields.push('supportingDocuments');
  }

  doc.resubmissionHistory.push({
    resubmittedAt: new Date(),
    distributorNote: (payload.distributorNote || 'تم استكمال البيانات المطلوبة').trim(),
    updatedFields,
  });
  doc.status = 'PENDING_REVIEW';
  await doc.save();

  await recordAuditLog({
    userId: distributorUser.id,
    userRole: distributorUser.role,
    action: 'BENEFICIARY_REQUEST_RESUBMITTED',
    entityType: 'BeneficiaryRequest',
    entityId: doc._id,
    changedFields: updatedFields,
    newValues: { status: 'PENDING_REVIEW', updatedFields },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return formatRequestSummary(doc, false);
}

async function listAdminRequests(queryParams = {}) {
  const { page, limit, skip } = parsePagination(queryParams, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (queryParams.status) {
    filter.status = String(queryParams.status).toUpperCase();
  }
  if (queryParams.distributorId) {
    filter.submittedBy = queryParams.distributorId;
  }

  const [total, rows] = await Promise.all([
    BeneficiaryRequest.countDocuments(filter),
    BeneficiaryRequest.find(filter)
      .populate('submittedBy', 'name code phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    items: rows.map((r) => formatRequestSummary(r, true)),
    pagination: buildPaginationMeta(page, limit, total),
  };
}

async function getAdminRequestById(requestId) {
  const doc = await BeneficiaryRequest.findById(requestId)
    .populate('submittedBy', 'name code phone email')
    .populate('reviewedBy', 'name code')
    .lean();
  if (!doc) throw new AppError('الطلب غير موجود', 404);
  return formatRequestSummary(doc, true);
}

async function markRequestUnderReview(requestId, adminUser, meta = {}) {
  const doc = await BeneficiaryRequest.findById(requestId);
  if (!doc) throw new AppError('الطلب غير موجود', 404);
  if (doc.status === 'APPROVED' || doc.status === 'REJECTED') {
    throw new AppError('تم البت في هذا الطلب مسبقاً', 400);
  }
  const prev = doc.status;
  doc.status = 'UNDER_REVIEW';
  doc.reviewedBy = adminUser.id;
  await doc.save();

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'BENEFICIARY_REQUEST_UNDER_REVIEW',
    entityType: 'BeneficiaryRequest',
    entityId: doc._id,
    previousValues: { status: prev },
    newValues: { status: 'UNDER_REVIEW' },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return formatRequestSummary(doc, true);
}

async function requestMoreInfoOnSubmission(requestId, { requestedInfoNotes }, adminUser, meta = {}) {
  const doc = await BeneficiaryRequest.findById(requestId);
  if (!doc) throw new AppError('الطلب غير موجود', 404);
  if (doc.status === 'APPROVED' || doc.status === 'REJECTED') {
    throw new AppError('لا يمكن طلب استكمال بيانات لطلب منتهي', 400);
  }
  if (!requestedInfoNotes || !String(requestedInfoNotes).trim()) {
    throw new AppError('يرجى كتابة ملاحظات البيانات الإضافية المطلوبة', 400);
  }

  const prev = doc.status;
  doc.status = 'NEEDS_MORE_INFORMATION';
  doc.requestedInfoNotes = String(requestedInfoNotes).trim();
  doc.reviewedBy = adminUser.id;
  doc.reviewedAt = new Date();
  await doc.save();

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'BENEFICIARY_REQUEST_MORE_INFO',
    entityType: 'BeneficiaryRequest',
    entityId: doc._id,
    previousValues: { status: prev },
    newValues: { status: 'NEEDS_MORE_INFORMATION', requestedInfoNotes: doc.requestedInfoNotes },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return formatRequestSummary(doc, true);
}

async function rejectBeneficiaryRequest(requestId, { rejectionReason, reviewNotes }, adminUser, meta = {}) {
  const doc = await BeneficiaryRequest.findById(requestId);
  if (!doc) throw new AppError('الطلب غير موجود', 404);
  if (doc.status === 'APPROVED') {
    throw new AppError('لا يمكن رفض طلب تمت الموافقة عليه بالفعل', 400);
  }
  if (!rejectionReason || !String(rejectionReason).trim()) {
    throw new AppError('يرجى إدخال سبب الرفض', 400);
  }

  const prev = doc.status;
  doc.status = 'REJECTED';
  doc.rejectionReason = String(rejectionReason).trim();
  doc.reviewNotes = (reviewNotes || '').trim();
  doc.reviewedBy = adminUser.id;
  doc.reviewedAt = new Date();
  await doc.save();

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'BENEFICIARY_REQUEST_REJECTED',
    entityType: 'BeneficiaryRequest',
    entityId: doc._id,
    previousValues: { status: prev },
    newValues: { status: 'REJECTED', rejectionReason: doc.rejectionReason },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return formatRequestSummary(doc, true);
}

async function approveBeneficiaryRequest(requestId, adminEdits = {}, adminUser, meta = {}) {
  return withMongoTransaction(async (session) => {
    const doc = await BeneficiaryRequest.findById(requestId)
      .select('+nationalIdEncrypted')
      .session(session);
    if (!doc) throw new AppError('الطلب غير موجود', 404);
    if (doc.status === 'APPROVED') {
      throw new AppError('تمت الموافقة على هذا الطلب مسبقاً', 400);
    }
    if (doc.status === 'REJECTED') {
      throw new AppError('لا يمكن اعتماد طلب مرفوض تاريخياً', 400);
    }

    // Apply optional admin edits before activation
    if (adminEdits.fullName) {
      doc.fullName = adminEdits.fullName.trim();
      doc.fullNameNormalized = normalizeArabicText(doc.fullName);
    }
    if (adminEdits.phone) {
      const cleanPhone = normalizeEgyptianPhone(adminEdits.phone);
      if (!isValidEgyptianPhone(cleanPhone)) throw new AppError('رقم الهاتف غير صالح', 400);
      doc.phone = cleanPhone;
    }
    for (const k of ['governorate', 'cityDistrict', 'village', 'detailedAddress', 'socialCondition', 'economicCondition']) {
      if (adminEdits[k] !== undefined) doc[k] = String(adminEdits[k]).trim();
    }
    if (Array.isArray(adminEdits.conditions) && adminEdits.conditions.length > 0) {
      doc.conditions = adminEdits.conditions;
    }

    let beneficiary = null;

    if (doc.requestType === 'ADD_CASE_FOR_EXISTING' && doc.targetBeneficiaryId) {
      beneficiary = await Beneficiary.findById(doc.targetBeneficiaryId).session(session);
      if (!beneficiary) throw new AppError('المستفيد المرتبط بالطلب غير موجود', 404);

      const mergedConditions = [...new Set([...(beneficiary.conditions || []), ...(doc.conditions || [])])];
      beneficiary.conditions = mergedConditions;
      beneficiary.eligibilityStatus = 'APPROVED';
      beneficiary.reviewDate = new Date();
      beneficiary.reviewedBy = adminUser.id;
      await beneficiary.save({ session });

      for (const c of doc.conditions) {
        await BeneficiaryCase.updateOne(
          { beneficiaryId: beneficiary._id, caseType: c },
          {
            $set: {
              familyId: beneficiary.familyId,
              description: doc.caseDescription || '',
              eligibilityStatus: 'APPROVED',
              reviewerId: adminUser.id,
              reviewNotes: (adminEdits.reviewNotes || '').trim(),
              assessmentDate: new Date(),
              submittedBy: doc.submittedBy,
            },
          },
          { upsert: true, session }
        );
      }
    } else {
      // Check strict duplicate before creating new official Beneficiary
      if (doc.nationalIdHash) {
        const dup = await Beneficiary.findOne({ nationalIdHash: doc.nationalIdHash }).session(session);
        if (dup) {
          throw new AppError(
            `يوجد مستفيد مسجل مسبقاً بنفس الرقم القومي (${dup.fullName} - ${dup.beneficiaryCode}). لا يمكن إنشاء سجل مكرر.`,
            409
          );
        }
      }

      const familyCode = await generateNextFamilyCode();
      const beneficiaryCode = await generateNextBeneficiaryCode();
      const headName = (doc.familyHeadName || doc.fullName).trim();

      const [family] = await Family.create(
        [
          {
            familyCode,
            headName,
            headNameNormalized: normalizeArabicText(headName),
            nationalIdHash: doc.nationalIdHash || undefined,
            nationalIdEncrypted: doc.nationalIdEncrypted || undefined,
            nationalIdLast4: doc.nationalIdLast4 || undefined,
            primaryPhone: doc.phone,
            alternativePhone: doc.alternativePhone || undefined,
            governorate: doc.governorate,
            cityDistrict: doc.cityDistrict,
            village: doc.village || '',
            detailedAddress: doc.detailedAddress,
            membersCount: doc.familySize || 1,
            economicSituation: doc.economicCondition,
            socialStatus: doc.socialCondition,
            createdBy: adminUser.id,
          },
        ],
        { session }
      );

      if (doc.familyMembers && doc.familyMembers.length > 0) {
        await FamilyMember.create(
          doc.familyMembers.map((m) => ({
            familyId: family._id,
            fullName: m.fullName,
            fullNameNormalized: normalizeArabicText(m.fullName),
            relationship: m.relationship,
            ageOrBirthDate: m.ageOrBirthDate,
            notes: m.notes || '',
            createdBy: adminUser.id,
          })),
          { session, ordered: true }
        );
      }

      const [createdBeneficiary] = await Beneficiary.create(
        [
          {
            beneficiaryCode,
            familyId: family._id,
            fullName: doc.fullName,
            fullNameNormalized: doc.fullNameNormalized,
            isHeadOfFamily: headName === doc.fullName,
            nationalIdHash: doc.nationalIdHash || undefined,
            nationalIdEncrypted: doc.nationalIdEncrypted || undefined,
            nationalIdLast4: doc.nationalIdLast4 || undefined,
            phone: doc.phone,
            alternativePhone: doc.alternativePhone || undefined,
            governorate: doc.governorate,
            cityDistrict: doc.cityDistrict,
            village: doc.village || '',
            address: doc.detailedAddress,
            economicSituation: doc.economicCondition,
            socialStatus: doc.socialCondition,
            conditions: doc.conditions,
            eligibilityStatus: 'APPROVED',
            beneficiaryStatus: 'active',
            assessmentDate: new Date(),
            reviewDate: new Date(),
            reviewedBy: adminUser.id,
            decisionReason: (adminEdits.reviewNotes || 'اعتماد بعد مراجعة طلب المندوب').trim(),
            supportingDocuments: doc.supportingDocuments || [],
            createdBy: adminUser.id,
          },
        ],
        { session }
      );
      beneficiary = createdBeneficiary;

      if (doc.conditions && doc.conditions.length > 0) {
        await BeneficiaryCase.create(
          doc.conditions.map((c) => ({
            beneficiaryId: beneficiary._id,
            familyId: family._id,
            caseType: c,
            description: doc.caseDescription || '',
            supportingDocuments: doc.supportingDocuments || [],
            assessmentDate: new Date(),
            reviewerId: adminUser.id,
            reviewNotes: (adminEdits.reviewNotes || '').trim(),
            eligibilityStatus: 'APPROVED',
            submittedBy: doc.submittedBy,
          })),
          { session, ordered: true }
        );
      }
    }

    const prevStatus = doc.status;
    doc.status = 'APPROVED';
    doc.reviewedBy = adminUser.id;
    doc.reviewedAt = new Date();
    doc.reviewNotes = (adminEdits.reviewNotes || '').trim();
    doc.approvedBeneficiaryId = beneficiary._id;
    await doc.save({ session });

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'BENEFICIARY_REQUEST_APPROVED',
        entityType: 'BeneficiaryRequest',
        entityId: doc._id,
        previousValues: { status: prevStatus },
        newValues: {
          status: 'APPROVED',
          approvedBeneficiaryId: String(beneficiary._id),
          beneficiaryCode: beneficiary.beneficiaryCode,
          conditions: beneficiary.conditions,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return {
      request: formatRequestSummary(doc, true),
      beneficiary: {
        id: String(beneficiary._id),
        beneficiaryCode: beneficiary.beneficiaryCode,
        fullName: beneficiary.fullName,
        eligibilityStatus: beneficiary.eligibilityStatus,
        conditions: formatConditionsCompact(beneficiary.conditions),
      },
    };
  });
}

module.exports = {
  submitBeneficiaryRequest,
  listMyRequests,
  getMyRequestById,
  resubmitRequest,
  listAdminRequests,
  getAdminRequestById,
  markRequestUnderReview,
  requestMoreInfoOnSubmission,
  rejectBeneficiaryRequest,
  approveBeneficiaryRequest,
};
