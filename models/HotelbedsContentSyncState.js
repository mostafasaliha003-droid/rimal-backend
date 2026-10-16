const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

const schema = new mongoose.Schema({
    _id: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    environment: { type: String, required: true, enum: ['test'] },
    accountFingerprint: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    hotelCodes: { type: [Number], required: true, validate: value => Array.isArray(value) && value.length > 0 && value.length <= 5 },
    language: { type: String, required: true, uppercase: true, match: /^[A-Z]{2,12}$/ },
    resourceVersion: { type: String, required: true, enum: ['hotels-categories-v1'] },
    initialized: { type: Boolean, required: true, default: false },
    lastSuccessfulDate: { type: String, validate: value => {
        if (value === undefined) return true;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    } },
    lastRunAt: Date
}, {
    collection: 'hotelbedscontentsyncstate',
    versionKey: false,
    bufferCommands: false,
    strict: 'throw'
});

module.exports = hotelbedsMockDatabase.model('HotelbedsContentSyncState', schema);