const mongoose = require('mongoose');
const { ASSIGNMENT_STATUSES } = require('../constants/amana');

const assignmentItemSchema = new mongoose.Schema(
  {
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
    allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Allocation', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
    assistanceType: { type: String, required: true, index: true },
    approvedAmount: { type: Number, required: true, min: 0.01 },
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'assigned', index: true },
    instructions: { type: String, trim: true },
  },
  { timestamps: true }
);

assignmentItemSchema.index({ distributorId: 1, beneficiaryId: 1, status: 1 });
assignmentItemSchema.index({ allocationId: 1, status: 1 });

module.exports = mongoose.model('AssignmentItem', assignmentItemSchema);
