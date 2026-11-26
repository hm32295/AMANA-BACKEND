const mongoose = require('mongoose');
const { CAMPAIGN_STATUSES, VERIFICATION_MODES } = require('../constants/amana');

const campaignSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assistanceType: { type: String, required: true, trim: true },
    allowedDonationCategories: { type: [String], required: true, default: [] },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'active', index: true },
    targetAmount: { type: Number, default: 0, min: 0 },
    verificationMethodOverride: { type: String, enum: [null, ...VERIFICATION_MODES], default: null },
    requireApprovalWhenUnverified: { type: Boolean, default: null },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Campaign', campaignSchema);
