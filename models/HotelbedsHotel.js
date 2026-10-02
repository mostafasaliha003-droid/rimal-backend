const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

const hotelbedsCategorySchema = new mongoose.Schema({
    code: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, required: true }
}, { _id: false, strict: 'throw' });

const hotelbedsImageTypeSchema = new mongoose.Schema({
    code: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' }
}, { _id: false, strict: 'throw' });

const hotelbedsImageSchema = new mongoose.Schema({
    path: { type: String, required: true, trim: true, maxlength: 500 },
    visualOrder: { type: Number, default: null },
    order: { type: Number, default: null },
    type: { type: hotelbedsImageTypeSchema, default: () => ({}) },
    roomCode: { type: String, trim: true, default: '' },
    roomType: { type: String, trim: true, default: '' },
    characteristicCode: { type: String, trim: true, default: '' }
}, { _id: false, strict: 'throw' });

const hotelbedsFacilitySchema = new mongoose.Schema({
    facilityCode: { type: Number, required: true, min: 1 },
    facilityGroupCode: { type: Number, required: true, min: 1 },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    order: { type: Number, default: null },
    indFee: { type: Boolean, default: null },
    indYesOrNo: { type: Boolean, default: null },
    indLogic: { type: Boolean, default: null },
    amount: { type: Number, default: null },
    currency: { type: String, trim: true, default: '' },
    number: { type: Number, default: null },
    voucher: { type: Boolean, default: null },
    applicationType: { type: String, trim: true, default: '' }
}, { _id: false, strict: 'throw' });

// This collection is intentionally separate from RateHawk and canonical hotels.
const hotelbedsHotelSchema = new mongoose.Schema({
    hotelCode: { type: Number, required: true, min: 1 },
    language: { type: String, required: true, uppercase: true, match: /^[A-Z]{2,12}$/ },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: hotelbedsCategorySchema, required: true },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    // Voucher generation intentionally requires a phone even though supplier
    // static-content records may omit one.
    phone: { type: String, required: true, trim: true, maxlength: 80 },
    images: { type: [hotelbedsImageSchema], default: [] },
    facilities: { type: [hotelbedsFacilitySchema], default: [] },
    contentStatus: { type: String, enum: ['complete', 'partial'], default: 'partial' },
    sourceUpdatedAt: Date,
    syncedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, bufferCommands: false, strict: 'throw' });

hotelbedsHotelSchema.index({ hotelCode: 1, language: 1 }, { unique: true });

module.exports = hotelbedsMockDatabase.model('HotelbedsHotel', hotelbedsHotelSchema);