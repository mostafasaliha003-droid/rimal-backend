const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

// Static Hotelbeds content is stored independently from canonical hotel records.
const hotelbedsHotelContentSchema = new mongoose.Schema({
    hotelCode: { type: Number, required: true },
    language: { type: String, required: true },
    source: { type: String, enum: ['hotelbeds_content_api', 'mock_fixture'], required: true, default: 'mock_fixture' },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    sourceUpdatedAt: Date,
    syncedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, bufferCommands: false });

hotelbedsHotelContentSchema.index({ hotelCode: 1, language: 1, source: 1 }, { unique: true });

module.exports = hotelbedsMockDatabase.model('HotelbedsHotelContent', hotelbedsHotelContentSchema);