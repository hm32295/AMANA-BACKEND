const mongoose = require('mongoose');
const { ALLOCATION_STATUSES } = require('../constants/amana');

const sourceBreakdownSchema = new mongoose.Schema(
  {
    campaignFundingId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignFunding' },
    donationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation', required: true },
    assistanceType: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
  },
  { _id: false }
);

const allocationSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    assistanceType: { type: String, required: true, index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    allocatedAmount: { type: Number, required: true, min: 0.01 },
    distributedAmount: { type: Number, default: 0, min: 0 },
    allocationDate: { type: Date, default: Date.now },
    expirationDate: { type: Date },
    status: { type: String, enum: ALLOCATION_STATUSES, default: 'APPROVED', index: true },
    sourceBreakdown: { type: [sourceBreakdownSchema], default: [] },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

allocationSchema.index({ campaignId: 1, assistanceType: 1, status: 1 });

module.exports = mongoose.model('Allocation', allocationSchema);
