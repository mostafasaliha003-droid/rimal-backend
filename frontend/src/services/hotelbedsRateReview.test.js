import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    canStartDirectHotelbedsBooking,
    directBookingAttemptStorageKey,
    hotelbedsDirectUnavailableReason,
    isValidReviewIdempotencyKey,
    normalizeReviewOfferForDisplay,
    reviewIdempotencyStorageKey,
    validateRateReviewForSelectedOffer,
    validateRateReviewResponse
} from './hotelbedsRateReview.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const PUBLIC_OFFER_ID = 'a'.repeat(64);
const SOURCE_TERMS_VERSION = 'b'.repeat(64);
const TERMS_VERSION = 'c'.repeat(64);
const REVIEW_ID = '123e4567-e89b-42d3-a456-426614174000';

function rateReviewResponse(overrides = {}) {
    return {
        success: true,
        reviewId: REVIEW_ID,
        publicOfferId: PUBLIC_OFFER_ID,
        sourceTermsVersion: SOURCE_TERMS_VERSION,
        termsVersion: TERMS_VERSION,
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        checkRateRequests: 1,
        cached: false,
        offer: {
            provider: 'hotelbeds',
            publicOfferId: PUBLIC_OFFER_ID,
            hotel: { name: 'Review fixture hotel', category: { name: '4 stars' } },
            room: { name: 'Double standard' },
            termsVersion: TERMS_VERSION,
            availability: { rateType: 'BOOKABLE' },
            payment: { type: 'AT_HOTEL' },
            stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
            occupancy: { rooms: 1, adults: 2, children: 0 },
            price: { customerDisplay: { amount: '495.00', currency: 'AED' } },
            cancellation: {
                refundability: 'conditional',
                schedule: [{
                    startsAt: { source: '2026-11-08T00:00:00Z', utc: '2026-11-08T00:00:00.000Z' },
                    penalty: { amount: '100.00', currency: 'AED' }
                }]
            },
            rateComments: [{ description: 'A local fee is payable at the hotel.' }],
            contractTerms: { rateCommentsResolved: true, issues: [] },
            taxes: { status: 'provided', allIncluded: false, items: [] },
            promotions: [],
            checkRateTerms: { hotel: { rooms: [{ rates: [{ rateComments: ['Full comment'] }] }] } }
        },
        ...overrides
    };
}

function directOffer(overrides = {}) {
    return {
        provider: 'hotelbeds',
        paymentFlow: 'PAY_AT_PROPERTY',
        publicOfferId: PUBLIC_OFFER_ID,
        termsVersion: SOURCE_TERMS_VERSION,
        availability: { rateType: 'BOOKABLE' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        price: { amount: '495.00', currency: 'AED' },
        ...overrides
    };
}

test('rate review accepts the public server response and preserves its original object', () => {
    const response = rateReviewResponse();
    assert.equal(validateRateReviewResponse(response, { now: NOW }), response);
    assert.equal(response.offer.termsVersion, TERMS_VERSION);
});

test('rate review must match the exact selected offer, terms, price, occupancy and stay', () => {
    const review = rateReviewResponse();
    assert.equal(validateRateReviewForSelectedOffer(review, directOffer(), { now: NOW }), review);
    for (const selected of [
        directOffer({ publicOfferId: 'd'.repeat(64) }),
        directOffer({ termsVersion: 'e'.repeat(64) }),
        directOffer({ price: { amount: '496.00', currency: 'AED' } }),
        directOffer({ occupancy: { rooms: 1, adults: 1, children: 0 } }),
        directOffer({ availability: { rateType: 'RECHECK' } }),
        directOffer({ stay: { checkIn: '2026-11-11', checkOut: '2026-11-12' } })
    ]) {
        assert.throws(() => validateRateReviewForSelectedOffer(review, selected, { now: NOW }),
            /hotelbeds_rate_review_offer_mismatch/);
    }
});

test('rate review rejects malformed IDs, mismatched terms, invalid expiry, wrong check count and private fields', () => {
    const invalid = [
        { reviewId: 'not-a-uuid' },
        { publicOfferId: 'not-an-id' },
        { sourceTermsVersion: 'bad-version' },
        { termsVersion: 'bad-version' },
        { termsVersion: 'd'.repeat(64) },
        { expiresAt: new Date(NOW.getTime()).toISOString() },
        { expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000 + 1).toISOString() },
        { expiresAt: 'not-a-date' },
        { checkRateRequests: 2 },
        { cached: undefined },
        { offer: { ...rateReviewResponse().offer, providerRateKey: 'private-rate-key' } },
        { offer: { ...rateReviewResponse().offer, opaqueToken: 'private-rate-key' } },
        { offer: { ...rateReviewResponse().offer, checkRateTerms: { rateKey: 'private-rate-key' } } }
    ];
    for (const override of invalid) {
        assert.throws(() => validateRateReviewResponse(rateReviewResponse(override), { now: NOW }));
    }
});

test('rate review response enforces the backend review response size limit', () => {
    const response = rateReviewResponse({ offer: {
        ...rateReviewResponse().offer,
        rateComments: ['x'.repeat(129 * 1024)]
    } });
    assert.throws(() => validateRateReviewResponse(response, { now: NOW }),
        /hotelbeds_rate_review_response_too_large/);
});

test('direct booking eligibility is limited to server-issued AED pay-at-property adult single-room offers', () => {
    assert.equal(canStartDirectHotelbedsBooking(directOffer()), true);
    assert.equal(hotelbedsDirectUnavailableReason(directOffer()), null);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({ availability: undefined })), false,
        'direct booking requires rateType from the server response');
    assert.equal(canStartDirectHotelbedsBooking(directOffer({ mock: true })), false);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({ paymentFlow: 'PAY_NOW' })), false);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({ publicOfferId: 'invalid' })), false);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({ availability: { rateType: 'UNKNOWN' } })), false);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({ termsVersion: 'invalid' })), false);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({
        price: { amount: '495.00', currency: 'USD' }
    })), false);
    assert.equal(canStartDirectHotelbedsBooking(directOffer({
        occupancy: { rooms: 2, adults: 2, children: 0 }
    })), false);
    assert.equal(hotelbedsDirectUnavailableReason(directOffer({
        occupancy: { rooms: 1, adults: 2, children: 1 }
    })), 'direct_occupancy_unsupported');
    assert.equal(canStartDirectHotelbedsBooking(directOffer({
        occupancy: { rooms: 1, adults: 3, children: 0 }
    })), false);
});

test('review idempotency keys are scoped to validated public offer IDs', () => {
    assert.equal(reviewIdempotencyStorageKey(PUBLIC_OFFER_ID),
        `remal_hotelbeds_rate_review_idempotency:${PUBLIC_OFFER_ID}`);
    assert.equal(reviewIdempotencyStorageKey('not-an-id'), null);
    assert.equal(isValidReviewIdempotencyKey('review-idempotency-key-0001'), true);
    assert.equal(isValidReviewIdempotencyKey('short'), false);
    assert.equal(isValidReviewIdempotencyKey('x'.repeat(129)), false);
    assert.equal(directBookingAttemptStorageKey(PUBLIC_OFFER_ID),
        `remal_hotelbeds_direct_booking_started:${PUBLIC_OFFER_ID}`);
    assert.equal(directBookingAttemptStorageKey('invalid'), null);
});

test('display projection exposes complete public terms and an expiry countdown without private keys', () => {
    const response = rateReviewResponse();
    const display = normalizeReviewOfferForDisplay(response, { now: NOW });
    assert.equal(display.price.amount, '495.00');
    assert.equal(display.price.currency, 'AED');
    assert.equal(display.cancellation.schedule[0].startsAt.source, '2026-11-08T00:00:00Z');
    assert.equal(display.rateComments[0].description, 'A local fee is payable at the hotel.');
    assert.equal(display.taxes.allIncluded, false);
    assert.equal(display.checkRateTerms.hotel.rooms[0].rates[0].rateComments[0], 'Full comment');
    assert.equal(display.expiresInSeconds, 60);
    assert.equal(JSON.stringify(display).includes('providerRateKey'), false);
    assert.equal(JSON.stringify(display).includes('opaqueToken'), false);
});