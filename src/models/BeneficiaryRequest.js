const mongoose = require('mongoose');
const { CONDITION_KEYS, BENEFICIARY_REQUEST_STATUSES } = require('../constants/amana');

const beneficiaryRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, required: true, unique: true, index: true },
    requestType: {
      type: String,
      enum: ['ADD_NEW_BENEFICIARY', 'ADD_CASE_FOR_EXISTING'],
      required: true,
    },
    targetBeneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', default: null },
    targetFamilyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    fullNameNormalized: { type: String, required: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    alternativePhone: { type: String, trim: true },
    nationalIdHash: { type: String, index: true },
    nationalIdEncrypted: { type: String, select: false },
    nationalIdLast4: { type: String },
    governorate: { type: String, required: true, trim: true },
    cityDistrict: { type: String, required: true, trim: true },
    village: { type: String, trim: true },
    detailedAddress: { type: String, required: true, trim: true },
    familyHeadName: { type: String, trim: true },
    familySize: { type: Number, default: 1, min: 1 },
    familyMembers: {
      type: [
        {
          fullName: { type: String, required: true, trim: true },
          relationship: { type: String, required: true, trim: true },
          ageOrBirthDate: { type: String, required: true, trim: true },
          notes: { type: String, trim: true },
        },
      ],
      default: [],
    },
    socialCondition: { type: String, required: true, trim: true },
    economicCondition: { type: String, required: true, trim: true },
    conditions: {
      type: [{ type: String, enum: CONDITION_KEYS }],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'يجب اختيار حالة واحدة على الأقل للمستفيد',
      },
    },
    caseDescription: { type: String, trim: true },
    notes: { type: String, trim: true },
    supportingDocuments: {
      type: [
        {
          filename: String,
          originalName: String,
          mimeType: String,
          size: Number,
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: BENEFICIARY_REQUEST_STATUSES,
      default: 'PENDING_REVIEW',
      index: true,
    },
    possibleDuplicates: {
      type: [
        {
          beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary' },
          beneficiaryCode: String,
          fullName: String,
          matchReason: String,
        },
      ],
      default: [],
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    requestedInfoNotes: { type: String, trim: true },
    approvedBeneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary' },
    resubmissionHistory: {
      type: [
        {
          resubmittedAt: { type: Date, default: Date.now },
          distributorNote: String,
          updatedFields: [String],
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

beneficiaryRequestSchema.index({ submittedBy: 1, status: 1, createdAt: -1 });
beneficiaryRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('BeneficiaryRequest', beneficiaryRequestSchema);
