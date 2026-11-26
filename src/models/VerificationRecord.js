const mongoose = require('mongoose');

const verificationRecordSchema = new mongoose.Schema(
  {
    disbursementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Disbursement', required: true, index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['OTP', 'QR_CODE'], required: true },
    targetPhone: { type: String },
    otpSalt: { type: String, required: true, select: false },
    otpHash: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    resendCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'verified', 'expired', 'locked', 'superseded'],
      default: 'pending',
      index: true,
    },
    verifiedAt: { type: Date },
    smsProvider: { type: String, default: 'none' },
    smsGatewayConfigured: { type: Boolean, default: false },
    smsDeliveryStatus: { type: String, default: 'not_applicable' },
    smsProviderRef: { type: String },
  },
  { timestamps: true }
);

verificationRecordSchema.index({ disbursementId: 1, status: 1 });

module.exports = mongoose.model('VerificationRecord', verificationRecordSchema);
