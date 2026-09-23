const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const CheckoutAttempt = require('./models/CheckoutAttempt');
const booking = require('./services/bookingProcessService');
const ratehawk = require('./services/ratehawkService');
const payment = require('./services/paymentService');
const ziina = require('./services/ziinaClient');
const checkout = require('./services/checkoutProcessService');

function fixture(context) {
    const previousAccountId = process.env.ZIINA_ACCOUNT_ID;
    const previousTestMode = process.env.ZIINA_TEST_MODE;
    const previousEncryptionKey = process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
    process.env.ZIINA_ACCOUNT_ID = 'account-fixture';
    process.env.ZIINA_TEST_MODE = 'true';
    process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = 'ab'.repeat(32);
    context.after(() => {
        if (previousAccountId === undefined) delete process.env.ZIINA_ACCOUNT_ID;
        else process.env.ZIINA_ACCOUNT_ID = previousAccountId;
        if (previousTestMode === undefined) delete process.env.ZIINA_TEST_MODE;
        else process.env.ZIINA_TEST_MODE = previousTestMode;
        if (previousEncryptionKey === undefined) delete process.env.PAYMENT_BOOKING_ENCRYPTION_KEY;
        else process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = previousEncryptionKey;
    });
    const id = crypto.randomUUID();
    const record = {
        _id: id, reference: crypto.randomUUID(), state: 'awaiting_payment',
        amount_minor: 10000, currency: 'USD', ziina_test: true,
        ziina_intent_id: 'intent-fixture', ziina_account_id: 'account-fixture', ziina_operation_id: 'operation-fixture',
        booking_process_id: 'b'.repeat(64), supplier_payment: { type: 'deposit', amount: '100.00', currency_code: 'USD' },
        form_expires_at: new Date(Date.now() + 40 * 60 * 1000), payment_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        encrypted_details: checkout.encryptDetails({
            user: { email: 'test@example.com', phone: '+971500000000' },
            rooms: [{ guests: [{ first_name: 'Test', last_name: 'Guest', is_child: false }] }]
        }), next_check_at: new Date(0)
    };
    context.mock.method(CheckoutAttempt, 'findById', key => ({ lean: async () => key === id ? structuredClone(record) : null }));
    context.mock.method(CheckoutAttempt, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter._id !== id || (filter.state && filter.state !== record.state)
            || (filter.lease_id && filter.lease_id !== record.lease_id)) return null;
        if (filter.next_check_at?.$lte && new Date(record.next_check_at) > new Date(filter.next_check_at.$lte)) return null;
        if (record.lease_until && new Date(record.lease_until) > Date.now() && !filter.lease_id) return null;
        Object.assign(record, structuredClone(update.$set || {}));
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return structuredClone(record);
    } }));
    context.mock.method(CheckoutAttempt, 'updateOne', async (filter, update) => {
        if (filter._id !== id || (filter.state && filter.state !== record.state)
            || (filter.lease_id && filter.lease_id !== record.lease_id)) return { matchedCount: 0 };
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
        assert.equal(testMode, true);
        return { id: refundId, payment_intent_id: intentId, amount: 10000, currency_code: 'USD', status: 'pending' };
    });
    const checkProcess = context.mock.method(booking, 'checkProcess', async () => ({
        process_id: record.booking_process_id, status: 'form_ready', partner_order_id: 'partner-fixture'
    }));
    const finishProcess = context.mock.method(booking, 'finishProcess', async () => ({
        status: 'processing', partner_order_id: 'partner-fixture'
    }));
    context.mock.method(ratehawk, 'buildBookingFinish', () => ({}));
    context.mock.method(payment, 'isCheckoutReady', () => true);
    context.mock.method(payment, 'isRefundReady', () => true);
    return { record, intent, getIntent, getRefund, createRefund, checkProcess, finishProcess };
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