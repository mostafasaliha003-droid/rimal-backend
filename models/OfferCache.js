const mongoose = require('mongoose');
const HotelbedsRateIdentity = require('./HotelbedsRateIdentity');
const HotelbedsRateTerms = require('./HotelbedsRateTerms');

const OFFER_CACHE_TTL_SECONDS = 30 * 60;
const OFFER_CACHE_PROVIDERS = Object.freeze(['hotelbeds', 'ratehawk']);

const offerCacheSchema = new mongoose.Schema({
    schemaVersion: { type: Number, enum: [1, 2], required: true, default: 1, immutable: true },
    publicReviewOffer: { type: mongoose.Schema.Types.Mixed, default: undefined, select: false, immutable: true },
    origin: {
        type: String,
        enum: ['mock_fixture', 'live'],
        required: true,
        select: false,
        immutable: true
    },
    publicOfferId: {
        type: String,
        required: true,
        immutable: true,
        minlength: 32,
        maxlength: 128
    },
    provider: {
        type: String,
        required: true,
        enum: OFFER_CACHE_PROVIDERS,
        immutable: true
    },
    termsVersion: { type: String, default: undefined, immutable: true, select: false, match: /^[a-f\d]{64}$/i },
    realm: { type: String, immutable: true, select: false, match: /^[a-z0-9:_-]{1,100}$/i },
    environment: { type: String, immutable: true, select: false, enum: ['test', 'live'] },
    accountId: { type: String, immutable: true, select: false, match: /^[a-f\d]{64}$/i },
    bookingMetadata: { type: mongoose.Schema.Types.Mixed, immutable: true, select: false },
    providerHotelCode: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 200,
        immutable: true
    },
    opaqueToken: {
        type: String,
        required: true,
        select: false,
        immutable: true,
        minlength: 1,
        maxlength: 8192
    },
    lockedNetPrice: {
        type: String,
        required: true,
        select: false,
        immutable: true,
        match: /^\d+(?:\.\d+)?$/
    },
    lockedSellAmount: {
        type: String,
        default: null,
        select: false,
        immutable: true,
        match: /^\d+(?:\.\d{1,2})?$/
    },
    lockedSellCurrency: {
        type: String,
        default: null,
        select: false,
        uppercase: true,
        immutable: true,
        match: /^[A-Z]{3}$/
    },
    currency: {
        type: String,
        required: true,
        select: false,
        uppercase: true,
        immutable: true,
        match: /^[A-Z]{3}$/
    },
    paymentType: { type: String, default: null, immutable: true, select: false },
    rateType: { type: String, enum: ['BOOKABLE', 'RECHECK'], default: null, immutable: true, select: false },
    roomCount: { type: Number, min: 1, max: 9, default: null, immutable: true, select: false },
    adultCount: { type: Number, min: 1, max: 36, default: null, immutable: true, select: false },
    childCount: { type: Number, min: 0, max: 36, default: null, immutable: true, select: false },
    bookingIdentity: {
        type: HotelbedsRateIdentity,
        default: undefined,
        select: false,
        immutable: true
    },
    bookingTerms: {
        type: HotelbedsRateTerms,
        default: undefined,
        select: false,
        immutable: true
    },
    bookingState: {
        type: String,
        enum: ['available', 'processing', 'confirmed', 'pending', 'failed', 'outcome_unknown'],
        default: 'available',
        select: false,
        index: true
    },
    bookingAttemptId: { type: String, select: false, default: null },
    bookingClientReference: { type: String, select: false, default: null },
    bookingReference: { type: String, select: false, default: null },
    bookingStatus: { type: String, select: false, default: null },
    bookingError: { type: String, select: false, default: null },
    bookingUpdatedAt: { type: Date, select: false },
    expiresAt: {
        type: Date,
        required: true,
        immutable: true
    }
}, {
    collection: 'offercaches',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    bufferCommands: false,
    strict: 'throw'
});

offerCacheSchema.index({ publicOfferId: 1 }, { unique: true });
offerCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OfferCache || mongoose.model('OfferCache', offerCacheSchema);
module.exports.OFFER_CACHE_TTL_SECONDS = OFFER_CACHE_TTL_SECONDS;
module.exports.OFFER_CACHE_PROVIDERS = OFFER_CACHE_PROVIDERS;