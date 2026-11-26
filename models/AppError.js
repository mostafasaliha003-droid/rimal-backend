const mongoose = require('mongoose');

// App crashes and errors, grouped by fingerprint and app version. No personal data; kept 30 days.
const appErrorSchema = new mongoose.Schema({
    _id: String,
    fingerprint: { type: String, required: true },
    version: String, platform: String, route: String, fatal: Boolean,
    message: String, stack: String,
    count: { type: Number, default: 0 },
    firstSeen: Date, lastSeen: { type: Date, index: true },
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }
}, { collection: 'apperrors', versionKey: false, bufferCommands: false });

module.exports = mongoose.models.AppError || mongoose.model('AppError', appErrorSchema);
