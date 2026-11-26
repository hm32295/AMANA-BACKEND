const mongoose = require('mongoose');

const deliveryAttemptSchema = new mongoose.Schema(
  {
    disbursementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Disbursement', index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
    assignmentItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'AssignmentItem', required: true, index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    attemptNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED'], required: true },
    failureReason: { type: String, trim: true },
    notes: { type: String, trim: true },
    attemptedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryAttempt', deliveryAttemptSchema);
