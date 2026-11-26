const mongoose = require('mongoose');

const familySchema = new mongoose.Schema(
  {
    familyCode: { type: String, required: true, unique: true, index: true },
    headName: { type: String, required: true, trim: true, index: true },
    headNameNormalized: { type: String, required: true, index: true },
    nationalIdHash: { type: String, unique: true, sparse: true, index: true },
    nationalIdEncrypted: { type: String, select: false },
    nationalIdLast4: { type: String },
    primaryPhone: { type: String, required: true, trim: true, index: true },
    alternativePhone: { type: String, trim: true, index: true },
    governorate: { type: String, required: true, trim: true, index: true },
    cityDistrict: { type: String, required: true, trim: true },
    village: { type: String, trim: true },
    detailedAddress: { type: String, required: true, trim: true },
    membersCount: { type: Number, default: 1, min: 1 },
    economicSituation: { type: String, required: true, trim: true },
    socialStatus: { type: String, required: true, trim: true },
    housingInfo: { type: String, trim: true },
    fileStatus: { type: String, enum: ['active', 'archived', 'suspended'], default: 'active', index: true },
    internalNotes: { type: String, select: false },
    privacyConsentGiven: { type: Boolean, default: true },
    registrationDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

familySchema.index({ headNameNormalized: 1, primaryPhone: 1 });

module.exports = mongoose.model('Family', familySchema);
