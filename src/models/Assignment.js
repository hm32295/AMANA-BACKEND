const mongoose = require('mongoose');
const { ASSIGNMENT_STATUSES, VERIFICATION_MODES } = require('../constants/amana');

const assignmentSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    assistanceType: { type: String, required: true, index: true },
    assignmentDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    verificationMethodOverride: { type: String, enum: [null, ...VERIFICATION_MODES], default: null },
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'assigned', index: true },
    notes: { type: String, trim: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

assignmentSchema.index({ distributorId: 1, status: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
