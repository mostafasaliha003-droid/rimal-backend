const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: String, payload: mongoose.Schema.Types.Mixed, expiresAt: Date
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.RatehawkReviewCache || mongoose.model('RatehawkReviewCache', schema);
