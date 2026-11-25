const { test } = require('node:test');
const assert = require('node:assert/strict');
const CheckoutAttempt = require('./models/CheckoutAttempt');
const BookingCancellation = require('./models/BookingCancellation');
const BookingProcess = require('./models/BookingProcess');
const ratehawk = require('./services/ratehawkService');
const payment = require('./services/paymentService');
const postBooking = require('./services/postBookingService');

// Assembled at runtime so no key-shaped literal sits in the repository.
const fixtureKey = ['sk', 'test', 'fixture0000000000000000000000'].join('_');
const tabbyEnv = {
    TABBY_ENABLED: 'true', TABBY_SECRET_KEY: fixtureKey, TABBY_MERCHANT_CODE: 'FixtureMerchant',
    TABBY_WEBHOOK_SECRET: 'w'.repeat(40), ZIINA_TEST_MODE: 'true'
};

function withEnv(context, values) {
    const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    context.after(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

test('refunds are routed back the way the guest paid', () => {
    const tabbyPaid = { payment_provider: 'tabby', tabby_payment_id: 'pay-1', tabby_test: true, ziina_test: true };
    assert.equal(postBooking.refundRouteReady(tabbyPaid, tabbyEnv), true);
    // A Tabby payment never needs Ziina: that was the cause of the 503 on 25 Nov 2026.
    assert.equal(postBooking.refundRouteReady(tabbyPaid, { ...tabbyEnv, ZIINA_REFUNDS_ENABLED: 'false' }), true);
    assert.equal(postBooking.refundRouteReady({ ...tabbyPaid, tabby_payment_id: undefined }, tabbyEnv), false);
    assert.equal(postBooking.refundRouteReady(tabbyPaid, { ...tabbyEnv, TABBY_ENABLED: 'false' }), false);
    assert.equal(postBooking.refundRouteReady({ ...tabbyPaid, tabby_test: false }, tabbyEnv), false);
    assert.equal(postBooking.refundRouteReady(tabbyPaid, { ...tabbyEnv, ZIINA_TEST_MODE: 'false' }), false);
    // Card payments keep the Ziina rules.
    assert.equal(postBooking.refundRouteReady({ ziina_test: true, ziina_account_id: 'acct' }, tabbyEnv), false);
});

test('a Tabby-paid booking cancels and hands the refund to the reconciler', async context => {
    withEnv(context, { ...tabbyEnv, RATEHAWK_CANCELLATION_ENABLED: 'true', ZIINA_REFUNDS_ENABLED: 'false',
        RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', RATEHAWK_KEY_ID: 'supplier-fixture' });
    const checkout = {
        _id: 'checkout-tabby', partner_order_id: 'partner-tabby', state: 'booking_confirmed', payment_provider: 'tabby',
        tabby_payment_id: 'pay-1', tabby_test: true, ziina_test: true, payment_verified_at: new Date(),
        amount_minor: 18862, currency: 'AED', notification_status: 'sent',
        supplier_identity: payment.supplierIdentity(), booking_process_id: 'process-tabby',
        prebook_snapshot: { version: 1, room_name: 'Junior Suite', checkin: '2099-11-29', checkout: '2099-11-30',
            payment: { type: 'deposit', amount: '188.62', currency_code: 'AED' }, upsells: [],
            cancellation_info: { policies: [{ start_at: null, end_at: null, penalty: { amount: '0.00', currency_code: 'AED' } }] } }
    };
    let cancellation;
    context.mock.method(CheckoutAttempt, 'find', () => ({ limit: () => ({ lean: async () => [structuredClone(checkout)] }) }));
    context.mock.method(CheckoutAttempt, 'findById', () => ({ lean: async () => structuredClone(checkout) }));
    context.mock.method(CheckoutAttempt, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter._id !== checkout._id || filter.state !== checkout.state || checkout.cancellation_request_hash) return null;
        Object.assign(checkout, update.$set);
        return structuredClone(checkout);
    } }));
    context.mock.method(CheckoutAttempt, 'updateOne', async (filter, update) => {
        if (filter._id !== checkout._id || filter.state !== checkout.state) return { matchedCount: 0 };
        Object.assign(checkout, update.$set);
        return { matchedCount: 1 };
    });
    context.mock.method(BookingCancellation, 'findById', () => ({ lean: async () => cancellation && structuredClone(cancellation) }));
    context.mock.method(BookingCancellation, 'create', async data => { cancellation = structuredClone(data); });
    context.mock.method(BookingCancellation, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (cancellation.state !== filter.state) return null;
        Object.assign(cancellation, update.$set);
        return structuredClone(cancellation);
    } }));
    const savedProcess = { state: 'confirmed' };
    context.mock.method(BookingProcess, 'findOne', () => ({ lean: async () => savedProcess }));
    context.mock.method(BookingProcess, 'updateOne', async (_filter, update) => { Object.assign(savedProcess, update.$set); return { matchedCount: 1 }; });
    context.mock.method(ratehawk, 'getOrderInfo', async () => assert.fail('Cancellation must use the saved prebook'));
    const submit = context.mock.method(ratehawk, 'submitCancellation', async () => ({ success: true, pending: false, status: 'cancelled' }));

    const result = await postBooking.cancelBooking('partner-tabby', { confirm_cancellation: true,
        expected_penalty: { amount: '0.00', currency_code: 'AED' },
        confirm_customer_refund: true, customer_refund: { amount: '188.62', currency_code: 'AED' } });
    assert.equal(submit.mock.callCount(), 1);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.customer_refund_status, 'pending');
    assert.equal(checkout.state, 'booking_cancelled');
    assert.equal(checkout.refund_amount_minor, 18862);
    assert.equal(cancellation.customer_refund_amount_minor, 18862);
});
