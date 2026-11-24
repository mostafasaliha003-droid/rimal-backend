const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// Placeholder keys, assembled so no key-shaped literal sits in the source.
const FIXTURE_TEST_KEY = ['sk', 'test', 'fixture-key-0000000000000000'].join('_');
const FIXTURE_LIVE_KEY = ['sk', 'fixture-live-0000000000000000'].join('_');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const booking = require('../services/bookingProcessService');
const ratehawk = require('../services/ratehawkService');
const payment = require('../services/paymentService');
const tabby = require('../services/tabbyClient');
const checkout = require('../services/checkoutProcessService');
const bookingPersistence = require('../services/ratehawkCheckoutBookingPersistence');

const ENV_KEYS = ['ZIINA_TEST_MODE', 'PAYMENT_BOOKING_ENCRYPTION_KEY', 'RATEHAWK_BASE_URL', 'RATEHAWK_KEY_ID',
    'TABBY_ENABLED', 'TABBY_SECRET_KEY', 'TABBY_MERCHANT_CODE', 'TABBY_WEBHOOK_SECRET'];
function environment(context, values = {}) {
    const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    Object.assign(process.env, { ZIINA_TEST_MODE: 'true', PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
        RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', RATEHAWK_KEY_ID: 'supplier-fixture',
        TABBY_ENABLED: 'true', TABBY_SECRET_KEY: FIXTURE_TEST_KEY,
        TABBY_MERCHANT_CODE: 'PillowStaysApp', TABBY_WEBHOOK_SECRET: 'w'.repeat(48), ...values });
    context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

const PAYMENT_ID = '01a20f2c-1930-8eaa-b80b-f694124ddddd';
function fixture(context) {
    environment(context);
    context.mock.method(bookingPersistence, 'persistConfirmedCheckout', async () => ({}));
    const id = crypto.randomUUID();
    const record = {
        _id: id, reference: crypto.randomUUID(), state: 'awaiting_payment', payment_provider: 'tabby',
        amount_minor: 45000, currency: 'AED', ziina_test: true, tabby_test: true, tabby_payment_id: PAYMENT_ID,
        supplier_identity: payment.supplierIdentity(),
        booking_process_id: 'b'.repeat(64), supplier_payment: { type: 'deposit', amount: '120.00', currency_code: 'USD' },
        form_expires_at: new Date(Date.now() + 40 * 60 * 1000), payment_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        encrypted_details: checkout.encryptDetails({ checkin: '2099-10-15', checkout: '2099-10-17',
            user: { email: 'otp.success@tabby.ai', phone: '+971500000001' },
            rooms: [{ guests: [{ first_name: 'Test', last_name: 'Guest', is_child: false }] }] }),
        next_check_at: new Date(0)
    };
    const matches = filter => filter._id === id && (!filter.state || filter.state === record.state)
        && (!filter.lease_id || filter.lease_id === record.lease_id)
        && (!filter.lease_until?.$gt || new Date(record.lease_until) > new Date(filter.lease_until.$gt));
    const apply = update => { Object.assign(record, structuredClone(update.$set || {})); for (const key of Object.keys(update.$unset || {})) delete record[key]; };
    context.mock.method(CheckoutAttempt, 'findById', key => ({ lean: async () => key === id ? structuredClone(record) : null }));
    context.mock.method(CheckoutAttempt, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (!matches(filter)) return null;
        if (filter.next_check_at?.$lte && new Date(record.next_check_at) > new Date(filter.next_check_at.$lte)) return null;
        if (record.lease_until && new Date(record.lease_until) > Date.now() && !filter.lease_id) return null;
        apply(update); return structuredClone(record);
    } }));
    context.mock.method(CheckoutAttempt, 'updateOne', async (filter, update) => {
        if (!matches(filter)) return { matchedCount: 0 };
        apply(update); return { matchedCount: 1 };
    });
    const remote = { id: PAYMENT_ID, status: 'CREATED', amount: '450', currency: 'AED', is_test: true,
        order: { reference_id: record.reference }, captures: [], refunds: [] };
    const getPayment = context.mock.method(tabby, 'getPayment', async () => structuredClone(remote));
    const capturePayment = context.mock.method(tabby, 'capturePayment', async ({ amount, referenceId }) => {
        remote.captures.push({ id: crypto.randomUUID(), amount: tabby.amountText(amount), reference_id: referenceId });
        remote.status = 'CLOSED';
        return structuredClone(remote);
    });
    const refundPayment = context.mock.method(tabby, 'refundPayment', async ({ amount, referenceId }) => {
        if (!remote.refunds.some(item => item.reference_id === referenceId)) remote.refunds.push({ id: crypto.randomUUID(), amount: tabby.amountText(amount), reference_id: referenceId });
        return structuredClone(remote);
    });
    const finishProcess = context.mock.method(booking, 'finishProcess', async () => ({ status: 'processing', partner_order_id: 'partner-fixture' }));
    context.mock.method(booking, 'checkProcess', async () => ({ process_id: record.booking_process_id, status: 'form_ready', partner_order_id: 'partner-fixture' }));
    context.mock.method(ratehawk, 'buildBookingFinish', () => ({}));
    context.mock.method(payment, 'isCheckoutReady', () => true);
    const reconcile = async () => { record.next_check_at = new Date(0); delete record.lease_until; await require('../services/checkoutReconciliationService').reconcileAttempt(id); };
    return { record, remote, getPayment, capturePayment, refundPayment, finishProcess, reconcile };
}

test('amounts, keys and checkout links are read strictly', context => {
    environment(context);
    assert.equal(tabby.amountMinor('450'), 45000);
    assert.equal(tabby.amountMinor('450.5'), 45050);
    assert.equal(tabby.amountMinor('450.05'), 45005);
    for (const bad of ['', '-1', '1.234', '1e3', 'abc', null]) assert.equal(tabby.amountMinor(bad), null);
    assert.equal(tabby.amountText(45005), '450.05');
    assert.equal(tabby.isTabbyReady(), true);
    // A live key in the sandbox (or the reverse) is never offered.
    process.env.TABBY_SECRET_KEY = FIXTURE_LIVE_KEY;
    assert.equal(tabby.isTabbyReady(), false);
    process.env.TABBY_SECRET_KEY = FIXTURE_TEST_KEY;
    process.env.TABBY_WEBHOOK_SECRET = 'short';
    assert.equal(tabby.isTabbyReady(), false);
    assert.equal(tabby.checkoutUrl('https://checkout.tabby.ai/?sessionId=1'), 'https://checkout.tabby.ai/?sessionId=1');
    for (const bad of ['http://checkout.tabby.ai/', 'https://tabby.ai.evil.example/', 'https://evil-tabby.ai/', 'https://u:p@checkout.tabby.ai/']) assert.equal(tabby.checkoutUrl(bad), null);
    assert.equal(tabby.verifyWebhook('x'.repeat(40), 'x'.repeat(40)), true);
    assert.equal(tabby.verifyWebhook('y'.repeat(40), 'x'.repeat(40)), false);
    assert.equal(tabby.verifyWebhook(undefined, 'x'.repeat(40)), false);
});

test('a session carries the stay, the AED total and the app return links; a rejection is reported with its reason', async context => {
    environment(context);
    const sent = [];
    const fetcher = async (url, init) => {
        sent.push({ url, init, body: JSON.parse(init.body) });
        const rejected = sent.length > 1;
        return new Response(JSON.stringify({ id: crypto.randomUUID(), status: rejected ? 'rejected' : 'created',
            payment: { id: PAYMENT_ID, status: 'CREATED', is_test: true },
            configuration: { available_products: rejected ? {} : { installments: [{ web_url: 'https://checkout.tabby.ai/?sessionId=abc' }] },
                products: { installments: { rejection_reason: rejected ? 'order_amount_too_high' : null } } } }), { status: 200 });
    };
    const input = { reference: 'ref-1', amount: 45000, language: 'ar', buyer: { name: 'Test Guest', email: 'otp.success@tabby.ai', phone: '+971500000001' },
        registeredSince: '2026-01-01T00:00:00.000Z', hotel: { hid: 7, name: 'Fixture Hotel', address: 'Sheikh Zayed Road', city: 'Dubai', countryCode: 'AE' },
        stay: { checkin: '2099-10-15', checkout: '2099-10-17', rooms: 1 }, roomName: 'Deluxe King', passengers: [{ first_name: 'Test', last_name: 'Guest' }],
        returnUrls: { success: 'https://x.example/s', cancel: 'https://x.example/c', failure: 'https://x.example/f' }, fetcher };
    const created = await tabby.createSession(input);
    assert.deepEqual({ status: created.status, paymentId: created.paymentId, webUrl: created.webUrl }, { status: 'created', paymentId: PAYMENT_ID, webUrl: 'https://checkout.tabby.ai/?sessionId=abc' });
    const { body, init } = sent[0];
    assert.equal(init.headers.Authorization, `Bearer ${FIXTURE_TEST_KEY}`);
    assert.equal(body.payment.amount, '450.00');
    assert.equal(body.payment.currency, 'AED');
    assert.equal(body.payment.order.items[0].unit_price, '450.00');
    assert.equal(body.merchant_code, 'PillowStaysApp');
    assert.equal(body.lang, 'ar');
    assert.deepEqual(body.merchant_urls, input.returnUrls);
    assert.equal(JSON.parse(body.payment.attachment.body).hotel_reservation_details.hotel_itinerary[0].hotel_city, 'Dubai');
    const rejected = await tabby.createSession(input);
    assert.deepEqual({ status: rejected.status, reason: rejected.rejectionReason }, { status: 'rejected', reason: 'order_amount_too_high' });
});

test('an authorized Tabby payment is captured once in full, then the hotel is booked', async context => {
    const scenario = fixture(context);
    await scenario.reconcile();
    assert.equal(scenario.record.state, 'awaiting_payment');
    assert.equal(scenario.capturePayment.mock.callCount(), 0);
    scenario.remote.status = 'AUTHORIZED';
    await scenario.reconcile();
    assert.equal(scenario.capturePayment.mock.callCount(), 1);
    assert.deepEqual(scenario.capturePayment.mock.calls[0].arguments[0], { id: PAYMENT_ID, amount: 45000, referenceId: `capture-${scenario.record.reference}` });
    assert.equal(scenario.record.state, 'payment_verified');
    await scenario.reconcile();
    assert.equal(scenario.record.state, 'booking_pending');
    await scenario.reconcile();
    assert.equal(scenario.finishProcess.mock.callCount(), 1);
    assert.equal(scenario.capturePayment.mock.callCount(), 1);
    assert.equal(scenario.refundPayment.mock.callCount(), 0);
});

test('a capture that does not answer is retried with the same reference; nothing is booked meanwhile', async context => {
    const scenario = fixture(context);
    scenario.remote.status = 'AUTHORIZED';
    scenario.capturePayment.mock.mockImplementationOnce(async () => { throw Object.assign(new Error('tabby_request_failed'), { httpStatus: 409 }); });
    await scenario.reconcile();
    assert.equal(scenario.record.state, 'awaiting_payment');
    assert.equal(scenario.record.error, 'payment_capture_pending');
    assert.equal(scenario.finishProcess.mock.callCount(), 0);
    await scenario.reconcile();
    assert.equal(scenario.record.state, 'payment_verified');
    assert.equal(scenario.capturePayment.mock.calls[1].arguments[0].referenceId, `capture-${scenario.record.reference}`);
});

test('rejected, expired and cancelled checkouts end the attempt without booking; a mismatch goes to a person', async context => {
    for (const [status, error] of [['REJECTED', 'tabby_rejected'], ['EXPIRED', 'tabby_expired'], ['CLOSED', 'tabby_closed']]) {
        await context.test(status, async inner => {
            const scenario = fixture(inner);
            scenario.remote.status = status;
            await scenario.reconcile();
            assert.equal(scenario.record.state, 'payment_failed');
            assert.equal(scenario.record.error, error);
            assert.equal(scenario.record.encrypted_details, undefined);
            assert.deepEqual(checkout.publicView(scenario.record), { reference: scenario.record.reference, status: 'payment_failed', confirmed: false,
                payment_method: 'tabby', payment_error: error });
        });
    }
    await context.test('amount mismatch', async inner => {
        const scenario = fixture(inner);
        scenario.remote.status = 'AUTHORIZED';
        scenario.remote.amount = '449.99';
        await scenario.reconcile();
        assert.equal(scenario.record.state, 'manual_review');
        assert.equal(scenario.capturePayment.mock.callCount(), 0);
    });
    await context.test('live key on a sandbox attempt', async inner => {
        const scenario = fixture(inner);
        process.env.TABBY_SECRET_KEY = FIXTURE_LIVE_KEY;
        scenario.remote.status = 'AUTHORIZED';
        await scenario.reconcile();
        assert.equal(scenario.record.state, 'manual_review');
        assert.equal(scenario.capturePayment.mock.callCount(), 0);
    });
});

test('a failed hotel booking refunds the whole Tabby payment once, and only a recorded refund completes it', async context => {
    const scenario = fixture(context);
    Object.assign(scenario.record, { state: 'booking_failed', payment_verified_at: new Date(), encrypted_notification: scenario.record.encrypted_details });
    Object.assign(scenario.remote, { status: 'CLOSED', captures: [{ id: 'c1', amount: '450.00', reference_id: 'capture-x' }] });
    await scenario.reconcile();
    assert.equal(scenario.refundPayment.mock.callCount(), 1);
    const sent = scenario.refundPayment.mock.calls[0].arguments[0];
    assert.equal(sent.amount, 45000);
    assert.equal(sent.referenceId, scenario.record.refund_id);
    assert.equal(scenario.record.state, 'refund_pending');
    await scenario.reconcile();
    assert.equal(scenario.record.state, 'refund_completed');
    assert.equal(scenario.refundPayment.mock.callCount(), 1);
});

test('an unknown refund outcome asks again with the same reference; a refusal goes to a person', async context => {
    await context.test('unknown then settled', async inner => {
        const scenario = fixture(inner);
        Object.assign(scenario.record, { state: 'booking_failed', payment_verified_at: new Date() });
        Object.assign(scenario.remote, { status: 'CLOSED', captures: [{ id: 'c1', amount: '450.00', reference_id: 'capture-x' }] });
        scenario.refundPayment.mock.mockImplementationOnce(async () => { throw new Error('tabby_request_failed'); });
        await scenario.reconcile();
        assert.equal(scenario.record.state, 'refund_unknown');
        const reference = scenario.record.refund_id;
        await scenario.reconcile();
        assert.equal(scenario.refundPayment.mock.callCount(), 2);
        assert.equal(scenario.refundPayment.mock.calls[1].arguments[0].referenceId, reference);
        assert.equal(scenario.record.state, 'refund_pending');
        await scenario.reconcile();
        assert.equal(scenario.record.state, 'refund_completed');
    });
    await context.test('refused', async inner => {
        const scenario = fixture(inner);
        Object.assign(scenario.record, { state: 'booking_failed', payment_verified_at: new Date() });
        scenario.refundPayment.mock.mockImplementationOnce(async () => { throw Object.assign(new Error('tabby_request_failed'), { httpStatus: 409 }); });
        await scenario.reconcile();
        assert.equal(scenario.record.state, 'refund_review');
        assert.equal(scenario.record.action_required, 'refund_failed');
    });
});

function response() {
    const res = { statusCode: 200, headers: {}, body: null };
    res.set = (key, value) => { if (typeof key === 'object') Object.assign(res.headers, key); else res.headers[key] = value; return res; };
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.body = body; return res; };
    return res;
}

test('a webhook only wakes the reconciler, and only with the shared header', async context => {
    environment(context);
    const updates = { calls: [] };
    const Model = { updateOne: async (...args) => { updates.calls.push(args); return { matchedCount: 1 }; } };
    const receiveTabbyWebhook = require('../services/tabbyRoutes').createTabbyWebhookHandler({ database: { readyState: 1 }, Model });
    const request = (header, body) => ({ get: name => name === tabby.WEBHOOK_HEADER ? header : undefined, body });
    let res = response();
    await receiveTabbyWebhook(request('nope', { id: PAYMENT_ID, status: 'authorized' }), res);
    assert.equal(res.statusCode, 401);
    res = response();
    await receiveTabbyWebhook(request('w'.repeat(48), { id: 'not-an-id' }), res);
    assert.equal(res.statusCode, 400);
    res = response();
    await receiveTabbyWebhook(request('w'.repeat(48), { id: PAYMENT_ID, status: 'closed', amount: '1.00' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(updates.calls.length, 1);
    assert.equal(updates.calls[0][0].tabby_payment_id, PAYMENT_ID);
    assert.deepEqual(updates.calls[0][1], { $set: { next_check_at: new Date(0) } });
});

test('pre-scoring hides Tabby when it would refuse, and never blocks on its own failure', async context => {
    environment(context);
    const { tabbyEligibility } = require('../services/tabbyRoutes');
    const body = { amount: '450.00', currency: 'AED', email: 'otp.success@tabby.ai', phone: '+971500000002', language: 'ar' };
    let res = response();
    await tabbyEligibility({ body: { ...body, currency: 'USD' } }, res);
    assert.equal(res.statusCode, 400);
    const prescore = context.mock.method(tabby, 'prescore', async () => ({ available: false, reason: 'not_available' }));
    res = response();
    await tabbyEligibility({ body }, res);
    assert.deepEqual(res.body, { success: true, available: false, checked: true, reason: 'not_available' });
    assert.equal(prescore.mock.calls[0].arguments[0].amount, 45000);
    prescore.mock.mockImplementation(async () => { throw new Error('tabby_request_failed'); });
    res = response();
    await tabbyEligibility({ body }, res);
    assert.deepEqual(res.body, { success: true, available: true, checked: false });
});
