const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');
const Model = require('./models/CheckoutAttempt');
const checkout = require('./services/checkoutProcessService');
const booking = require('./services/bookingProcessService');
const ziina = require('./services/ziinaClient');
const payment = require('./services/paymentService');
const { createCheckoutRecoveryHandler, createPaymentAvailabilityHandler } = require('./services/checkoutRecoveryRoutes');
const { createSessionAuthMiddleware } = require('./services/sessionAuthMiddleware');
const { createMembershipAccessGate } = require('./services/membershipAccessGate');

const identity = { role: 'user', subject: 'owner-a', realm: 'fixture-staging', email: 'fixture@example.test' };
const key = 'fixture-recovery-key-12345';
const reference = 'd54aac0d-55a1-4737-a157-4ccc158e2139';
function fixture(context, patch = {}) {
    for (const [name, value] of Object.entries({ PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
        RIMAL_AUTH_REALM: identity.realm, PAYMENT_CHECKOUT_ENABLED: 'false', RATEHAWK_BOOKING_ENABLED: 'false' })) {
        const previous = process.env[name]; process.env[name] = value;
        context.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
    }
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, writable: true, value: 1 });
    context.after(() => descriptor ? Object.defineProperty(mongoose.connection, 'readyState', descriptor) : delete mongoose.connection.readyState);
    const id = crypto.createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(key).digest('hex');
    const state = { reads: [], row: { _id: id, reference, ownerSubject: identity.subject, realm: identity.realm,
        request_hash: '1'.repeat(64), state: 'awaiting_payment', redirect_url: 'https://pay.ziina.com/fixture',
        payment_expires_at: new Date(Date.now() + 60_000), encrypted_details: { ciphertext: 'private-guest' },
        email: 'private@example.test', ...patch } };
    context.mock.method(Model, 'findOne', filter => { state.reads.push(filter); return { async lean() {
        return state.row && Object.entries(filter).every(([name, value]) => state.row[name] === value) ? structuredClone(state.row) : null;
    } }; });
    for (const name of ['create', 'updateOne', 'findOneAndUpdate', 'deleteMany']) context.mock.method(Model, name, () => { throw new Error('forbidden_database_mutation'); });
    for (const [object, name] of [[booking, 'createProcess'], [booking, 'finishProcess'], [ziina, 'createIntent'], [ziina, 'createRefund']]) {
        context.mock.method(object, name, () => { throw new Error('forbidden_external_mutation'); });
    }
    context.mock.method(payment, 'isCheckoutReady', () => false);
    return state;
}

test('owned recovery reads the original HMAC key, restores a scoped capability and never creates or mutates', async context => {
    const state = fixture(context), before = JSON.stringify(state.row);
    const result = await checkout.recoverCheckout(key, identity);
    assert.equal(result.found, true); assert.equal(result.reference, reference); assert.equal(result.status, 'awaiting_payment');
    assert.match(result.access_token, /^[a-f\d]{64}$/); assert.equal(result.payment_url, 'https://pay.ziina.com/fixture');
    assert.deepEqual(state.reads, [{ _id: state.row._id, ownerSubject: identity.subject, realm: identity.realm }]);
    assert.equal(JSON.stringify(state.row), before); assert.doesNotMatch(JSON.stringify(result), /private|email|encrypted|request_hash|ownerSubject/);
    assert.equal(payment.isCheckoutReady.mock.callCount(), 0);
    for (const name of ['create', 'updateOne', 'findOneAndUpdate', 'deleteMany']) assert.equal(Model[name].mock.callCount(), 0);
    assert.equal(booking.createProcess.mock.callCount(), 0); assert.equal(booking.finishProcess.mock.callCount(), 0);
    assert.equal(ziina.createIntent.mock.callCount(), 0); assert.equal(ziina.createRefund.mock.callCount(), 0);
});

test('absent, another owner and another record realm are indistinguishable and disclose no capability', async context => {
    const state = fixture(context);
    for (const change of [{ ownerSubject: 'owner-b' }, { realm: 'other-realm' }]) {
        Object.assign(state.row, { ownerSubject: identity.subject, realm: identity.realm }, change);
        assert.deepEqual(await checkout.recoverCheckout(key, identity), { found: false });
    }
    state.row = null; assert.deepEqual(await checkout.recoverCheckout(key, identity), { found: false });
});

test('bad identities, roles, realms and malformed keys fail before database lookup', async context => {
    const state = fixture(context);
    for (const owner of [null, {}, { ...identity, role: 'admin' }, { ...identity, realm: 'other-realm' }, { ...identity, subject: '' }]) {
        await assert.rejects(checkout.recoverCheckout(key, owner), error => error.httpStatus === 401);
    }
    for (const value of [undefined, '', 'short', 'x'.repeat(129), 'bad key with spaces!!', { key }]) {
        await assert.rejects(checkout.recoverCheckout(value, identity), error => error.code === 'invalid_idempotency_key' && error.httpStatus === 400);
    }
    assert.equal(state.reads.length, 0);
});

test('all durable states recover without reenabling checkout, including failed preflight and unknown outcomes', async context => {
    const state = fixture(context);
    const states = Model.schema.path('state').enumValues;
    for (const status of states) {
        Object.assign(state.row, { state: status, payment_verified_at: new Date(), partner_order_id: 'supplier-fixture', notification_status: 'sent' });
        const value = await checkout.recoverCheckout(key, identity);
        assert.equal(value.found, true); assert.equal(value.status, status); assert.equal(value.confirmed, status === 'booking_confirmed');
        assert.match(value.access_token, /^[a-f\d]{64}$/);
        assert.equal(value.payment_url, status === 'awaiting_payment' ? 'https://pay.ziina.com/fixture' : undefined);
    }
});

test('recovery never revives missing, invalid or expired payment links', async context => {
    const state = fixture(context);
    for (const expiry of [undefined, null, 'invalid', new Date(0), new Date(Date.now() - 1)]) {
        state.row.payment_expires_at = expiry;
        assert.equal((await checkout.recoverCheckout(key, identity)).payment_url, undefined);
    }
});

test('unavailable storage or encryption fails closed without writes', async context => {
    const state = fixture(context);
    mongoose.connection.readyState = 0;
    await assert.rejects(checkout.recoverCheckout(key, identity), error => error.code === 'checkout_unavailable');
    assert.equal(state.reads.length, 0); mongoose.connection.readyState = 1;
    process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = '';
    await assert.rejects(checkout.recoverCheckout(key, identity), error => error.code === 'checkout_encryption_unavailable');
    assert.equal(state.reads.length, 0);
});

async function httpFixture(context, { service = checkout, readiness = { ready: false, mode: 'sandbox' }, database = mongoose.connection } = {}) {
    let membershipCalls = 0;
    const sessions = { async resolve(value) { return value === 'a'.repeat(64) ? identity : value === 'b'.repeat(64) ? { ...identity, role: 'admin' } : null; } };
    const auth = createSessionAuthMiddleware({ sessions, realm: identity.realm });
    const app = express(); app.set('env', 'test'); app.use(express.json());
    app.use(createMembershipAccessGate({ sessions, service: { enabled: () => true, async application() { membershipCalls++; throw new Error('membership_unavailable'); } } }));
    app.get('/api/payment/availability', createPaymentAvailabilityHandler({ payment: { getCheckoutReadiness: () => readiness }, database }));
    app.post('/api/payment/ziina/recover', auth.requireRole('user'), createCheckoutRecoveryHandler({ service }));
    app.post('/api/payment/quote', (_req, res) => res.json({ reached: true }));
    const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));
    return { url: `http://127.0.0.1:${server.address().port}`, membershipCalls: () => membershipCalls,
        async post(body = {}, token = 'a'.repeat(64), query = '', headerKey = key) {
            return fetch(`http://127.0.0.1:${server.address().port}/api/payment/ziina/recover${query}`, { method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(headerKey ? { 'Idempotency-Key': headerKey } : {}) }, body: JSON.stringify(body) });
        } };
}

test('actual HTTP recovery retains user auth while unavailable membership never blocks an existing attempt', async context => {
    fixture(context); const api = await httpFixture(context);
    const ok = await api.post(); assert.equal(ok.status, 200); assert.equal((await ok.json()).found, true);
    assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.match(ok.headers.get('vary'), /Authorization/);
    assert.equal((await api.post({}, null)).status, 401); assert.equal((await api.post({}, 'b'.repeat(64))).status, 401);
    assert.equal(api.membershipCalls(), 0);
    const other = await fetch(api.url + '/api/payment/quote', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } });
    assert.equal(other.status, 503); assert.equal(api.membershipCalls(), 1);
});

test('actual HTTP route rejects selectors, malformed key, arrays and unavailable reads with bounded errors', async context => {
    fixture(context); const api = await httpFixture(context, { service: { async recoverCheckout() { throw new Error('private-database-secret'); } } });
    for (const input of [{ ownerSubject: 'owner-b' }, { realm: 'other' }, { email: 'private@example.test' }, [], null]) assert.equal((await api.post(input)).status, 400);
    assert.equal((await api.post({}, 'a'.repeat(64), '?owner=other')).status, 400);
    const unavailable = await api.post(); assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { success: false, error: 'checkout_recovery_unavailable' });
});

test('actual HTTP service rejects malformed key and exposes only safe availability mode metadata', async context => {
    fixture(context); const readiness = { ready: false, mode: 'sandbox', blockers: ['PRIVATE_CONFIG'] }; const db = { readyState: 1 };
    const api = await httpFixture(context, { readiness, database: db });
    const bad = await api.post({}, 'a'.repeat(64), '', 'short'); assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { success: false, error: 'invalid_idempotency_key' });
    for (const mode of ['sandbox', 'production', 'unconfigured']) {
        readiness.mode = mode;
        const response = await fetch(api.url + '/api/payment/availability');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { enabled: false, mode, tabby: false, reason: 'checkout_unavailable' });
    }
    readiness.ready = true; readiness.mode = 'sandbox';
    assert.deepEqual(await (await fetch(api.url + '/api/payment/availability')).json(), { enabled: true, mode: 'sandbox', tabby: false });
    db.readyState = 0;
    assert.deepEqual(await (await fetch(api.url + '/api/payment/availability')).json(), { enabled: false, mode: 'sandbox', tabby: false, reason: 'checkout_unavailable' });
});
