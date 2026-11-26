const mongoose = require('mongoose');

// Customer-service agents for Mkhadda Desk. The single administrator still signs in with the
// configured ADMIN_EMAIL / ADMIN_PASSWORD_HASH; agents never see costs or margins.
const staffAccountSchema = new mongoose.Schema({
    _id: { type: String, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, required: true, enum: ['agent'], default: 'agent' },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    createdBy: { type: String, maxlength: 254 },
    lastLoginAt: Date
}, { collection: 'staffaccounts', timestamps: true, versionKey: false, bufferCommands: false });

module.exports = mongoose.models.StaffAccount || mongoose.model('StaffAccount', staffAccountSchema);
