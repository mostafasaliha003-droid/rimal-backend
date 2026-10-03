const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');
const rateIdentitySchema = require('./HotelbedsRateIdentity');
const rateTermsSchema = require('./HotelbedsRateTerms');

const BOOKING_ATTEMPT_STATES = Object.freeze([
    'claimed', 'preflight_failed', 'booking_processing', 'booking_pending',
    'confirmed', 'outcome_unknown', 'manual_review'
]);

const bookingAttemptSchema = new mongoose.Schema({
    scope: { type: String, required: true, enum: ['direct', 'prepaid'], immutable: true },
    publicOfferId: {
        type: String, required: true, immutable: true, select: false, match: /^[a-f\d]{64}$/i
    },
    sessionId: {
        type: String, default: undefined, immutable: true, select: false,
        match: /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i
    },
    attemptId: {
        type: String, required: true, immutable: true, select: false,
        match: /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i
    },
    clientReference: {
        type: String, required: true, immutable: true, select: false, match: /^RML[A-Z0-9]{10,17}$/
    },
    state: { type: String, required: true, enum: BOOKING_ATTEMPT_STATES, default: 'claimed' },
    rateKey: { type: String, required: true, immutable: true, select: false, minlength: 1, maxlength: 8192 },
    rateType: { type: String, required: true, enum: ['BOOKABLE', 'RECHECK'], immutable: true, select: false },
    rateIdentity: { type: rateIdentitySchema, required: true, immutable: true, select: false },
    rateTerms: { type: rateTermsSchema, required: true, immutable: true, select: false },
    bookingReference: { type: String, default: null, select: false, maxlength: 200 },
    bookingStatus: { type: String, default: null, select: false, maxlength: 40 },
    lastError: { type: String, default: null, select: false, match: /^[a-z][a-z0-9_]{0,79}$/ },
    bookingRateKey: { type: String, default: null, select: false, maxlength: 8192 },
    claimedAt: { type: Date, required: true, immutable: true },
    bookingStartedAt: { type: Date, default: null },
    reconciledAt: { type: Date, default: null }
}, {
    collection: 'hotelbedsbookingattempts',
    timestamps: true,
    versionKey: false,
    bufferCommands: false,
    strict: 'throw',
    writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
});

bookingAttemptSchema.index(
    { scope: 1, publicOfferId: 1 },
    { unique: true, partialFilterExpression: { scope: 'direct' } }
);
bookingAttemptSchema.index(
    { scope: 1, sessionId: 1 },
    { unique: true, partialFilterExpression: { scope: 'prepaid' } }
);
bookingAttemptSchema.index({ attemptId: 1 }, { unique: true });
bookingAttemptSchema.index({ clientReference: 1 }, { unique: true });
bookingAttemptSchema.index({ state: 1, updatedAt: 1 });

module.exports = hotelbedsMockDatabase.model('HotelbedsBookingAttempt', bookingAttemptSchema);
module.exports.BOOKING_ATTEMPT_STATES = BOOKING_ATTEMPT_STATES;