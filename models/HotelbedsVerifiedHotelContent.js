const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

const schema = new mongoose.Schema({
    hotelCode: { type: Number, required: true, min: 1 },
    language: { type: String, required: true, uppercase: true, match: /^[A-Z]{2,12}$/ },
    source: { type: String, enum: ['hotelbeds_content_api'], required: true },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    sourceUpdatedAt: Date,
    syncedAt: { type: Date, required: true }
}, {
    collection: 'hotelbedsverifiedcontent',
    timestamps: true,
    bufferCommands: false,
    strict: 'throw'
});

schema.index({ hotelCode: 1, language: 1 }, { unique: true });

module.exports = hotelbedsMockDatabase.model('HotelbedsVerifiedHotelContent', schema);