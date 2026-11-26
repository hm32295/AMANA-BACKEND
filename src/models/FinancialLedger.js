const mongoose = require('mongoose');
const { LEDGER_TYPES } = require('../constants/amana');

const financialLedgerSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: LEDGER_TYPES, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'EGP' },
    assistanceType: { type: String, index: true },
    donationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation' },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
    allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Allocation' },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', index: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    disbursementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Disbursement' },
    custodyTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustodyTransaction' },
    sourceBreakdown: {
      type: [
        {
          donationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation' },
          assistanceType: String,
          amount: Number,
        },
      ],
      default: [],
    },
    relatedReference: { type: String },
    description: { type: String },
    reason: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

financialLedgerSchema.index({ type: 1, createdAt: -1 });
financialLedgerSchema.index({ assistanceType: 1, type: 1, createdAt: -1 });
financialLedgerSchema.index({ distributorId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('FinancialLedger', financialLedgerSchema);
