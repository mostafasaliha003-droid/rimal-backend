import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_CURRENCY, DISPLAY_CURRENCIES, displayAmount, cheapestRate, normalizeRoom, rateAmount, formatMoney } from './offers.js';
import { trackBookingEvent } from './analytics.js';

const rate = (amount, currency = 'USD') => ({ book_hash: 'rate', payment_options: { payment_types: [{ amount, currency_code: currency, type: 'deposit' }] } });

test('display conversion requires a valid quote and preserves the supplier price', () => {
    const supplierRate = rate('60');
    const quotes = { AED: 3.6725, SAR: 3.75, EUR: 0.87088 };
    assert.deepEqual(DISPLAY_CURRENCIES, ['USD', 'AED', 'SAR', 'EUR']);
    assert.equal(displayAmount(rateAmount(supplierRate), 'USD', 'USD', null), 60);
    assert.equal(displayAmount(rateAmount(supplierRate), 'USD', 'AED', quotes), 220.35);
    assert.equal(displayAmount(rateAmount(supplierRate), 'USD', 'SAR', quotes), 225);
    assert.equal(displayAmount(rateAmount(supplierRate), 'USD', 'EUR', quotes), 52.2528);
    assert.equal(displayAmount(60, 'USD', 'AED', { AED: 0 }), null);
    assert.equal(displayAmount(60, 'USD', 'EUR', {}), null);
    assert.equal(displayAmount(60, 'AED', 'EUR', quotes), 60 / 3.6725 * 0.87088);
    assert.equal(displayAmount(60, 'AED', 'USD', quotes), 60 / 3.6725);
    assert.equal(displayAmount(60, 'AED', 'SAR', { SAR: 3.75 }), null);
    assert.equal(displayAmount(60, 'GBP', 'EUR', quotes), null);
    assert.equal(displayAmount(Infinity, 'USD', 'AED', quotes), null);
    assert.equal(rateAmount(supplierRate), 60);
});

test('compares valid offers in one currency, not supplier order', () => {
    const low = rate('60');
    const dirhamRate = rate(1, 'AED');
    assert.equal(SEARCH_CURRENCY, 'USD');
    assert.equal(cheapestRate([rate(312), rate(68), low, dirhamRate, rate('invalid')]), low);
    assert.equal(cheapestRate([low, dirhamRate], 'AED'), dirhamRate);
    assert.equal(cheapestRate([dirhamRate]), null);
    assert.equal(cheapestRate([]), null);
    assert.equal(rateAmount({}), Infinity);
});

test('missing policy and bed do not become free cancellation or king bed', () => {
    const room = normalizeRoom(rate(60), {}, [{ adults: 2, children: [] }]);
    assert.equal(room.cancellation, undefined);
    assert.equal(room.bed, undefined);
    assert.equal(room.price, 60);
    assert.equal(room.currency, 'USD');
    assert.equal(formatMoney(room.price, room.currency), new Intl.NumberFormat('ar-AE', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(60));
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