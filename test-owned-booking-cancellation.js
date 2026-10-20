const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createOwnedBookingCancellationRouter } = require('./services/ownedBookingCancellationRoutes');

async function fixture(t) {
    const booking = { bookingReference: 'booking-1', supplierReference: 'supplier-1', provider: 'ratehawk', status: 'active' };
    const checkout = { state: 'booking_confirmed', payment_verified_at: new Date(), amount_minor: 36725, currency: 'AED', ziina_test: true,
        payment_quote: { rates: { USD: 1, AED: 3.6725 } } };
    const info = { status: 'completed', isCancellable: true, current_penalty: { amount: '10.00', currency_code: 'USD' } };
    let clock = 1000, cancellations = 0, lastOptions;
    const model = { findOne(filter) {
        assert.equal(filter.ownerSubject, 'owner'); assert.equal(filter.realm, 'sandbox');
        return { lean: async () => filter.bookingReference === 'other-booking' ? null : booking };
    } };
    const app = express(); app.use(express.json());
    app.use(createOwnedBookingCancellationRouter({ BookingModel: model,
        CheckoutModel: { findOne: () => ({ lean: async () => checkout }) },
        requireUser(req, res, next) { if (req.headers.authorization !== 'Bearer user') return res.sendStatus(401); req.auth = { subject: 'owner', realm: 'sandbox' }; next(); },
        env: { RIMAL_AUTH_REALM: 'sandbox', PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32), RATEHAWK_CANCELLATION_ENABLED: 'true', ZIINA_TEST_MODE: 'true' },
        operations: {
            getBookingInfo: async () => info,
            cancelBooking: async (id, options) => { assert.equal(id, 'supplier-1'); cancellations++; lastOptions = options; return { status: 'cancelled', customer_refund_status: 'pending' }; },
            checkCancellation: async () => ({ status: 'cancelled', customer_refund_status: 'completed' })
        },
        refundReady: () => true, now: () => clock, limiter: (_req, _res, next) => next()
    }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const request = async (method = 'GET', body, reference = 'booking-1', authorization = 'Bearer user') => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/bookings/${reference}/cancellation`, {
            method, headers: { authorization, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, body: response.status === 401 ? null : await response.json(), headers: response.headers };
    };
    return { booking, checkout, info, request, expire: () => { clock += 300001; }, count: () => cancellations, options: () => lastOptions };
}
test('owned cancellation prices supplier fees at the original FX and binds the exact refund to the authenticated quote', async t => {
    const s = await fixture(t);
    const quote = await s.request();
    assert.equal(quote.body.mode, 'automatic');
    assert.deepEqual(quote.body.fee, { amount: '36.73', currency_code: 'AED' });
    assert.deepEqual(quote.body.refund, { amount: '330.52', currency_code: 'AED' });
    assert.match(quote.headers.get('cache-control'), /no-store/);
    assert.equal(s.count(), 0, 'Viewing a policy never cancels a booking');
    const result = await s.request('POST', { confirm_cancellation: true, quote_token: quote.body.quote_token,
        customer_refund: { amount: '9999.00', currency_code: 'AED' } });
    assert.equal(result.status, 200);
    assert.deepEqual(s.options().customer_refund, quote.body.refund);
    assert.deepEqual(s.options().expected_penalty, s.info.current_penalty);
    assert.equal(s.count(), 1);
});
test('cancellation rejects foreign bookings, unauthenticated requests, tampering, omitted consent and expiry', async t => {
    const s = await fixture(t);
    assert.equal((await s.request('GET', null, 'other-booking')).status, 404);
    assert.equal((await s.request('GET', null, 'booking-1', '')).status, 401);
    const { quote_token: token } = (await s.request()).body;
    assert.equal((await s.request('POST', { quote_token: token })).status, 400);
    assert.equal((await s.request('POST', { confirm_cancellation: true, quote_token: `${token}x` })).status, 409);
    s.expire();
    assert.equal((await s.request('POST', { confirm_cancellation: true, quote_token: token })).status, 409);
    assert.equal(s.count(), 0);
});
test('free, zero-refund, unavailable FX, upsells and pending requests have explicit cancellation modes', async t => {
    const s = await fixture(t);
    s.info.current_penalty.amount = '0.00';
    assert.equal((await s.request()).body.refund.amount, '367.25');
    s.info.current_penalty = { amount: '367.25', currency_code: 'AED' };
    assert.equal((await s.request()).body.refund.amount, '0.00');
    s.info.current_penalty = { amount: '10', currency_code: 'EUR' };
    assert.equal((await s.request()).body.mode, 'support');
    s.checkout.currency = 'KWD'; s.checkout.amount_minor = 10000;
    s.checkout.payment_quote.rates = { USD: 1, KWD: 0.30 };
    s.info.current_penalty = { amount: '10', currency_code: 'USD' };
    assert.deepEqual((await s.request()).body.refund, { amount: '7.000', currency_code: 'KWD' });
    s.info.current_penalty = { amount: '0', currency_code: 'USD' };
    s.info.upsells_require_manual_cancellation = true;
    assert.equal((await s.request()).body.mode, 'support');
    s.checkout.cancellation_request_hash = 'already-requested';
    assert.equal((await s.request()).body.mode, 'tracking');
    assert.equal(s.count(), 0);
});
