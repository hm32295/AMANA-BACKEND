const mongoose = require('mongoose');
const {
  Family,
  FamilyMember,
  Beneficiary,
  BeneficiaryCase,
  AssignmentItem,
  VerificationRecord,
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
const { normalizeArabicText, buildArabicTokenRegexes } = require('../utils/arabicSearch');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { withMongoTransaction } = require('../utils/transactions');
const { AppError } = require('../utils/errors');
const { recordAuditLog } = require('./auditService');

async function generateNextFamilyCode() {
  const count = await Family.countDocuments();
  return `FAM-${String(count + 1).padStart(5, '0')}`;
}

async function generateNextBeneficiaryCode() {
  const count = await Beneficiary.countDocuments();
  let seq = count + 1;
  while (seq < count + 500) {
    const candidate = `BEN-${String(seq).padStart(5, '0')}`;
    const exists = await Beneficiary.exists({ beneficiaryCode: candidate });
    if (!exists) return candidate;
    seq += 1;
  }
  return generateReference('BEN');
}

function formatConditionsCompact(conditionKeys = []) {
  return (conditionKeys || []).map((key) => ({
    key,
    labelAr: getConditionLabelAr(key),
  }));
}

function formatBeneficiaryAdminView(doc, familyDoc = null) {
  return {
    id: String(doc._id),
    beneficiaryCode: doc.beneficiaryCode,
    familyId: String(doc.familyId?._id || doc.familyId),
    familyCode: familyDoc?.familyCode || doc.familyId?.familyCode || null,
    headName: familyDoc?.headName || doc.familyId?.headName || doc.fullName,
    fullName: doc.fullName,
    isHeadOfFamily: doc.isHeadOfFamily,
    phone: doc.phone,
    maskedPhone: maskPhone(doc.phone),
    alternativePhone: doc.alternativePhone || '',
    maskedNationalId: maskNationalIdLast4(doc.nationalIdLast4),
    nationalIdLast4: doc.nationalIdLast4 || '',
    governorate: doc.governorate,
    cityDistrict: doc.cityDistrict,
    village: doc.village || '',
    address: doc.address,
    economicSituation: doc.economicSituation,
    socialStatus: doc.socialStatus,
    conditions: formatConditionsCompact(doc.conditions),
    eligibilityStatus: doc.eligibilityStatus,
    beneficiaryStatus: doc.beneficiaryStatus,
    decisionReason: doc.decisionReason || '',
    assessmentDate: doc.assessmentDate,
    reviewDate: doc.reviewDate,
    reassessmentDate: doc.reassessmentDate,
    supportingDocuments: doc.supportingDocuments || [],
    registrationDate: doc.registrationDate || doc.createdAt,
    createdAt: doc.createdAt,
  };
}

async function createFamilyAndBeneficiary(payload, adminUser, meta = {}) {
  const cleanPhone = normalizeEgyptianPhone(payload.primaryPhone || payload.phone);
  if (!isValidEgyptianPhone(cleanPhone)) {
    throw new AppError('يرجى إدخال رقم هاتف مصري صحيح (11 رقماً يبدأ بـ 01)', 400);
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
    const existingNid = await Beneficiary.exists({ nationalIdHash: nidHash });
    if (existingNid) {
      throw new AppError('يوجد مستفيد مسجل مسبقاً بنفس الرقم القومي', 409);
    }
    nidEncrypted = encryptSensitiveField(cleanNid);
    nidLast4 = cleanNid.slice(-4);
  }

  const conditions = Array.isArray(payload.conditions) ? payload.conditions : [];
  const headName = (payload.headName || payload.fullName || '').trim();
  const fullName = (payload.fullName || payload.headName || '').trim();

  if (!headName || !fullName) {
    throw new AppError('اسم المستفيد واسم رب الأسرة مطلوبان', 400);
  }

  return withMongoTransaction(async (session) => {
    const familyCode = await generateNextFamilyCode();
    const beneficiaryCode = await generateNextBeneficiaryCode();

    const [family] = await Family.create(
      [
        {
          familyCode,
          headName,
          headNameNormalized: normalizeArabicText(headName),
          nationalIdHash: nidHash,
          nationalIdEncrypted: nidEncrypted,
          nationalIdLast4: nidLast4,
          primaryPhone: cleanPhone,
          alternativePhone: cleanAltPhone || undefined,
          governorate: payload.governorate.trim(),
          cityDistrict: payload.cityDistrict.trim(),
          village: (payload.village || '').trim(),
          detailedAddress: (payload.detailedAddress || payload.address || '').trim(),
          membersCount: Number(payload.membersCount || 1),
          economicSituation: (payload.economicSituation || 'دخل محدود').trim(),
          socialStatus: (payload.socialStatus || payload.maritalStatus || 'غير محدد').trim(),
          housingInfo: (payload.housingInfo || '').trim(),
          internalNotes: (payload.adminPrivateNotes || '').trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    const eligibilityStatus = payload.eligibilityStatus || 'PENDING_REVIEW';

    const [beneficiary] = await Beneficiary.create(
      [
        {
          beneficiaryCode,
          familyId: family._id,
          fullName,
          fullNameNormalized: normalizeArabicText(fullName),
          isHeadOfFamily: payload.isHeadOfFamily !== false,
          nationalIdHash: nidHash,
          nationalIdEncrypted: nidEncrypted,
          nationalIdLast4: nidLast4,
          phone: cleanPhone,
          alternativePhone: cleanAltPhone || undefined,
          governorate: payload.governorate.trim(),
          cityDistrict: payload.cityDistrict.trim(),
          village: (payload.village || '').trim(),
          address: (payload.detailedAddress || payload.address || '').trim(),
          economicSituation: (payload.economicSituation || 'دخل محدود').trim(),
          socialStatus: (payload.socialStatus || payload.maritalStatus || 'غير محدد').trim(),
          conditions,
          eligibilityStatus,
          reviewDate: eligibilityStatus !== 'PENDING_REVIEW' ? new Date() : undefined,
          reviewedBy: eligibilityStatus !== 'PENDING_REVIEW' ? adminUser.id : undefined,
          decisionReason: (payload.decisionReason || '').trim(),
          internalNotes: (payload.adminPrivateNotes || '').trim(),
          createdBy: adminUser.id,
        },
      ],
      { session }
    );

    if (Array.isArray(payload.members) && payload.members.length > 0) {
      const memberDocs = payload.members.map((m) => ({
        familyId: family._id,
        fullName: m.fullName.trim(),
        fullNameNormalized: normalizeArabicText(m.fullName),
        relationship: m.relationship.trim(),
        ageOrBirthDate: String(m.ageOrBirthDate || '').trim(),
        gender: m.gender || 'unspecified',
        assistanceInfo: m.assistanceInfo || '',
        notes: m.notes || '',
        createdBy: adminUser.id,
      }));
      await FamilyMember.create(memberDocs, { session, ordered: true });
    }

    if (conditions.length > 0) {
      const caseDocs = conditions.map((c) => ({
        beneficiaryId: beneficiary._id,
        familyId: family._id,
        caseType: c,
        description: (payload.caseDescription || '').trim(),
        eligibilityStatus,
        reviewerId: eligibilityStatus !== 'PENDING_REVIEW' ? adminUser.id : undefined,
        submittedBy: adminUser.id,
      }));
      await BeneficiaryCase.create(caseDocs, { session, ordered: true });
    }

    await recordAuditLog(
      {
        userId: adminUser.id,
        userRole: adminUser.role,
        action: 'BENEFICIARY_CREATED',
        entityType: 'Beneficiary',
        entityId: beneficiary._id,
        newValues: {
          beneficiaryCode,
          familyCode,
          fullName,
          phone: cleanPhone,
          eligibilityStatus,
          conditions,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      session
    );

    return formatBeneficiaryAdminView(beneficiary, family);
  });
}

/**
 * Manual Beneficiary Search.
 * STRICT PRIVACY RULE:
 * Returns ONLY { id, fullName, conditions } so no extra personal data
 * (code, phone, national ID, address, family members, notes, financial history)
 * is exposed in search results.
 */
async function searchBeneficiaries(queryParams, currentUser) {
  const q = String(queryParams.q || '').trim();
  const { page, limit, skip } = parsePagination(queryParams, { defaultLimit: 20, maxLimit: 50 });

  if (!q) {
    return {
      items: [],
      pagination: buildPaginationMeta(page, limit, 0),
    };
  }

  const filter = {
    beneficiaryStatus: 'active',
  };

  // Distributors can ONLY search approved beneficiaries currently assigned to them
  if (currentUser.role === 'distributor') {
    const activeItems = await AssignmentItem.find({
      distributorId: new mongoose.Types.ObjectId(currentUser.id),
      status: { $in: ['assigned', 'in_progress'] },
    })
      .select('beneficiaryId')
      .lean();

    const allowedIds = [...new Set(activeItems.map((item) => String(item.beneficiaryId)))].map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    if (allowedIds.length === 0) {
      return {
        items: [],
        pagination: buildPaginationMeta(page, limit, 0),
      };
    }

    filter._id = { $in: allowedIds };
    filter.eligibilityStatus = 'APPROVED';
  } else {
    if (queryParams.eligibilityStatus) {
      filter.eligibilityStatus = String(queryParams.eligibilityStatus).toUpperCase();
    }
    if (queryParams.onlyApproved === 'true') {
      filter.eligibilityStatus = 'APPROVED';
    }
  }

  const tokenRegexes = buildArabicTokenRegexes(q);
  if (tokenRegexes.length > 0) {
    if (currentUser.role === 'admin') {
      // Admin search can also match beneficiaryCode or phone via admin criteria,
      // while still supporting multi-token Arabic partial name matching
      filter.$and = tokenRegexes.map((rx) => ({
        $or: [
          { fullName: rx },
          { fullNameNormalized: rx },
          { beneficiaryCode: rx },
          { phone: rx },
        ],
      }));
    } else {
      // Distributor manual search searches strictly by beneficiary name (or partial Arabic tokens)
      filter.$and = tokenRegexes.map((rx) => ({
        $or: [{ fullName: rx }, { fullNameNormalized: rx }],
      }));
    }
  }

  const [total, rows] = await Promise.all([
    Beneficiary.countDocuments(filter),
    Beneficiary.find(filter)
      .select('_id fullName conditions')
      .sort({ fullName: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const items = rows.map((row) => ({
    id: String(row._id),
    fullName: row.fullName,
    conditions: formatConditionsCompact(row.conditions),
  }));

  return {
    items,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

async function listBeneficiariesAdmin(queryParams) {
  const { page, limit, skip, sortSpec } = parsePagination(queryParams, {
    defaultLimit: 20,
    maxLimit: 100,
    allowedSortFields: ['createdAt', 'fullName', 'eligibilityStatus', 'governorate'],
    defaultSortBy: 'createdAt',
  });

  const filter = {};
  if (queryParams.eligibilityStatus) {
    filter.eligibilityStatus = String(queryParams.eligibilityStatus).toUpperCase();
  }
  if (queryParams.governorate) {
    filter.governorate = String(queryParams.governorate).trim();
  }
  if (queryParams.condition) {
    filter.conditions = String(queryParams.condition).trim();
  }
  if (queryParams.q) {
    const tokenRegexes = buildArabicTokenRegexes(queryParams.q);
    if (tokenRegexes.length > 0) {
      const familyMatchClauses = tokenRegexes.map((rx) => ({
        $or: [{ familyCode: rx }, { headName: rx }, { headNameNormalized: rx }],
      }));
      const matchedFamilies = await Family.find({ $and: familyMatchClauses })
        .select('_id')
        .limit(100)
        .lean();
      const matchedFamilyIds = matchedFamilies.map((f) => f._id);

      filter.$and = tokenRegexes.map((rx) => ({
        $or: [
          { fullName: rx },
          { fullNameNormalized: rx },
          { beneficiaryCode: rx },
          { phone: rx },
          ...(matchedFamilyIds.length > 0 ? [{ familyId: { $in: matchedFamilyIds } }] : []),
        ],
      }));
    }
  }

  const [total, docs] = await Promise.all([
    Beneficiary.countDocuments(filter),
    Beneficiary.find(filter)
      .populate('familyId', 'familyCode headName membersCount')
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    items: docs.map((d) => formatBeneficiaryAdminView(d)),
    pagination: buildPaginationMeta(page, limit, total),
  };
}

async function getBeneficiaryDetailsAdmin(beneficiaryId) {
  const doc = await Beneficiary.findById(beneficiaryId)
    .populate('familyId')
    .select('+internalNotes')
    .lean();
  if (!doc) throw new AppError('المستفيد غير موجود', 404);

  const [members, cases] = await Promise.all([
    FamilyMember.find({ familyId: doc.familyId._id || doc.familyId }).sort({ createdAt: 1 }).lean(),
    BeneficiaryCase.find({ beneficiaryId: doc._id }).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    ...formatBeneficiaryAdminView(doc),
    adminPrivateNotes: doc.internalNotes || '',
    family: doc.familyId
      ? {
          id: String(doc.familyId._id),
          familyCode: doc.familyId.familyCode,
          headName: doc.familyId.headName,
          membersCount: doc.familyId.membersCount,
          housingInfo: doc.familyId.housingInfo || '',
          detailedAddress: doc.familyId.detailedAddress,
          fileStatus: doc.familyId.fileStatus,
        }
      : null,
    familyMembers: members.map((m) => ({
      id: String(m._id),
      fullName: m.fullName,
      relationship: m.relationship,
      ageOrBirthDate: m.ageOrBirthDate,
      gender: m.gender,
      assistanceInfo: m.assistanceInfo || '',
      memberStatus: m.memberStatus,
      removedAt: m.removedAt || null,
      removalReason: m.removalReason || '',
      notes: m.notes || '',
    })),
    cases: cases.map((c) => ({
      id: String(c._id),
      caseType: c.caseType,
      caseLabelAr: getConditionLabelAr(c.caseType),
      description: c.description || '',
      eligibilityStatus: c.eligibilityStatus,
      decisionReason: c.decisionReason || '',
      reviewNotes: c.reviewNotes || '',
      assessmentDate: c.assessmentDate,
      reassessmentDate: c.reassessmentDate,
    })),
  };
}

async function updateBeneficiaryAdmin(beneficiaryId, updates, adminUser, meta = {}) {
  const doc = await Beneficiary.findById(beneficiaryId).select('+internalNotes');
  if (!doc) throw new AppError('المستفيد غير موجود', 404);

  const family = await Family.findById(doc.familyId);
  const previousValues = {
    fullName: doc.fullName,
    phone: doc.phone,
    alternativePhone: doc.alternativePhone || '',
    governorate: doc.governorate,
    cityDistrict: doc.cityDistrict,
    address: doc.address,
    conditions: doc.conditions,
    eligibilityStatus: doc.eligibilityStatus,
    beneficiaryStatus: doc.beneficiaryStatus,
  };

  const changedFields = [];
  if (updates.fullName && updates.fullName.trim() !== doc.fullName) {
    doc.fullName = updates.fullName.trim();
    doc.fullNameNormalized = normalizeArabicText(doc.fullName);
    changedFields.push('fullName');
  }

  let phoneChanged = false;
  if (updates.phone) {
    const cleanPhone = normalizeEgyptianPhone(updates.phone);
    if (!isValidEgyptianPhone(cleanPhone)) {
      throw new AppError('رقم الهاتف المصري غير صالح', 400);
    }
    if (cleanPhone !== doc.phone) {
      doc.phone = cleanPhone;
      if (family) family.primaryPhone = cleanPhone;
      phoneChanged = true;
      changedFields.push('phone');
    }
  }

  if (updates.alternativePhone !== undefined) {
    const cleanAlt = updates.alternativePhone ? normalizeEgyptianPhone(updates.alternativePhone) : '';
    if (cleanAlt && !isValidEgyptianPhone(cleanAlt)) {
      throw new AppError('رقم الهاتف البديل غير صالح', 400);
    }
    doc.alternativePhone = cleanAlt || undefined;
    if (family) family.alternativePhone = cleanAlt || undefined;
    changedFields.push('alternativePhone');
  }

  if (updates.nationalId) {
    const cleanNid = normalizeNationalId(updates.nationalId);
    if (!isValidEgyptianNationalId(cleanNid)) {
      throw new AppError('الرقم القومي يجب أن يتكون من 14 رقماً صحيحاً', 400);
    }
    const newHash = hashNationalId(cleanNid);
    const conflict = await Beneficiary.exists({ nationalIdHash: newHash, _id: { $ne: doc._id } });
    if (conflict) {
      throw new AppError('الرقم القومي مسجل لمستفيد آخر', 409);
    }
    doc.nationalIdHash = newHash;
    doc.nationalIdEncrypted = encryptSensitiveField(cleanNid);
    doc.nationalIdLast4 = cleanNid.slice(-4);
    changedFields.push('nationalId');
  }

  for (const field of ['governorate', 'cityDistrict', 'village', 'address', 'economicSituation', 'socialStatus']) {
    if (updates[field] !== undefined && String(updates[field]).trim() !== String(doc[field] || '')) {
      doc[field] = String(updates[field]).trim();
      changedFields.push(field);
    }
  }

  if (Array.isArray(updates.conditions) && updates.conditions.length > 0) {
    doc.conditions = updates.conditions;
    changedFields.push('conditions');
  }

  if (updates.beneficiaryStatus) {
    doc.beneficiaryStatus = updates.beneficiaryStatus;
    changedFields.push('beneficiaryStatus');
  }

  if (updates.adminPrivateNotes !== undefined) {
    doc.internalNotes = String(updates.adminPrivateNotes || '').trim();
    changedFields.push('adminPrivateNotes');
  }

  await doc.save();
  if (family) {
    if (updates.headName) {
      family.headName = updates.headName.trim();
      family.headNameNormalized = normalizeArabicText(family.headName);
    }
    if (updates.membersCount !== undefined) family.membersCount = Number(updates.membersCount);
    if (updates.address !== undefined) family.detailedAddress = doc.address;
    if (updates.governorate !== undefined) family.governorate = doc.governorate;
    if (updates.cityDistrict !== undefined) family.cityDistrict = doc.cityDistrict;
    await family.save();
  }

  // Note: Active pending OTP sessions retain their snapshotted targetPhone by design.
  const activeOtpCount = phoneChanged
    ? await VerificationRecord.countDocuments({
        beneficiaryId: doc._id,
        method: 'OTP',
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
    : 0;

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: phoneChanged ? 'BENEFICIARY_PHONE_UPDATED' : 'BENEFICIARY_UPDATED',
    entityType: 'Beneficiary',
    entityId: doc._id,
    changedFields,
    previousValues,
    newValues: {
      fullName: doc.fullName,
      phone: doc.phone,
      alternativePhone: doc.alternativePhone || '',
      governorate: doc.governorate,
      cityDistrict: doc.cityDistrict,
      address: doc.address,
      conditions: doc.conditions,
      beneficiaryStatus: doc.beneficiaryStatus,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    beneficiary: formatBeneficiaryAdminView(doc, family),
    activeOtpSessionsPreserved: activeOtpCount,
  };
}

async function reviewBeneficiaryEligibility(beneficiaryId, { eligibilityStatus, decisionReason }, adminUser, meta = {}) {
  const doc = await Beneficiary.findById(beneficiaryId);
  if (!doc) throw new AppError('المستفيد غير موجود', 404);

  const prev = doc.eligibilityStatus;
  doc.eligibilityStatus = eligibilityStatus;
  doc.decisionReason = (decisionReason || '').trim();
  doc.reviewDate = new Date();
  doc.reviewedBy = adminUser.id;
  await doc.save();

  await BeneficiaryCase.updateMany(
    { beneficiaryId: doc._id },
    {
      $set: {
        eligibilityStatus,
        decisionReason: doc.decisionReason,
        reviewerId: adminUser.id,
      },
    }
  );

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'BENEFICIARY_ELIGIBILITY_REVIEWED',
    entityType: 'Beneficiary',
    entityId: doc._id,
    changedFields: ['eligibilityStatus', 'decisionReason'],
    previousValues: { eligibilityStatus: prev },
    newValues: { eligibilityStatus, decisionReason: doc.decisionReason },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return formatBeneficiaryAdminView(doc);
}

async function addFamilyMember(familyId, payload, adminUser, meta = {}) {
  const family = await Family.findById(familyId);
  if (!family) throw new AppError('الأسرة غير موجودة', 404);

  const member = await FamilyMember.create({
    familyId: family._id,
    fullName: payload.fullName.trim(),
    fullNameNormalized: normalizeArabicText(payload.fullName),
    relationship: payload.relationship.trim(),
    ageOrBirthDate: String(payload.ageOrBirthDate || '').trim(),
    gender: payload.gender || 'unspecified',
    assistanceInfo: (payload.assistanceInfo || '').trim(),
    notes: (payload.notes || '').trim(),
    memberStatus: 'active',
    createdBy: adminUser.id,
  });

  family.membersCount = (await FamilyMember.countDocuments({ familyId: family._id, memberStatus: 'active' })) + 1;
  await family.save();

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'FAMILY_MEMBER_ADDED',
    entityType: 'Family',
    entityId: family._id,
    newValues: { fullName: member.fullName, relationship: member.relationship },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return member;
}

async function removeFamilyMemberHistorical(memberId, reason, adminUser, meta = {}) {
  const member = await FamilyMember.findById(memberId);
  if (!member) throw new AppError('فرد الأسرة غير موجود', 404);
  if (member.memberStatus === 'historical_removed') {
    throw new AppError('تم أرشفة سجل هذا الفرد مسبقاً', 400);
  }

  // Historical preservation: never delete financial or membership history; archive with reason
  member.memberStatus = 'historical_removed';
  member.removedAt = new Date();
  member.removedBy = adminUser.id;
  member.removalReason = (reason || 'تحديث تكوين الأسرة').trim();
  await member.save();

  const family = await Family.findById(member.familyId);
  if (family) {
    const activeMembers = await FamilyMember.countDocuments({
      familyId: family._id,
      memberStatus: 'active',
    });
    family.membersCount = Math.max(1, activeMembers + 1);
    await family.save();
  }

  await recordAuditLog({
    userId: adminUser.id,
    userRole: adminUser.role,
    action: 'FAMILY_MEMBER_ARCHIVED',
    entityType: 'FamilyMember',
    entityId: member._id,
    previousValues: { memberStatus: 'active' },
    newValues: { memberStatus: 'historical_removed', removalReason: member.removalReason },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return member;
}

module.exports = {
  formatConditionsCompact,
  formatBeneficiaryAdminView,
  generateNextFamilyCode,
  generateNextBeneficiaryCode,
  createFamilyAndBeneficiary,
  searchBeneficiaries,
  listBeneficiariesAdmin,
  getBeneficiaryDetailsAdmin,
  updateBeneficiaryAdmin,
  reviewBeneficiaryEligibility,
  addFamilyMember,
  removeFamilyMemberHistorical,
};
