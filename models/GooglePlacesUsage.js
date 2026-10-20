const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: String, count: { type: Number, default: 0 }, expiresAt: Date
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.GooglePlacesUsage || mongoose.model('GooglePlacesUsage', schema);
