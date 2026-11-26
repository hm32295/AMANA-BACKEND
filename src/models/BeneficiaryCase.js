const mongoose = require('mongoose');
const { CONDITION_KEYS, ELIGIBILITY_STATUSES } = require('../constants/amana');

const beneficiaryCaseSchema = new mongoose.Schema(
  {
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    caseType: { type: String, enum: CONDITION_KEYS, required: true },
    description: { type: String, trim: true },
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
    assessmentDate: { type: Date },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNotes: { type: String, trim: true },
    eligibilityStatus: {
      type: String,
      enum: ELIGIBILITY_STATUSES,
      default: 'PENDING_REVIEW',
      index: true,
    },
    decisionReason: { type: String, trim: true },
    reassessmentDate: { type: Date },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

beneficiaryCaseSchema.index({ beneficiaryId: 1, caseType: 1 }, { unique: true });

module.exports = mongoose.model('BeneficiaryCase', beneficiaryCaseSchema);
