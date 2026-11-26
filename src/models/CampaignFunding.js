const mongoose = require('mongoose');

const campaignFundingSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    donationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation', required: true, index: true },
    assistanceType: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

campaignFundingSchema.index({ campaignId: 1, assistanceType: 1 });

module.exports = mongoose.model('CampaignFunding', campaignFundingSchema);
