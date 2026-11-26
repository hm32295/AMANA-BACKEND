const mongoose = require('mongoose');
const { DISBURSEMENT_STATUSES, VERIFICATION_MODES } = require('../constants/amana');

const disbursementSourceSchema = new mongoose.Schema(
  {
    donationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation', required: true },
    campaignFundingId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignFunding' },
    assistanceType: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
  },
  { _id: false }
);

const disbursementSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
    assignmentItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'AssignmentItem', required: true, index: true },
    allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Allocation', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assistanceType: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    sourceBreakdown: { type: [disbursementSourceSchema], default: [] },
    verificationMethod: { type: String, enum: VERIFICATION_MODES, default: 'OTP' },
    verificationPolicyReason: { type: String },
    status: { type: String, enum: DISBURSEMENT_STATUSES, default: 'PENDING', index: true },
    approvalDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvalDecisionAt: { type: Date },
    approvalDecisionReason: { type: String },
    exceptionReason: { type: String },
    exceptionNotes: { type: String },
    exceptionApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    exceptionApprovedAt: { type: Date },
    failureReason: { type: String },
    failureNotes: { type: String },
    handoverConfirmedAt: { type: Date },
    reversedAt: { type: Date },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reversalReason: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Receipt' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

disbursementSchema.index({ status: 1, assistanceType: 1, distributorId: 1, campaignId: 1, createdAt: -1 });
disbursementSchema.index({ beneficiaryId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Disbursement', disbursementSchema);
