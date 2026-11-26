const mongoose = require('mongoose');

const familyMemberSchema = new mongoose.Schema(
  {
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    fullName: { type: String, required: true, trim: true, index: true },
    fullNameNormalized: { type: String, required: true, index: true },
    relationship: { type: String, required: true, trim: true },
    ageOrBirthDate: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['male', 'female', 'unspecified'], default: 'unspecified' },
    assistanceInfo: { type: String, trim: true },
    memberStatus: { type: String, enum: ['active', 'historical_removed'], default: 'active', index: true },
    removedAt: { type: Date },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    removalReason: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

familyMemberSchema.index({ familyId: 1, memberStatus: 1 });

module.exports = mongoose.model('FamilyMember', familyMemberSchema);
