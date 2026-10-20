const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const store = require('./models/CheckoutAttempt');
const checkoutService = require('./services/checkoutProcessService');
const checkout = { ...checkoutService, createCheckout(input, key, ip, identity = {
    role: 'user', subject: 'fixture-owner', realm: process.env.RIMAL_AUTH_REALM || 'fixture-staging'
}) { return checkoutService.createCheckout(input, key, ip, identity); } };
const booking = require('./services/bookingProcessService');
const ratehawk = require('./services/ratehawkService');
const payment = require('./services/paymentService');
const ziina = require('./services/ziinaClient');

const details = () => ({
    hid: 123, book_hash: 'fixture-hash', roomName: 'Test Double Room',
    checkin: '2099-10-15', checkout: '2099-10-17', currency: 'USD', total: 107,
    guests: [{ adults: 1, children: [5] }],
    guest: { firstName: 'Test', lastName: 'Guest', email: 'test@example.com', phone: '+971500000000' },
    rooms: [{ guests: [
        { firstName: 'Test', lastName: 'Guest', is_child: false },
        { firstName: 'Test', lastName: 'Child', is_child: true, age: 5 }
    ] }]
});

test('hotel prebook keeps the customer price through room selection and checkout verification', () => {
    const rate = { room_name: 'Test Room', book_hash: 'fresh-hash', payment_options: { payment_types: [
        { type: 'deposit', amount: '156.00', currency_code: 'USD', show_amount: '156.00', show_currency_code: 'USD' }
    ] } };
    const supplier = { hotels: [{ hid: 123, rates: [rate] }], changes: { price_changed: false } };
    const response = payment.decoratePrebook(supplier);
    const selected = response.hotels[0].rates[0];
    assert.equal(selected.customer_display_amount, 166.92);
    assert.equal(selected.customer_display_currency, 'USD');
    assert.equal(rate.customer_display_amount, undefined);
    assert.equal(payment.resolveValidatedPayment(supplier, { hid: 123, total: selected.customer_display_amount,
        currency: selected.customer_display_currency, roomName: selected.room_name }).amount, 156);
    assert.throws(() => payment.resolveValidatedPayment(supplier, { hid: 123, total: 156, currency: 'USD' }), /RATE_CHANGED/);
    assert.equal(payment.decoratePrebook({ rate }).rate.customer_display_amount, 166.92);
});

function fixture(context, { bookHash = 'fixture-hash', formHash = 'fresh-hash' } = {}) {
    const previous = process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
    const testMode = process.env.ZIINA_TEST_MODE;
    const originalSupplier = process.env.RATEHAWK_BASE_URL;
    const originalKey = process.env.RATEHAWK_KEY_ID;
    process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.ZIINA_TEST_MODE = 'true';
    process.env.RATEHAWK_BASE_URL = 'https://api-sandbox.ratehawk.com';
    process.env.RATEHAWK_KEY_ID = 'supplier-fixture';
    context.after(() => {
        if (previous === undefined) delete process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
        else process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = previous;
        if (testMode === undefined) delete process.env.ZIINA_TEST_MODE;
        else process.env.ZIINA_TEST_MODE = testMode;
        if (originalSupplier === undefined) delete process.env.RATEHAWK_BASE_URL;
        else process.env.RATEHAWK_BASE_URL = originalSupplier;
        if (originalKey === undefined) delete process.env.RATEHAWK_KEY_ID;
        else process.env.RATEHAWK_KEY_ID = originalKey;
    });
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });
    context.after(() => {
        if (descriptor) Object.defineProperty(mongoose.connection, 'readyState', descriptor);
        else delete mongoose.connection.readyState;
    });
    context.mock.method(payment, 'isCheckoutReady', () => true);
    let record;
    context.mock.method(store, 'findById', () => ({ lean: async () => record && structuredClone(record) }));
    context.mock.method(store, 'findOne', filter => ({ lean: async () => record?.reference === filter.reference ? structuredClone(record) : null }));
    context.mock.method(store, 'create', async value => {
        if (record) throw Object.assign(new Error('duplicate'), { code: 11000 });
        record = structuredClone(value);
        return structuredClone(record);
    });
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (!record || record._id !== filter._id || record.state !== filter.state) return null;
        Object.assign(record, structuredClone(update.$set));
        return structuredClone(record);
    } }));
    context.mock.method(store, 'updateOne', async (filter, update) => {
        if (record?._id !== filter._id || record.state !== filter.state) return { matchedCount: 0 };
        Object.assign(record, structuredClone(update.$set || {}));
        for (const field of Object.keys(update.$unset || {})) delete record[field];
        return { matchedCount: 1 };
    });
    const rateInfo = context.mock.method(ratehawk, 'getRateDetailsByHash', async hash => {
        assert.equal(hash, bookHash);
        return { original_request_params: { checkin: '2099-10-15', checkout: '2099-10-17',
            guests: [{ adults: 1, children: [5] }] },
        hotels: [{ hid: 123, rates: [{ room_name: 'Test Double Room', book_hash: bookHash,
            payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } }] }] };
    });
    context.mock.method(ratehawk, 'validatePrebookRate', async hash => {
        assert.equal(hash, 'fixture-hash');
        return { hotels: [{ hid: 123, rates: [{ room_name: 'Test Double Room', book_hash: 'fresh-hash',
            payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } }] }] };
    });
    const form = context.mock.method(booking, 'createProcess', async (request, reference) => {
        assert.equal(request.book_hash, formHash);
        assert.equal(request.user_ip, '192.0.2.10');
        assert.equal(request.guests[0].children[0], 5);
        assert.match(reference, /^[0-9a-f-]{36}$/);
        return { status: 'form_ready', process_id: 'f'.repeat(64), partner_order_id: 'partner-1',
            payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD', is_need_credit_card_data: false }],
            form_expires_at: new Date(Date.now() + 60 * 60 * 1000) };
    });
    const createIntent = context.mock.method(ziina, 'createIntent', async data => {
        assert.equal(data.test, process.env.ZIINA_TEST_MODE === 'true');
        assert.equal(data.currency, 'USD');
        assert.equal(data.amount, 107);
        return { id: 'fixture-intent', accountId: 'fixture-account', operationId: crypto.randomUUID(),
            redirectUrl: 'https://pay.ziina.com/test', status: 'pending' };
    });
    return { form, rateInfo, createIntent, get record() { return record; } };
}

async function bounded(operation, scenario) {
    const timeout = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`checkout_stalled state=${scenario.record?.state} form_calls=${scenario.form.mock.callCount()} intent_calls=${scenario.createIntent.mock.callCount()}`)), 2000);
        operation.finally(() => clearTimeout(timer)).catch(() => {});
    });
    return Promise.race([operation, timeout]);
}

test('preflight persists an encrypted, idempotent checkout and refuses changed retries', { timeout: 5000 }, async context => {
    const scenario = fixture(context);
    const { form, createIntent } = scenario;
    const key = crypto.randomUUID();
    const first = await bounded(checkout.createCheckout(details(), key, '192.0.2.10'), scenario);
    assert.equal(first.payment_url, 'https://pay.ziina.com/test');
    const second = await checkout.createCheckout(details(), key, '192.0.2.10');
    assert.equal(second.reference, first.reference);
    assert.match(second.access_token, /^[a-f\d]{64}$/);
    assert.deepEqual(await checkout.getCheckout(first.reference, first.access_token), {
        reference: first.reference, status: 'awaiting_payment', confirmed: false, payment_url: 'https://pay.ziina.com/test'
    });
    await assert.rejects(checkout.getCheckout(first.reference, '0'.repeat(64)), /checkout_not_found/);
    await assert.rejects(checkout.getCheckout('invalid', first.access_token), /checkout_not_found/);
    assert.equal(form.mock.callCount(), 1);
    assert.equal(createIntent.mock.callCount(), 1);
    assert.equal(scenario.record.partner_order_id, 'partner-1');
    assert.equal(scenario.record.ownerSubject, 'fixture-owner');
    await assert.rejects(checkoutService.createCheckout(details(), key, '192.0.2.10'), /unauthorized/);
    await assert.rejects(checkout.createCheckout(details(), key, '192.0.2.10', {
        role: 'user', subject: 'other-owner', realm: scenario.record.realm
    }), /checkout_conflict/);
    assert.equal(scenario.record.supplier_identity, payment.supplierIdentity());
    assert.equal(JSON.stringify(scenario.record).includes('test@example.com'), false);
    assert.equal(checkout.decryptDetails(scenario.record).user.email, 'test@example.com');
    await assert.rejects(checkout.createCheckout({ ...details(), total: 200 }, key, '192.0.2.10'), /checkout_conflict/);
    scenario.record.payment_expires_at = new Date(Date.now() - 1000);
    assert.equal((await checkout.getCheckout(first.reference, first.access_token)).payment_url, undefined);
    assert.equal(createIntent.mock.callCount(), 1);
});

test('a supplier-verified prebook hash proceeds to form without repeating hotel prebook', async context => {
    const scenario = fixture(context, { bookHash: 'p-fixture', formHash: 'p-fixture' });
    const prebook = context.mock.method(ratehawk, 'validatePrebookRate', async () => { throw new Error('must not re-prebook'); });
    const input = { ...details(), book_hash: 'p-fixture' };
    const result = await checkout.createCheckout(input, crypto.randomUUID(), '192.0.2.10');
    assert.equal(result.status, 'awaiting_payment');
    assert.equal(prebook.mock.callCount(), 0);
    assert.equal(scenario.rateInfo.mock.callCount(), 1);
    assert.equal(scenario.form.mock.callCount(), 1);
    assert.equal(scenario.createIntent.mock.callCount(), 1);
    const info = await scenario.rateInfo('p-fixture');
    assert.throws(() => checkout.verifyRateIdentity(info, checkout.normalizedCheckout({ ...input, total: 101 })), /RATE_CHANGED/);
    assert.equal(scenario.createIntent.mock.callCount(), 1);
});

test('unknown Ziina create outcome is held for review and not charged twice', { timeout: 5000 }, async context => {
    const scenario = fixture(context);
    const { createIntent } = scenario;
    createIntent.mock.mockImplementation(async () => { throw new Error('network uncertain'); });
    const key = crypto.randomUUID();
    const first = await checkout.createCheckout(details(), key, '192.0.2.10');
    assert.equal(first.status, 'intent_unknown');
    assert.match(first.access_token, /^[a-f\d]{64}$/);
    assert.equal(first.payment_url, undefined);
    const retry = await checkout.createCheckout(details(), key, '192.0.2.10');
    assert.equal(retry.reference, first.reference);
    assert.equal(retry.payment_url, undefined);
    assert.equal(createIntent.mock.callCount(), 1);
    assert.equal(scenario.record.state, 'intent_unknown');
});

test('preflight refuses price tampering or an expired supplier form before Ziina', { timeout: 5000 }, async context => {
    const scenario = fixture(context);
    const { form, createIntent } = scenario;
    const key = crypto.randomUUID();
    const input = { ...details(), total: 101 };
    await assert.rejects(checkout.createCheckout(input, key, '192.0.2.10'), /rate_changed/);
    const reference = scenario.record.reference;
    await assert.rejects(checkout.createCheckout(input, key, '192.0.2.10'), error => error.code === 'rate_changed' && error.httpStatus === 409);
    assert.equal(scenario.record.reference, reference);
    assert.equal(scenario.record.next_check_at, null);
    scenario.record.error = 'supplier_preflight_failed';
    await assert.rejects(checkout.createCheckout(input, key, '192.0.2.10'), error => error.code === 'supplier_preflight_failed' && error.httpStatus === 409);
    assert.equal(form.mock.callCount(), 0);
    assert.equal(createIntent.mock.callCount(), 0);
});

test('offer identity refuses changed dates, occupancy or a mismatched room before a payment intent', async context => {
    const scenario = fixture(context);
    const originalOffer = await scenario.rateInfo('fixture-hash');
    for (const mismatch of [
        { ...details(), guests: [{ adults: 2, children: [] }], rooms: [{ guests: [
            { firstName: 'Test', lastName: 'Guest' }, { firstName: 'Second', lastName: 'Guest' }
        ] }] },
        { ...details(), roomName: 'Other Room' }
    ]) {
        assert.throws(() => checkout.verifyRateIdentity(originalOffer, checkout.normalizedCheckout(mismatch)), /offer_identity_mismatch/);
    }
    await assert.rejects(checkout.createCheckout({ ...details(), checkout: '2099-10-18' }, crypto.randomUUID(), '192.0.2.10'), /offer_identity_mismatch/);
    assert.equal(scenario.createIntent.mock.callCount(), 0);
    assert.equal(scenario.form.mock.callCount(), 0);
});

test('production preflight persists live mode before submitting an intent', async context => {
    const scenario = fixture(context);
    process.env.ZIINA_TEST_MODE = 'false';
    const result = await checkout.createCheckout(details(), crypto.randomUUID(), '192.0.2.10');
    assert.equal(result.status, 'awaiting_payment');
    assert.equal(scenario.record.ziina_test, false);
    assert.equal(scenario.createIntent.mock.callCount(), 1);
});
