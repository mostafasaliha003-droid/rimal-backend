const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    cancellationFingerprint: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    promotionsFingerprint: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    rateCommentsFingerprint: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    rateCommentsResolved: { type: Boolean, required: true }
}, { _id: false, strict: 'throw' });