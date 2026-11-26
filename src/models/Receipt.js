const mongoose = require('mongoose');
const { VERIFICATION_MODES } = require('../constants/amana');

const receiptSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true, index: true },
    disbursementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Disbursement', required: true, unique: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    campaignName: { type: String, required: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    beneficiaryName: { type: String, required: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    distributorName: { type: String, required: true },
    assistanceType: { type: String, required: true },
    assistanceTypeLabelAr: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'EGP' },
    verificationMethod: { type: String, enum: VERIFICATION_MODES, required: true },
    transactionReference: { type: String, required: true, index: true },
    notes: { type: String, trim: true },
    issuedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Receipt', receiptSchema);
