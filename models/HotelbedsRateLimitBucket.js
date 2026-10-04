const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

const hotelbedsRateLimitBucketSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    requests: { type: [Date], default: undefined },
    operationRequests: {
        type: [{ operation: { type: String, required: true }, at: { type: Date, required: true } }],
        default: undefined
    },
    expiresAt: { type: Date, required: true }
}, { versionKey: false, bufferCommands: false });

hotelbedsRateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = hotelbedsMockDatabase.model('HotelbedsRateLimitBucket', hotelbedsRateLimitBucketSchema);