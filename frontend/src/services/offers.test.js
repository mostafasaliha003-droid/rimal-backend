import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestRate, normalizeRoom, rateAmount } from './offers.js';
import { trackBookingEvent } from './analytics.js';

const rate = (amount, currency = 'AED') => ({ book_hash: 'rate', payment_options: { payment_types: [{ amount, currency_code: currency, type: 'deposit' }] } });

test('compares valid offers in one currency, not supplier order', () => {
    const low = rate('60');
    assert.equal(cheapestRate([rate(312), rate(68), low, rate(1, 'USD'), rate('invalid')]), low);
    assert.equal(cheapestRate([]), null);
    assert.equal(rateAmount({}), Infinity);
});

test('missing policy and bed do not become free cancellation or king bed', () => {
    const room = normalizeRoom(rate(60), {}, [{ adults: 2, children: [] }]);
    assert.equal(room.cancellation, undefined);
    assert.equal(room.bed, undefined);
    assert.equal(room.price, 60);
});

test('analytics contract excludes personal data and unknown events', () => {
    const received = [];
    globalThis.window = { dispatchEvent: event => received.push(event.detail) };
    try {
        trackBookingEvent('search_completed', { result_count: 3, email: 'private@example.com', book_hash: 'private', duration_ms: NaN });
        trackBookingEvent('booking_confirmed', { result_count: 1 });
        assert.equal(received.length, 1);
        assert.deepEqual(received[0].properties, { result_count: 3 });
    } finally { delete globalThis.window; }
});