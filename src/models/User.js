const mongoose = require('mongoose');
const { ROLES, USER_STATUSES } = require('../constants/amana');

const userSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, sparse: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: [ROLES.ADMIN, ROLES.DISTRIBUTOR], required: true, index: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', index: true },
    governorate: { type: String, trim: true },
    address: { type: String, trim: true },
    notes: { type: String, trim: true },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
