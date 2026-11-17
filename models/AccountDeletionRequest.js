const mongoose = require('mongoose');

// Intake only. No status in this model represents fulfilled deletion.
const schema = new mongoose.Schema({
    reference: { type: String, required: true, unique: true, immutable: true, match: /^del_[a-f0-9]{32}$/ },
    ownerSubject: { type: String, required: true, immutable: true, maxlength: 254 },
    realm: { type: String, required: true, immutable: true, match: /^[a-z0-9:_-]{1,100}$/i },
    status: { type: String, required: true, immutable: true, enum: ['requested'] },
    requestedAt: { type: Date, required: true, immutable: true }
}, { collection: 'accountdeletionrequests', versionKey: false, bufferCommands: false, strict: 'throw' });

schema.index({ ownerSubject: 1, realm: 1 }, { unique: true });
schema.index({ realm: 1, requestedAt: -1, reference: 1 });

module.exports = mongoose.models.AccountDeletionRequest || mongoose.model('AccountDeletionRequest', schema);
