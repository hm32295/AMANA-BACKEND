const mongoose = require('mongoose');
const { CONDITION_KEYS, ELIGIBILITY_STATUSES } = require('../constants/amana');

const documentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const beneficiarySchema = new mongoose.Schema(
  {
    beneficiaryCode: { type: String, required: true, unique: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    fullName: { type: String, required: true, trim: true, index: true },
    fullNameNormalized: { type: String, required: true, index: true },
    isHeadOfFamily: { type: Boolean, default: true },
    nationalIdHash: { type: String, unique: true, sparse: true, index: true },
    nationalIdEncrypted: { type: String, select: false },
    nationalIdLast4: { type: String },
    phone: { type: String, required: true, trim: true, index: true },
    alternativePhone: { type: String, trim: true },
    governorate: { type: String, required: true, trim: true, index: true },
    cityDistrict: { type: String, required: true, trim: true },
    village: { type: String, trim: true },
    address: { type: String, required: true, trim: true },
    economicSituation: { type: String, required: true, trim: true },
    socialStatus: { type: String, required: true, trim: true },
    conditions: {
      type: [{ type: String, enum: CONDITION_KEYS }],
      default: [],
      index: true,
    },
    eligibilityStatus: {
      type: String,
      enum: ELIGIBILITY_STATUSES,
      default: 'PENDING_REVIEW',
      index: true,
    },
    beneficiaryStatus: {
      type: String,
      enum: ['active', 'archived', 'suspended'],
      default: 'active',
      index: true,
    },
    assessmentDate: { type: Date },
    reviewDate: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decisionReason: { type: String, trim: true },
    reassessmentDate: { type: Date },
    internalNotes: { type: String, select: false },
    supportingDocuments: { type: [documentSchema], default: [] },
    registrationDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

beneficiarySchema.index({ eligibilityStatus: 1, fullNameNormalized: 1 });
beneficiarySchema.index({ fullName: 'text', beneficiaryCode: 'text' });

module.exports = mongoose.model('Beneficiary', beneficiarySchema);
