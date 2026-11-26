const mongoose = require('mongoose');
const { CUSTODY_TX_TYPES } = require('../constants/amana');

const custodyTransactionSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    distributorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
    assistanceType: { type: String, index: true },
    type: { type: String, enum: CUSTODY_TX_TYPES, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    reason: { type: String, trim: true },
    reconciliationRef: { type: String, trim: true },
    idempotencyKey: { type: String, unique: true, sparse: true },
    supportingDocument: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

custodyTransactionSchema.index({ distributorId: 1, campaignId: 1, assistanceType: 1, type: 1 });

module.exports = mongoose.model('CustodyTransaction', custodyTransactionSchema);
