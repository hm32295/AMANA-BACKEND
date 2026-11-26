const mongoose = require('mongoose');

const donationTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, trim: true },
    description: { type: String, trim: true },
    restrictedByDefault: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DonationType', donationTypeSchema);
