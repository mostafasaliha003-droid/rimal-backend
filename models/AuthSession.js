const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true, select: false, match: /^[a-f\d]{64}$/i },
    subject: { type: String, required: true, immutable: true, maxlength: 254 },
    email: { type: String, required: true, immutable: true, lowercase: true, maxlength: 254 },
    role: { type: String, required: true, immutable: true, enum: ['user', 'admin'] },
    realm: { type: String, required: true, immutable: true, match: /^[a-z0-9:_-]{1,100}$/i },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null }
}, {
    collection: 'authsessions',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    bufferCommands: false,
    strict: 'throw'
});

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AuthSession || mongoose.model('AuthSession', authSessionSchema);