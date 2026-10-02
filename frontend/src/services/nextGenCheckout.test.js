import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    acceptMockPaymentRedirect,
    canCreateHotelbedsCheckout,
    canStartPrepaidCheckout,
    checkoutIdempotencyStorageKey,
    formatAedPrice,
    mapCheckoutStatus,
    normalizeCheckoutGuestDetails,
    persistedAccessToken,
    privatePaymentStatusUrl,
    sessionStorageKey,
    validateCheckoutSessionResponse,
    validateUnifiedSearchResponse
} from './nextGenCheckout.js';

const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const accessToken = 'a'.repeat(64);
const offerId = 'b'.repeat(64);
const offer = (overrides = {}) => ({
    provider: 'hotelbeds',
    paymentFlow: 'PAY_NOW',
    publicOfferId: offerId,
    occupancy: { rooms: 1, adults: 2, children: 0 },
    price: { amount: '495.25', currency: 'AED' },
    ...overrides
});

function memoryStorage() {
    const entries = new Map();
    return {
        getItem(key) { return entries.get(key) ?? null; },
        setItem(key, value) { entries.set(key, String(value)); },
        removeItem(key) { entries.delete(key); }
    };
}

test('schema v2 validates server-computed AED strings and never projects source/net fields', () => {
    const response = {
        success: true,
        schemaVersion: 2,
        currency: 'AED',
        partialResults: false,
        offerCount: 1,
        hotels: [{ name: 'Fixture hotel', offers: [offer()] }]
    };
    assert.equal(validateUnifiedSearchResponse(response), response);
    assert.equal(formatAedPrice('495.25', 'AED'), 'AED 495.25');
    assert.equal(formatAedPrice('495.25', 'USD'), null);
    assert.equal(formatAedPrice('495.255', 'AED'), null);
    assert.throws(() => validateUnifiedSearchResponse({ ...response, schemaVersion: 1 }));
    assert.throws(() => validateUnifiedSearchResponse({ ...response, hotels: [{ offers: [{ price: { amount: 1, currency: 'AED' } }] }] }));
    assert.equal(JSON.stringify(response).includes('net'), false);
});

test('checkout eligibility requires pay-now, an opaque public ID, and supported Hotelbeds occupancy', () => {
    assert.equal(canStartPrepaidCheckout(offer()), true);
    assert.equal(canCreateHotelbedsCheckout(offer()), true);
    assert.equal(canStartPrepaidCheckout(offer({ paymentFlow: 'PAY_AT_PROPERTY' })), false);
    assert.equal(canCreateHotelbedsCheckout(offer({ occupancy: { rooms: 2, adults: 2, children: 0 } })), false);
    assert.equal(canCreateHotelbedsCheckout(offer({ occupancy: { rooms: 1, adults: 2, children: 1 } })), false);
    assert.equal(canStartPrepaidCheckout(offer({ publicOfferId: 'not-a-public-id' })), false);
    assert.equal(checkoutIdempotencyStorageKey(offerId), `remal_nextgen_checkout_idempotency:${offerId}`);
    assert.equal(checkoutIdempotencyStorageKey('net'), null);
});

test('guest payload matches one-room adult-only checkout contract', () => {
    assert.deepEqual(normalizeCheckoutGuestDetails({
        firstName: ' Ada ', lastName: ' Lovelace ', email: ' ada@example.test ', phone: '+971500000000',
        additionalGuests: [{ firstName: ' Grace ', lastName: ' Hopper ' }]
    }), {
        firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '+971500000000',
        rooms: [{ guests: [
            { firstName: 'Ada', lastName: 'Lovelace', is_child: false },
            { firstName: 'Grace', lastName: 'Hopper', is_child: false }
        ] }]
    });
});

test('session response is checked as a mock checkout before accepting its redirect', () => {
    const response = validateCheckoutSessionResponse({
        success: true,
        sessionId,
        access_token: accessToken,
        status: 'awaiting_payment',
        totalAmount: 49525,
        currency: 'AED',
        payment_url: `https://pay.example.test/mock/${sessionId}`
    });
    assert.equal(response.payment_url, `https://pay.example.test/mock/${sessionId}`);
    assert.throws(() => validateCheckoutSessionResponse({
        ...response, payment_url: 'https://evil.example/mock'
    }));
    assert.throws(() => validateCheckoutSessionResponse({ ...response, totalAmount: 0 }));
});

test('status maps every backend state to the requested customer state', () => {
    assert.equal(mapCheckoutStatus('awaiting_payment'), 'verifying_payment');
    assert.equal(mapCheckoutStatus('payment_verified'), 'booking_pending');
    assert.equal(mapCheckoutStatus('booking_processing'), 'booking_pending');
    assert.equal(mapCheckoutStatus('confirmed'), 'confirmed');
    assert.equal(mapCheckoutStatus('refund_review'), 'refund_review');
    assert.equal(mapCheckoutStatus('outcome_unknown'), 'manual_review');
    assert.equal(mapCheckoutStatus('not-a-state'), 'manual_review');
});

test('session access token stays in sessionStorage and mock return URL contains only session ID', () => {
    const storage = memoryStorage();
    storage.setItem(sessionStorageKey(sessionId), JSON.stringify({ accessToken }));
    assert.equal(persistedAccessToken(sessionId, null, storage), accessToken);
    assert.equal(persistedAccessToken(sessionId, 'c'.repeat(64), storage), null);
    assert.equal(persistedAccessToken('bad-session', null, storage), null);
    const oldOrigin = globalThis.window;
    globalThis.window = { location: { origin: 'https://remal.example.test' } };
    try {
        const statusUrl = privatePaymentStatusUrl(sessionId, storage);
        assert.equal(new URL(statusUrl).searchParams.get('sessionId'), sessionId);
        assert.equal(new URL(statusUrl).searchParams.has('accessToken'), false);
        const redirect = new URL(acceptMockPaymentRedirect(`https://pay.example.test/mock/${sessionId}`, statusUrl));
        assert.equal(redirect.pathname, '/mock-payment');
        assert.equal(redirect.searchParams.get('sessionId'), sessionId);
        assert.equal(redirect.searchParams.get('return_url'), statusUrl);
        assert.throws(() => acceptMockPaymentRedirect('https://attacker.test/pay', statusUrl));
    } finally {
        if (oldOrigin === undefined) delete globalThis.window;
        else globalThis.window = oldOrigin;
    }
});