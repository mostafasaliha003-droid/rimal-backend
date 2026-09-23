const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const CheckoutAttempt = require('./models/CheckoutAttempt');
const BookingCancellation = require('./models/BookingCancellation');
const booking = require('./services/bookingProcessService');
const ratehawk = require('./services/ratehawkService');
const payment = require('./services/paymentService');
const ziina = require('./services/ziinaClient');
const checkout = require('./services/checkoutProcessService');
const notification = require('./services/notificationService');

function fixture(context) {
    const previousAccountId = process.env.ZIINA_ACCOUNT_ID;
    const previousTestMode = process.env.ZIINA_TEST_MODE;
    const previousEncryptionKey = process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
    const previousSupplierUrl = process.env.RATEHAWK_BASE_URL;
    const previousSupplierKeyId = process.env.RATEHAWK_KEY_ID;
    process.env.ZIINA_ACCOUNT_ID = 'account-fixture';
    process.env.ZIINA_TEST_MODE = 'true';
    process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.RATEHAWK_BASE_URL = 'https://api-sandbox.ratehawk.com';
    process.env.RATEHAWK_KEY_ID = 'supplier-fixture';
    context.after(() => {
        if (previousAccountId === undefined) delete process.env.ZIINA_ACCOUNT_ID;
        else process.env.ZIINA_ACCOUNT_ID = previousAccountId;
        if (previousTestMode === undefined) delete process.env.ZIINA_TEST_MODE;
        else process.env.ZIINA_TEST_MODE = previousTestMode;
        if (previousEncryptionKey === undefined) delete process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
        else process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = previousEncryptionKey;
        if (previousSupplierUrl === undefined) delete process.env.RATEHAWK_BASE_URL;
        else process.env.RATEHAWK_BASE_URL = previousSupplierUrl;
        if (previousSupplierKeyId === undefined) delete process.env.RATEHAWK_KEY_ID;
        else process.env.RATEHAWK_KEY_ID = previousSupplierKeyId;
    });
    const id = crypto.randomUUID();
    const record = {
        _id: id, reference: crypto.randomUUID(), state: 'awaiting_payment',
        amount_minor: 10000, currency: 'USD', ziina_test: true,
        ziina_intent_id: 'intent-fixture', ziina_account_id: 'account-fixture', ziina_operation_id: 'operation-fixture',
        supplier_identity: payment.supplierIdentity(),
        booking_process_id: 'b'.repeat(64), supplier_payment: { type: 'deposit', amount: '100.00', currency_code: 'USD' },
        form_expires_at: new Date(Date.now() + 40 * 60 * 1000), payment_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        encrypted_details: checkout.encryptDetails({
            checkin: '2099-10-15', checkout: '2099-10-17',
            user: { email: 'test@example.com', phone: '+971500000000' },
            rooms: [{ guests: [{ first_name: 'Test', last_name: 'Guest', is_child: false }] }]
        }), next_check_at: new Date(0)
    };
    context.mock.method(CheckoutAttempt, 'findById', key => ({ lean: async () => key === id ? structuredClone(record) : null }));
    context.mock.method(CheckoutAttempt, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter._id !== id || (filter.state && filter.state !== record.state)
            || (filter.lease_id && filter.lease_id !== record.lease_id)
            || (filter.lease_until?.$gt && new Date(record.lease_until) <= new Date(filter.lease_until.$gt))
            || (filter.notification_status && filter.notification_status !== record.notification_status)
            || (filter.cancellation_request_hash?.$exists === false && Object.hasOwn(record, 'cancellation_request_hash'))) return null;
        if (filter.next_check_at?.$lte && new Date(record.next_check_at) > new Date(filter.next_check_at.$lte)) return null;
        if (record.lease_until && new Date(record.lease_until) > Date.now() && !filter.lease_id) return null;
        Object.assign(record, structuredClone(update.$set || {}));
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return structuredClone(record);
    } }));
    context.mock.method(CheckoutAttempt, 'updateOne', async (filter, update) => {
        if (filter._id !== id || (filter.state && filter.state !== record.state)
            || (filter.lease_id && filter.lease_id !== record.lease_id)
            || (filter.lease_until?.$gt && new Date(record.lease_until) <= new Date(filter.lease_until.$gt))
            || (filter.cancellation_request_hash?.$exists === false && Object.hasOwn(record, 'cancellation_request_hash'))) {
            return { matchedCount: 0 };
        }
        Object.assign(record, structuredClone(update.$set || {}));
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return { matchedCount: 1 };
    });
    const intent = { id: record.ziina_intent_id, account_id: record.ziina_account_id, operation_id: record.ziina_operation_id,
        amount: record.amount_minor, currency_code: record.currency, tip_amount: 0, status: 'pending', test: true };
    const getIntent = context.mock.method(ziina, 'getIntent', async () => structuredClone(intent));
    const getRefund = context.mock.method(ziina, 'getRefund', async () => {
        throw new Error('refund not yet submitted');
    });
    const createRefund = context.mock.method(ziina, 'createRefund', async ({ id: refundId, intentId, amount, currency, test: testMode }) => {
        assert.equal(intentId, record.ziina_intent_id);
        assert.equal(amount, 100);
        assert.equal(currency, 'USD');
        assert.equal(testMode, record.ziina_test);
        return { id: refundId, payment_intent_id: intentId, amount: 10000, currency_code: 'USD', status: 'pending' };
    });
    const checkProcess = context.mock.method(booking, 'checkProcess', async () => ({
        process_id: record.booking_process_id, status: 'form_ready', partner_order_id: 'partner-fixture'
    }));
    const finishProcess = context.mock.method(booking, 'finishProcess', async () => ({
        status: 'processing', partner_order_id: 'partner-fixture'
    }));
    context.mock.method(ratehawk, 'buildBookingFinish', () => ({}));
    const supplierStatus = context.mock.method(ratehawk, 'checkBookingProcess', async () => ({ status: 'failed' }));
    context.mock.method(payment, 'isCheckoutReady', () => true);
    context.mock.method(payment, 'isRefundReady', () => true);
    return { record, intent, getIntent, getRefund, createRefund, checkProcess, finishProcess, supplierStatus };
}

test('only a verified completed Ziina GET may start a supplier booking, with no duplicate finish', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'awaiting_payment');
    assert.equal(scenario.finishProcess.mock.callCount(), 0);
    scenario.intent.status = 'completed';
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'payment_verified');
    assert.ok(scenario.record.payment_verified_at);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_pending');
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.finishProcess.mock.callCount(), 1);
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    scenario.record.next_check_at = new Date(0);
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'processing', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.finishProcess.mock.callCount(), 1);
    assert.equal(scenario.createRefund.mock.callCount(), 0);
});

test('mismatched account, amount, currency, operation or mode never books or refunds automatically', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.intent.status = 'completed';
    scenario.intent.amount = 9999;
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'manual_review');
    assert.equal(scenario.finishProcess.mock.callCount(), 0);
    assert.equal(scenario.createRefund.mock.callCount(), 0);
});

test('confirmed supplier failure triggers one refund id; POST alone never confirms its completion', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'failed', partner_order_id: 'partner-fixture' }));
    scenario.intent.status = 'completed';
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_failed');
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_pending');
    assert.match(scenario.record.refund_id, /^[a-f\d-]{36}$/);
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    assert.notEqual(scenario.record.refund_status, 'completed');
    scenario.record.next_check_at = new Date(0);
    scenario.getRefund.mock.mockImplementation(async refundId => ({ id: refundId, payment_intent_id: scenario.record.ziina_intent_id,
        amount: scenario.record.amount_minor, currency_code: scenario.record.currency, status: 'completed' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_completed');
    assert.ok(scenario.record.refund_verified_at);
    assert.equal(scenario.createRefund.mock.callCount(), 1);
});

test('refund POST timeout recovers from saved id after lease expiry without a second POST', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_failed';
    scenario.record.payment_verified_at = new Date();
    scenario.createRefund.mock.mockImplementation(async ({ id }) => {
        assert.equal(scenario.record.refund_id, id);
        assert.equal(scenario.record.state, 'refund_creating');
        throw new Error('connection lost after submission');
    });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_unknown');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    assert.ok(scenario.record.refund_sent_at);
    const savedRefundId = scenario.record.refund_id;
    scenario.record.next_check_at = new Date(0);
    scenario.record.lease_id = 'expired-worker';
    scenario.record.lease_until = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_unknown');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    scenario.getRefund.mock.mockImplementation(async refundId => ({ id: refundId,
        payment_intent_id: scenario.record.ziina_intent_id, amount: scenario.record.amount_minor,
        currency_code: scenario.record.currency, status: 'completed' }));
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.getRefund.mock.callCount(), 2);
    assert.equal(scenario.record.refund_id, savedRefundId);
    assert.equal(scenario.record.state, 'refund_completed');
    assert.ok(scenario.record.refund_verified_at);
    assert.equal(scenario.createRefund.mock.callCount(), 1);
});

test('uncertain supplier finish never triggers refund or a second supplier send', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'processing', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_pending');
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    assert.equal(scenario.finishProcess.mock.callCount(), 0);
});

test('restarted checkout reconciles a claimed supplier finish without resending or refunding', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_pending';
    scenario.record.payment_verified_at = new Date();
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.finishProcess.mock.callCount(), 1);
    scenario.record.next_check_at = new Date(0);
    scenario.record.lease_id = 'expired-worker';
    scenario.record.lease_until = new Date(0);
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'finishing', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_pending');
    assert.equal(scenario.finishProcess.mock.callCount(), 1);
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    scenario.record.next_check_at = new Date(0);
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'confirmed', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_confirmed');
    assert.equal(scenario.record.partner_order_id, 'partner-fixture');
    assert.equal(scenario.finishProcess.mock.callCount(), 1);
    assert.equal(scenario.createRefund.mock.callCount(), 0);
});

test('malformed authenticated payment response is isolated for review', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.getIntent.mock.mockImplementation(async () => {
        throw Object.assign(new Error('invalid_ziina_intent'), { code: 'invalid_ziina_intent' });
    });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'manual_review');
    assert.equal(scenario.finishProcess.mock.callCount(), 0);
});

test('closing new checkout still permits a previously verified sandbox refund', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    payment.isCheckoutReady.mock.mockImplementation(() => false);
    scenario.record.state = 'booking_failed';
    scenario.record.payment_verified_at = new Date();
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    assert.equal(scenario.record.state, 'refund_pending');
});

test('refund mismatch never reports completion', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'refund_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.record.refund_id = crypto.randomUUID();
    scenario.getRefund.mock.mockImplementation(async () => ({ id: scenario.record.refund_id,
        payment_intent_id: 'wrong', amount: 10000, currency_code: 'USD', status: 'completed' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_review');
    assert.equal(scenario.record.refund_verified_at, undefined);
});

test('an existing refund is never confirmed with a different Ziina account or test mode', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'refund_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.record.refund_id = crypto.randomUUID();
    scenario.getRefund.mock.mockImplementation(async id => ({ id, payment_intent_id: scenario.record.ziina_intent_id,
        amount: scenario.record.amount_minor, currency_code: 'USD', status: 'completed' }));
    process.env.ZIINA_TEST_MODE = 'false';
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_review');
    assert.equal(scenario.record.refund_verified_at, undefined);
    assert.equal(scenario.getRefund.mock.callCount(), 0);
    scenario.record.state = 'refund_pending';
    scenario.record.next_check_at = new Date(0);
    process.env.ZIINA_TEST_MODE = 'true';
    process.env.ZIINA_ACCOUNT_ID = 'other-account';
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_review');
    assert.equal(scenario.record.refund_verified_at, undefined);
    assert.equal(scenario.getRefund.mock.callCount(), 0);
});

test('authenticated live payment and supplier failure use a single live refund', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    process.env.ZIINA_TEST_MODE = 'false';
    scenario.record.ziina_test = false;
    scenario.intent.test = false;
    scenario.intent.status = 'completed';
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'payment_verified');
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_pending');
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'failed', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_failed');
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_pending');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    assert.equal(scenario.record.refund_amount_minor, 10000);
});

test('confirmed booking sends the official supplier voucher once and retains the receipt', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'confirmed', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_confirmed');
    assert.equal(scenario.record.notification_status, 'voucher_pending');
    assert.ok(scenario.record.encrypted_notification);
    assert.equal(scenario.record.encrypted_details, undefined);
    const voucher = context.mock.method(ratehawk, 'retrieveVoucher', async request => {
        assert.deepEqual(request, { partner_order_id: 'partner-fixture', language: 'en' });
        return Buffer.from('%PDF-1.4\n');
    });
    const send = context.mock.method(notification, 'sendVoucherConfirmation', async message => {
        assert.equal(message.email, 'test@example.com');
        assert.equal(message.guestName, 'Test Guest');
        assert.equal(message.currency, 'USD');
        assert.equal(message.amountMinor, 10000);
        assert.equal(message.reference, scenario.record.reference);
        assert.equal(message.pdfBuffer.toString(), '%PDF-1.4\n');
        return { messageId: 'fixture-confirmation' };
    });
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_confirmed');
    assert.equal(scenario.record.notification_status, 'sent');
    assert.ok(scenario.record.notification_sent_at);
    assert.equal(scenario.record.encrypted_details, undefined);
    assert.ok(scenario.record.encrypted_notification);
    assert.equal(new Date(scenario.record.notification_delete_at).toISOString(), '2099-11-16T00:00:00.000Z');
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(voucher.mock.callCount(), 1);
    assert.equal(send.mock.callCount(), 1);
});

test('an uncertain confirmation email remains a manual review, never an automatic resend', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_confirmed';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.encrypted_notification = checkout.encryptDetails({ email: 'test@example.com', guestName: 'Test Guest',
        checkin: '2099-10-15', checkout: '2099-10-17' });
    scenario.record.notification_status = 'voucher_pending';
    const voucher = context.mock.method(ratehawk, 'retrieveVoucher', async () => Buffer.from('%PDF-1.4\n'));
    const send = context.mock.method(notification, 'sendVoucherConfirmation', async () => { throw new Error('SMTP timeout'); });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.notification_status, 'unknown');
    assert.equal(scenario.record.action_required, 'reconcile_confirmation_email');
    assert.equal(scenario.record.next_check_at, null);
    assert.equal(scenario.record.state, 'booking_confirmed');
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(voucher.mock.callCount(), 1);
    assert.equal(send.mock.callCount(), 1);
});

test('expired voucher worker cannot send a confirmation after cancellation consent is claimed', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_confirmed';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.notification_status = 'voucher_pending';
    scenario.record.encrypted_notification = checkout.encryptDetails({ email: 'test@example.com', guestName: 'Test Guest',
        checkin: '2099-10-15', checkout: '2099-10-17' });
    let returnVoucher;
    const waitingVoucher = new Promise(resolve => { returnVoucher = resolve; });
    let voucherStarted;
    const started = new Promise(resolve => { voucherStarted = resolve; });
    context.mock.method(ratehawk, 'retrieveVoucher', async () => {
        voucherStarted();
        return waitingVoucher;
    });
    const send = context.mock.method(notification, 'sendVoucherConfirmation', async () => ({ messageId: 'unexpected' }));
    const running = reconciliation.reconcileAttempt(scenario.record._id);
    await started;
    scenario.record.cancellation_request_hash = 'consent-fixture';
    scenario.record.next_check_at = null;
    returnVoucher(Buffer.from('%PDF-1.4\n'));
    await assert.rejects(running, /checkout_state_conflict/);
    assert.equal(send.mock.callCount(), 0);
});

test('voucher worker cannot send after its lease expires even without a replacement worker', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_confirmed';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.notification_status = 'voucher_pending';
    scenario.record.encrypted_notification = checkout.encryptDetails({ email: 'test@example.com', guestName: 'Test Guest',
        checkin: '2099-10-15', checkout: '2099-10-17' });
    let returnVoucher;
    const waitingVoucher = new Promise(resolve => { returnVoucher = resolve; });
    let voucherStarted;
    const started = new Promise(resolve => { voucherStarted = resolve; });
    context.mock.method(ratehawk, 'retrieveVoucher', async () => {
        voucherStarted();
        return waitingVoucher;
    });
    const send = context.mock.method(notification, 'sendVoucherConfirmation', async () => ({ messageId: 'unexpected' }));
    const running = reconciliation.reconcileAttempt(scenario.record._id);
    await started;
    scenario.record.lease_until = new Date(0);
    returnVoucher(Buffer.from('%PDF-1.4\n'));
    await assert.rejects(running, /checkout_state_conflict/);
    assert.equal(send.mock.callCount(), 0);
    assert.equal(scenario.record.notification_status, 'voucher_pending');
});

test('failed voucher retrieval cannot reschedule an already claimed cancellation', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_confirmed';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.notification_status = 'voucher_pending';
    scenario.record.encrypted_notification = checkout.encryptDetails({ email: 'test@example.com', guestName: 'Test Guest',
        checkin: '2099-10-15', checkout: '2099-10-17' });
    let rejectVoucher;
    const waitingVoucher = new Promise((resolve, reject) => { rejectVoucher = reject; });
    let voucherStarted;
    const started = new Promise(resolve => { voucherStarted = resolve; });
    context.mock.method(ratehawk, 'retrieveVoucher', async () => {
        voucherStarted();
        return waitingVoucher;
    });
    const running = reconciliation.reconcileAttempt(scenario.record._id);
    await started;
    scenario.record.cancellation_request_hash = 'consent-fixture';
    scenario.record.next_check_at = null;
    rejectVoucher(new Error('supplier unavailable'));
    await assert.rejects(running, /checkout_state_conflict/);
    assert.equal(scenario.record.next_check_at, null);
    assert.equal(scenario.record.action_required, undefined);
});

test('cancelled checkout refunds the authorized amount only after matching supplier cancellation', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    process.env.ZIINA_TEST_MODE = 'false';
    scenario.record.ziina_test = false;
    scenario.record.state = 'booking_cancelled';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.payment_verified_at = new Date();
    scenario.record.cancellation_request_hash = 'consent-fixture';
    scenario.record.refund_amount_minor = 4000;
    const cancellation = { state: 'cancel_pending', _id: 'partner-fixture', request_hash: 'consent-fixture',
        checkout_attempt_id: scenario.record._id, customer_refund_amount_minor: 4000 };
    context.mock.method(BookingCancellation, 'findById', () => ({ lean: async () => structuredClone(cancellation) }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_cancelled');
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    scenario.record.next_check_at = new Date(0);
    cancellation.state = 'cancelled';
    cancellation.customer_refund_amount_minor = 4100;
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    assert.equal(scenario.record.state, 'refund_review');
    scenario.record.state = 'booking_cancelled';
    scenario.record.next_check_at = new Date(0);
    cancellation.customer_refund_amount_minor = 4000;
    scenario.createRefund.mock.mockImplementation(async ({ id, intentId, amount, currency, test: testMode }) => {
        assert.equal(scenario.record.refund_id, id);
        assert.equal(intentId, 'intent-fixture');
        assert.equal(amount, 40);
        assert.equal(currency, 'USD');
        assert.equal(testMode, false);
        return { id, payment_intent_id: intentId, amount: 4000, currency_code: currency, status: 'pending' };
    });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_pending');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    assert.equal(scenario.record.refund_status, 'pending');
    scenario.getRefund.mock.mockImplementation(async id => ({ id, payment_intent_id: 'intent-fixture', amount: 4000,
        currency_code: 'USD', status: 'completed' }));
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_completed');
    assert.ok(scenario.record.refund_verified_at);
    assert.equal(scenario.createRefund.mock.callCount(), 1);
});

test('an uncertain partial cancellation refund is recovered by GET without a second POST', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_cancelled';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.payment_verified_at = new Date();
    scenario.record.cancellation_request_hash = 'consent-fixture';
    scenario.record.refund_amount_minor = 4000;
    context.mock.method(BookingCancellation, 'findById', () => ({ lean: async () => ({ _id: 'partner-fixture',
        state: 'cancelled', request_hash: 'consent-fixture', checkout_attempt_id: scenario.record._id,
        customer_refund_amount_minor: 4000 }) }));
    scenario.createRefund.mock.mockImplementation(async ({ id, amount }) => {
        assert.equal(scenario.record.refund_id, id);
        assert.equal(amount, 40);
        throw new Error('response lost');
    });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_unknown');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    const refundId = scenario.record.refund_id;
    scenario.record.next_check_at = new Date(0);
    scenario.getRefund.mock.mockImplementation(async () => { throw new Error('status unavailable'); });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_unknown');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
    scenario.record.next_check_at = new Date(0);
    scenario.getRefund.mock.mockImplementation(async id => ({ id, payment_intent_id: 'intent-fixture',
        amount: 4000, currency_code: 'USD', status: 'completed' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.refund_id, refundId);
    assert.equal(scenario.record.state, 'refund_completed');
    assert.equal(scenario.createRefund.mock.callCount(), 1);
});

test('verified refund emails the customer once; an uncertain SMTP result stays under review', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'refund_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.record.refund_id = crypto.randomUUID();
    scenario.record.refund_amount_minor = 4000;
    scenario.record.encrypted_notification = checkout.encryptDetails({ email: 'test@example.com', guestName: 'Test Guest',
        checkin: '2099-10-15', checkout: '2099-10-17' });
    scenario.getRefund.mock.mockImplementation(async id => ({ id, payment_intent_id: 'intent-fixture', amount: 4000,
        currency_code: 'USD', status: 'completed' }));
    const send = context.mock.method(notification, 'sendRefundConfirmation', async message => {
        assert.equal(message.email, 'test@example.com');
        assert.equal(message.reference, scenario.record.reference);
        assert.equal(message.amountMinor, 4000);
        assert.equal(message.currency, 'USD');
        throw new Error('outcome unknown');
    });
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'refund_completed');
    assert.ok(scenario.record.refund_verified_at);
    assert.equal(send.mock.callCount(), 0);
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.refund_notification_status, 'unknown');
    assert.equal(scenario.record.action_required, 'reconcile_refund_email');
    assert.equal(scenario.record.next_check_at, null);
    scenario.record.next_check_at = new Date(0);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(send.mock.callCount(), 1);
});

test('failed booking preserves minimal encrypted contact until the verified refund notification', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_pending';
    scenario.record.payment_verified_at = new Date();
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'failed', partner_order_id: 'partner-fixture' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_failed');
    assert.equal(scenario.record.encrypted_details, undefined);
    const details = checkout.decryptDetails({ encrypted_details: scenario.record.encrypted_notification });
    assert.equal(details.email, 'test@example.com');
    assert.equal(details.guestName, 'Test Guest');
    assert.ok(scenario.record.notification_delete_at);
});

test('an unavailable supplier form retains refund contact before removing booking guest data', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'payment_verified';
    scenario.record.payment_verified_at = new Date();
    payment.isCheckoutReady.mock.mockImplementation(() => false);
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_failed');
    assert.equal(scenario.record.encrypted_details, undefined);
    const contact = checkout.decryptDetails({ encrypted_details: scenario.record.encrypted_notification });
    assert.equal(contact.email, 'test@example.com');
    assert.equal(contact.guestName, 'Test Guest');
    assert.ok(scenario.record.notification_delete_at);
});

test('expired encrypted contact is deleted after cancellation even without a scheduled checkout check', async context => {
    const reconciliation = require('./services/checkoutReconciliationService');
    const deleteAt = new Date(Date.now() - 1000);
    const saved = { state: 'refund_completed', encrypted_notification: { iv: 'fixture' }, notification_delete_at: deleteAt,
        next_check_at: null };
    const purge = context.mock.method(CheckoutAttempt, 'updateMany', async (filter, update) => {
        assert.deepEqual(filter.notification_delete_at, { $lte: deleteAt });
        assert.deepEqual(filter.encrypted_notification, { $exists: true });
        assert.ok(filter.$or.some(condition => condition.lease_until?.$lte === deleteAt));
        assert.deepEqual(update, { $unset: { encrypted_notification: '' } });
        delete saved.encrypted_notification;
        return { modifiedCount: 1 };
    });
    assert.deepEqual(await reconciliation.purgeExpiredNotificationContacts(deleteAt), { modifiedCount: 1 });
    assert.equal(saved.encrypted_notification, undefined);
    assert.equal(purge.mock.callCount(), 1);
});

test('a locally failed finish cannot refund while supplier status is pending or later confirmed', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'booking_pending';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.payment_verified_at = new Date();
    scenario.checkProcess.mock.mockImplementation(async () => ({ status: 'failed', partner_order_id: 'partner-fixture' }));
    const status = scenario.supplierStatus;
    status.mock.mockImplementation(async () => ({ status: 'processing' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_pending');
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    scenario.record.next_check_at = new Date(0);
    status.mock.mockImplementation(async () => ({ status: 'confirmed' }));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'booking_confirmed');
    assert.equal(scenario.createRefund.mock.callCount(), 0);
    assert.equal(status.mock.callCount(), 2);
});

test('a supplier account switch stops booking and voucher retrieval without changing payment state', async context => {
    const scenario = fixture(context);
    const reconciliation = require('./services/checkoutReconciliationService');
    scenario.record.state = 'payment_verified';
    scenario.record.payment_verified_at = new Date();
    process.env.RATEHAWK_KEY_ID = 'different-supplier';
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.state, 'manual_review');
    assert.equal(scenario.record.action_required, 'supplier_environment_mismatch');
    assert.equal(scenario.checkProcess.mock.callCount(), 0);
    scenario.record.state = 'booking_confirmed';
    scenario.record.partner_order_id = 'partner-fixture';
    scenario.record.notification_status = 'voucher_pending';
    scenario.record.encrypted_notification = checkout.encryptDetails({ email: 'test@example.com', guestName: 'Test Guest',
        checkin: '2099-10-15', checkout: '2099-10-17' });
    scenario.record.next_check_at = new Date(0);
    const voucher = context.mock.method(ratehawk, 'retrieveVoucher', async () => Buffer.from('%PDF-1.4\n'));
    await reconciliation.reconcileAttempt(scenario.record._id);
    assert.equal(scenario.record.notification_status, 'review');
    assert.equal(scenario.record.action_required, 'supplier_environment_mismatch');
    assert.equal(voucher.mock.callCount(), 0);
});