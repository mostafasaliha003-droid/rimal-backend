const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

const commentSchema = new mongoose.Schema({
    dateStart: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dateEnd: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    description: { type: String, required: true, trim: true, maxlength: 2000 }
}, { _id: false, strict: 'throw' });

const commentByRateSchema = new mongoose.Schema({
    rateCodes: { type: String, required: true, trim: true, maxlength: 100 },
    comments: { type: [commentSchema], default: [] }
}, { _id: false, strict: 'throw' });

const schema = new mongoose.Schema({
    hotelCode: { type: Number, required: true, min: 1 },
    language: { type: String, required: true, uppercase: true, match: /^[A-Z]{2,12}$/ },
    source: { type: String, enum: ['hotelbeds_content_api', 'mock_fixture'], required: true },
    incoming: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, maxlength: 80 },
    rateCodes: { type: String, required: true, trim: true, maxlength: 100 },
    commentsByRates: { type: [commentByRateSchema], default: [] },
    issues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    facilities: { type: [mongoose.Schema.Types.Mixed], default: [] },
    syncedAt: { type: Date, required: true }
}, { timestamps: true, bufferCommands: false, strict: 'throw' });

schema.index({ hotelCode: 1, language: 1, incoming: 1, code: 1, rateCodes: 1, source: 1 }, { unique: true });

schema.statics.modelName = 'HotelbedsRateComment';
module.exports = hotelbedsMockDatabase.model('HotelbedsRateComment', schema);