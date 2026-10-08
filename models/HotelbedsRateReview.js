const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');
const HotelbedsRateIdentity = require('./HotelbedsRateIdentity');
const HotelbedsRateTerms = require('./HotelbedsRateTerms');

const rateReviewSchema = new mongoose.Schema({
    reviewId: {
        type: String, required: true, immutable: true,
        match: /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i
    },
    realm: { type: String, required: true, immutable: true, match: /^[a-z0-9:_-]{1,100}$/i },
    environment: { type: String, required: true, immutable: true, enum: ['test'] },
    accountId: { type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/i },
    ownerSubject: { type: String, required: true, immutable: true, maxlength: 254 },
    publicOfferId: { type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/i },
    idempotencyKeyHash: {
        type: String, required: true, immutable: true, select: false, match: /^[a-f\d]{64}$/i
    },
    state: {
        type: String, required: true,
        enum: ['checking', 'pending', 'consumed', 'stale', 'failed'], default: 'checking'
    },
    claimExpiresAt: { type: Date, default: undefined, select: false },
    sourceTermsVersion: {
        type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/i
    },
    rateType: { type: String, required: true, immutable: true, enum: ['BOOKABLE', 'RECHECK'] },
    rateKeyFingerprint: {
        type: String, required: true, immutable: true, select: false, match: /^[a-f\d]{64}$/i
    },
    providerRateKey: { type: String, required: true, immutable: true, select: false, minlength: 1, maxlength: 8192 },
    checkRateRequests: { type: Number, required: true, min: 0, max: 1, enum: [0, 1] },
    termsVersion: { type: String, default: undefined, match: /^[a-f\d]{64}$/i },
    rateIdentity: { type: HotelbedsRateIdentity, required: true, immutable: true, select: false },
    rateTerms: { type: HotelbedsRateTerms, default: undefined, select: false },
    offer: { type: mongoose.Schema.Types.Mixed, default: undefined, select: false },
    checkRateSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined, select: false },
    checkRateTermsFingerprint: {
        type: String, default: undefined, select: false, match: /^[a-f\d]{64}$/i
    },
    reviewExpiresAt: { type: Date, default: undefined },
    consumedAt: { type: Date, default: undefined, select: false },
    expiresAt: { type: Date, required: true, immutable: true }
}, {
    collection: 'hotelbedsratereviews',
    timestamps: true,
    versionKey: false,
    bufferCommands: false,
    strict: 'throw',
    writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
});

rateReviewSchema.index({ reviewId: 1 }, { unique: true });
rateReviewSchema.index({ realm: 1, environment: 1, accountId: 1, ownerSubject: 1, idempotencyKeyHash: 1 }, { unique: true });
rateReviewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = hotelbedsMockDatabase.model('HotelbedsRateReview', rateReviewSchema);