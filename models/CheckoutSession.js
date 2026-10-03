const mongoose = require('mongoose');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');
const HotelbedsRateIdentity = require('./HotelbedsRateIdentity');
const HotelbedsRateTerms = require('./HotelbedsRateTerms');

const CHECKOUT_SESSION_STATUSES = Object.freeze([
    'awaiting_payment',
    'payment_verified',
    'booking_preflight',
    'booking_processing',
    'booking_pending',
    'confirmed',
    'outcome_unknown',
    'refund_review'
]);

const checkoutSessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, immutable: true, match: /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i },
    publicOfferId: { type: String, required: true, immutable: true, match: /^[a-f\d]{64}$/i },
    offerExpiresAt: { type: Date, required: true, immutable: true },
    provider: { type: String, required: true, enum: ['hotelbeds'], immutable: true },
    offerOrigin: { type: String, required: true, enum: ['mock_fixture', 'live'], immutable: true },
    paymentProvider: { type: String, required: true, enum: ['mock', 'ziina'], immutable: true },
    paymentType: { type: String, required: true, enum: ['AT_WEB'], immutable: true },
    providerOfferRef: { type: String, required: true, select: false, immutable: true, minlength: 1, maxlength: 8192 },
    providerHotelCode: { type: String, required: true, select: false, immutable: true, minlength: 1, maxlength: 200 },
    totalAmount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    currency: { type: String, required: true, enum: ['AED'], uppercase: true, immutable: true },
    guestDetailsEncrypted: {
        type: new mongoose.Schema({
            iv: { type: String, required: true, match: /^[a-f\d]{24}$/i },
            tag: { type: String, required: true, match: /^[a-f\d]{32}$/i },
            ciphertext: { type: String, required: true, minlength: 1 }
        }, { _id: false, strict: 'throw' }),
        required: true,
        select: false,
        immutable: true
    },
    rateType: { type: String, enum: ['BOOKABLE', 'RECHECK'], required: true, immutable: true },
    lockedNetPrice: { type: String, required: true, select: false, immutable: true, match: /^\d+(?:\.\d+)?$/ },
    lockedNetCurrency: { type: String, required: true, select: false, uppercase: true, immutable: true, match: /^[A-Z]{3}$/ },
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
    occupancy: {
        rooms: { type: Number, required: true, min: 1, max: 1, immutable: true },
        adults: { type: Number, required: true, min: 1, max: 36, immutable: true },
        children: { type: Number, required: true, min: 0, max: 0, immutable: true }
    },
    paymentIntentId: { type: String, default: undefined, select: false },
    idempotencyKeyHash: { type: String, required: true, select: false, immutable: true, match: /^[a-f\d]{64}$/i },
    requestFingerprint: { type: String, required: true, select: false, immutable: true, match: /^[a-f\d]{64}$/i },
    status: { type: String, required: true, enum: CHECKOUT_SESSION_STATUSES, default: 'awaiting_payment' },
    bookingReference: { type: String, default: null, select: false },
    bookingClientReference: { type: String, select: false },
    bookingRateKey: { type: String, select: false },
    hotelbedsBookingStatus: { type: String, enum: ['CONFIRMED', 'ON_REQUEST', 'PENDING'], select: false },
    lastError: { type: String, default: null, select: false },
    paymentVerifiedAt: Date,
    bookingStartedAt: Date,
    confirmedAt: Date,
    completedAt: Date,
    mockPaymentUrl: { type: String, default: null, select: false },
    bookingAttemptId: { type: String, default: null, select: false },
    webhookProcessedAt: Date
}, {
    collection: 'checkoutsessions',
    timestamps: true,
    versionKey: false,
    bufferCommands: false,
    strict: 'throw'
});

checkoutSessionSchema.index({ sessionId: 1 }, { unique: true });
checkoutSessionSchema.index({ idempotencyKeyHash: 1 }, { unique: true });
checkoutSessionSchema.index({ publicOfferId: 1 });
checkoutSessionSchema.index({ paymentIntentId: 1 }, { unique: true, sparse: true });
checkoutSessionSchema.index({ bookingClientReference: 1 }, { unique: true, sparse: true });
checkoutSessionSchema.index({ status: 1, updatedAt: 1 });

module.exports = hotelbedsMockDatabase.model('CheckoutSession', checkoutSessionSchema);
module.exports.CHECKOUT_SESSION_STATUSES = CHECKOUT_SESSION_STATUSES;