const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

const schema = new mongoose.Schema({
    _id: { type: String, required: true, enum: ['hotelbeds-content-writer:test'] },
    leaseId: { type: String, match: /^[a-f\d-]{36}$/i },
    leaseUntil: Date,
    scopeKey: { type: String, match: /^[a-f\d]{64}$/i },
    accountFingerprint: { type: String, match: /^[a-f\d]{64}$/i },
    fencingToken: { type: Number, required: true, min: 0, default: 0 }
}, {
    collection: 'hotelbedscontentsyncleases',
    versionKey: false,
    bufferCommands: false,
    strict: 'throw'
});

module.exports = hotelbedsMockDatabase.model('HotelbedsContentSyncLease', schema);