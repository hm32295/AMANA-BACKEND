const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'EGP' },
    donationTypeKey: { type: String, required: true, index: true },
    donationTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'DonationType' },
    donorName: { type: String, default: 'فاعل خير', trim: true },
    donorPhone: { type: String, trim: true },
    donationDate: { type: Date, required: true, index: true },
    paymentMethod: { type: String, required: true, trim: true },
    restrictedCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    restrictionsNote: { type: String, trim: true },
    description: { type: String, trim: true },
    supportingDocuments: {
      type: [
        {
          filename: String,
          originalName: String,
          mimeType: String,
          size: Number,
        },
      ],
      default: [],
    },
    status: { type: String, enum: ['completed', 'reversed'], default: 'completed', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

donationSchema.index({ donationTypeKey: 1, donationDate: -1 });

module.exports = mongoose.model('Donation', donationSchema);
