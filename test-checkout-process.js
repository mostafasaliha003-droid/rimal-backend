const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const store = require('./models/CheckoutAttempt');
const checkout = require('./services/checkoutProcessService');
const booking = require('./services/bookingProcessService');
const ratehawk = require('./services/ratehawkService');
const payment = require('./services/paymentService');
const ziina = require('./services/ziinaClient');

const details = () => ({
    hid: 123, book_hash: 'fixture-hash', roomName: 'Test Double Room',
    checkin: '2099-10-15', checkout: '2099-10-17', currency: 'USD', total: 100,
    guests: [{ adults: 1, children: [5] }],
    guest: { firstName: 'Test', lastName: 'Guest', email: 'test@example.com', phone: '+971500000000' },
    rooms: [{ guests: [
        { firstName: 'Test', lastName: 'Guest', is_child: false },
        { firstName: 'Test', lastName: 'Child', is_child: true, age: 5 }
    ] }]
});

function fixture(context) {
    const previous = process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
    const testMode = process.env.ZIINA_TEST_MODE;
    process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.ZIINA_TEST_MODE = 'true';
    context.after(() => {
        if (previous === undefined) delete process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
        else process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = previous;
        if (testMode === undefined) delete process.env.ZIINA_TEST_MODE;
        else process.env.ZIINA_TEST_MODE = testMode;
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
        assert.equal(hash, 'fixture-hash');
        return { original_request_params: { checkin: '2099-10-15', checkout: '2099-10-17',
            guests: [{ adults: 1, children: [5] }] },
        hotels: [{ hid: 123, rates: [{ room_name: 'Test Double Room', book_hash: 'fixture-hash',
            payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } }] }] };
    });
    context.mock.method(ratehawk, 'validatePrebookRate', async hash => {
        assert.equal(hash, 'fixture-hash');
        return { hotels: [{ hid: 123, rates: [{ room_name: 'Test Double Room', book_hash: 'fresh-hash',
            payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } }] }] };
    });
    const form = context.mock.method(booking, 'createProcess', async (request, reference) => {
        assert.equal(request.book_hash, 'fresh-hash');
        assert.equal(request.user_ip, '192.0.2.10');
        assert.equal(request.guests[0].children[0], 5);
        assert.match(reference, /^[0-9a-f-]{36}$/);
        return { status: 'form_ready', process_id: 'f'.repeat(64), partner_order_id: 'partner-1',
            payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD', is_need_credit_card_data: false }],
            form_expires_at: new Date(Date.now() + 60 * 60 * 1000) };
    });
    const createIntent = context.mock.method(ziina, 'createIntent', async data => {
        assert.equal(data.test, true);
        assert.equal(data.currency, 'USD');
        assert.equal(data.amount, 100);
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
        reference: first.reference, status: 'awaiting_payment', confirmed: false
    });
    await assert.rejects(checkout.getCheckout(first.reference, '0'.repeat(64)), /checkout_not_found/);
    await assert.rejects(checkout.getCheckout('invalid', first.access_token), /checkout_not_found/);
    assert.equal(form.mock.callCount(), 1);
    assert.equal(createIntent.mock.callCount(), 1);
    assert.equal(JSON.stringify(scenario.record).includes('test@example.com'), false);
    assert.equal(checkout.decryptDetails(scenario.record).user.email, 'test@example.com');
    await assert.rejects(checkout.createCheckout({ ...details(), total: 200 }, key, '192.0.2.10'), /checkout_conflict/);
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
    const { form, createIntent } = fixture(context);
    await assert.rejects(checkout.createCheckout({ ...details(), total: 101 }, crypto.randomUUID(), '192.0.2.10'), /rate_changed/);
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