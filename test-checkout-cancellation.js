const { test } = require('node:test');
const assert = require('node:assert/strict');
const CheckoutAttempt = require('./models/CheckoutAttempt');
const BookingCancellation = require('./models/BookingCancellation');
const BookingProcess = require('./models/BookingProcess');
const ratehawk = require('./services/ratehawkService');
const payment = require('./services/paymentService');
const postBooking = require('./services/postBookingService');

test('Ziina-backed cancellation requires a bounded customer refund and waits for supplier confirmation', async context => {
    const original = process.env.RATEHAWK_CANCELLATION_ENABLED;
    const saved = Object.fromEntries(['ZIINA_REFUNDS_ENABLED', 'ZIINA_TEST_MODE', 'ZIINA_API_KEY', 'ZIINA_ACCOUNT_ID']
        .map(key => [key, process.env[key]]));
    const supplierSaved = Object.fromEntries(['RATEHAWK_BASE_URL', 'RATEHAWK_KEY_ID'].map(key => [key, process.env[key]]));
    process.env.RATEHAWK_CANCELLATION_ENABLED = 'true';
    process.env.ZIINA_REFUNDS_ENABLED = 'true';
    process.env.ZIINA_TEST_MODE = 'false';
    process.env.ZIINA_API_KEY = 'fixture-api-key';
    process.env.ZIINA_ACCOUNT_ID = 'fixture-account';
    process.env.RATEHAWK_BASE_URL = 'https://api.ratehawk.com';
    process.env.RATEHAWK_KEY_ID = 'supplier-fixture';
    context.after(() => {
        if (original === undefined) delete process.env.RATEHAWK_CANCELLATION_ENABLED;
        else process.env.RATEHAWK_CANCELLATION_ENABLED = original;
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        for (const [key, value] of Object.entries(supplierSaved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
    const checkout = {
        _id: 'checkout-fixture', partner_order_id: 'partner-fixture', state: 'booking_confirmed',
        ziina_intent_id: 'intent-fixture', ziina_account_id: 'fixture-account', payment_verified_at: new Date(), amount_minor: 10000,
        currency: 'USD', ziina_test: false, notification_status: 'voucher_pending',
        supplier_identity: payment.supplierIdentity()
    };
    let cancellation;
    context.mock.method(CheckoutAttempt, 'find', () => ({ limit: () => ({ lean: async () => [structuredClone(checkout)] }) }));
    context.mock.method(CheckoutAttempt, 'findById', () => ({ lean: async () => structuredClone(checkout) }));
    context.mock.method(CheckoutAttempt, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter._id !== checkout._id || filter.partner_order_id !== checkout.partner_order_id
            || filter.state !== checkout.state || checkout.notification_status === 'sending'
            || checkout.cancellation_request_hash
            || (checkout.lease_until && checkout.lease_until > Date.now())) return null;
        Object.assign(checkout, update.$set);
        return structuredClone(checkout);
    } }));
    context.mock.method(CheckoutAttempt, 'updateOne', async (filter, update) => {
        if (filter._id !== checkout._id || filter.state !== checkout.state
            || filter.cancellation_request_hash && filter.cancellation_request_hash !== checkout.cancellation_request_hash) {
            return { matchedCount: 0 };
        }
        Object.assign(checkout, update.$set);
        for (const field of Object.keys(update.$unset || {})) delete checkout[field];
        return { matchedCount: 1 };
    });
    context.mock.method(BookingCancellation, 'findById', () => ({ lean: async () => cancellation && structuredClone(cancellation) }));
    context.mock.method(BookingCancellation, 'create', async data => { cancellation = structuredClone(data); });
    context.mock.method(BookingCancellation, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (cancellation.state !== filter.state) return null;
        Object.assign(cancellation, update.$set);
        return structuredClone(cancellation);
    } }));
    context.mock.method(BookingProcess, 'updateOne', async () => ({ matchedCount: 1 }));
    context.mock.method(ratehawk, 'getOrderInfo', async () => ({ success: true, pending: false, status: 'completed',
        isCancellable: true, upsells: [], order: { cancellation_info: { policies: [
            { start_at: null, end_at: null, penalty: { amount: '0.00', currency_code: 'USD' } }
        ] } } }));
    const submit = context.mock.method(ratehawk, 'submitCancellation', async () => ({
        success: true, pending: false, status: 'cancelled'
    }));
    const request = { confirm_cancellation: true, expected_penalty: { amount: '0.00', currency_code: 'USD' },
        confirm_customer_refund: true, customer_refund: { amount: '100.00', currency_code: 'USD' } };
    process.env.RATEHAWK_KEY_ID = 'wrong-supplier';
    await assert.rejects(postBooking.cancelBooking('partner-fixture', request), /supplier_environment_mismatch/);
    process.env.RATEHAWK_KEY_ID = 'supplier-fixture';
    await assert.rejects(postBooking.cancelBooking('partner-fixture', { ...request, customer_refund: undefined }), /customer_refund_authorization_required/);
    await assert.rejects(postBooking.cancelBooking('partner-fixture', { ...request, customer_refund: { amount: '100.01', currency_code: 'USD' } }), /invalid_customer_refund_amount/);
    assert.equal(submit.mock.callCount(), 0);
    checkout.lease_until = new Date(Date.now() + 120000);
    await assert.rejects(postBooking.cancelBooking('partner-fixture', request), /confirmation_delivery_pending/);
    assert.equal(submit.mock.callCount(), 0);
    delete checkout.lease_until;
    const result = await postBooking.cancelBooking('partner-fixture', request);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.customer_refund_status, 'pending');
    assert.equal(checkout.state, 'booking_cancelled');
    assert.equal(checkout.refund_id, undefined);
    assert.equal(cancellation.customer_refund_amount_minor, 10000);
    assert.equal(cancellation.checkout_attempt_id, checkout._id);
    assert.equal(checkout.cancellation_request_hash, cancellation.request_hash);
    assert.ok(new Date(checkout.next_check_at).getTime() <= Date.now() + 1000);
    await postBooking.cancelBooking('partner-fixture', request);
    assert.equal(submit.mock.callCount(), 1);
    assert.equal((await postBooking.checkCancellation('partner-fixture')).customer_refund_status, 'pending');
    assert.equal(submit.mock.callCount(), 1);
    await assert.rejects(postBooking.cancelBooking('partner-fixture', { ...request,
        customer_refund: { amount: '99.00', currency_code: 'USD' } }), /cancellation_request_conflict/);
    cancellation = undefined;
    checkout.state = 'booking_confirmed';
    checkout.notification_status = 'voucher_pending';
    checkout.next_check_at = null;
    delete checkout.cancellation_request_hash;
    submit.mock.mockImplementation(async () => ({ success: false, pending: false, error: 'order_not_cancellable' }));
    const rejected = await postBooking.cancelBooking('partner-fixture', request);
    assert.equal(rejected.status, 'cancel_failed');
    assert.equal(rejected.action_required, 'review_cancellation_rejection');
    assert.equal(checkout.state, 'booking_confirmed');
    assert.equal(checkout.cancellation_request_hash, cancellation.request_hash);
    assert.equal(checkout.next_check_at, null);
    assert.equal((await postBooking.checkCancellation('partner-fixture')).status, 'cancel_failed');
    assert.equal(submit.mock.callCount(), 2);
});

test('supplier cancellation cannot trigger a refund without the checkout consent claim', async context => {
    const postBooking = require('./services/postBookingService');
    context.mock.method(payment, 'supplierIdentity', () => 'supplier-fixture-identity');
    const checkout = { _id: 'checkout-fixture', partner_order_id: 'partner-fixture', state: 'booking_confirmed',
        payment_verified_at: new Date(), amount_minor: 10000, supplier_identity: payment.supplierIdentity() };
    const cancellation = { _id: 'partner-fixture', state: 'cancelled', request_hash: 'consent-fixture',
        checkout_attempt_id: checkout._id, customer_refund_amount_minor: 4000 };
    context.mock.method(BookingCancellation, 'findById', () => ({ lean: async () => cancellation }));
    context.mock.method(CheckoutAttempt, 'findById', () => ({ lean: async () => checkout }));
    const update = context.mock.method(CheckoutAttempt, 'updateOne', async () => ({ matchedCount: 1 }));
    context.mock.method(BookingProcess, 'updateOne', async () => ({ matchedCount: 1 }));
    await assert.rejects(postBooking.checkCancellation('partner-fixture'), /customer_refund_link_mismatch/);
    assert.equal(update.mock.callCount(), 0);
});

test('pending checkout cancellation never queries a different supplier account after restart', async context => {
    const originalSupplier = process.env.RATEHAWK_BASE_URL;
    const originalKey = process.env.RATEHAWK_KEY_ID;
    process.env.RATEHAWK_BASE_URL = 'https://api.ratehawk.com';
    process.env.RATEHAWK_KEY_ID = 'supplier-fixture';
    const fingerprint = payment.supplierIdentity();
    context.after(() => {
        if (originalSupplier === undefined) delete process.env.RATEHAWK_BASE_URL;
        else process.env.RATEHAWK_BASE_URL = originalSupplier;
        if (originalKey === undefined) delete process.env.RATEHAWK_KEY_ID;
        else process.env.RATEHAWK_KEY_ID = originalKey;
    });
    const cancellation = { _id: 'partner-fixture', state: 'cancel_pending', request_hash: 'consent-fixture',
        checkout_attempt_id: 'checkout-fixture', next_check_at: new Date(0) };
    context.mock.method(BookingCancellation, 'findById', () => ({ lean: async () => cancellation }));
    context.mock.method(BookingCancellation, 'findOneAndUpdate', () => ({ lean: async () => cancellation }));
    const checkout = { _id: 'checkout-fixture', partner_order_id: 'partner-fixture', supplier_identity: fingerprint,
        cancellation_request_hash: 'consent-fixture' };
    context.mock.method(CheckoutAttempt, 'findById', () => ({ lean: async () => checkout }));
    const getOrder = context.mock.method(ratehawk, 'getOrderInfo', async () => ({ pending: true, success: true }));
    process.env.RATEHAWK_KEY_ID = 'different-supplier';
    await assert.rejects(postBooking.checkCancellation('partner-fixture'), /supplier_environment_mismatch/);
    assert.equal(getOrder.mock.callCount(), 0);
});