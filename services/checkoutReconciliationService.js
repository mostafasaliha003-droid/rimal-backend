const crypto = require('node:crypto');
const mongoose = require('mongoose');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const booking = require('./bookingProcessService');
const payment = require('./paymentService');
const ziina = require('./ziinaClient');
const checkout = require('./checkoutProcessService');
const logger = require('./loggerService');

const RECONCILE_STATES = [
    'preparing', 'intent_creating', 'awaiting_payment', 'payment_verified', 'booking_pending',
    'booking_failed', 'refund_creating', 'refund_unknown', 'refund_pending'
];

async function updateClaim(record, fields, unset = {}) {
    const updated = await CheckoutAttempt.findOneAndUpdate({ _id: record._id, state: record.state, lease_id: record.lease_id }, {
        $set: { ...fields, lease_until: new Date(Date.now() + 120000) }, $unset: unset
    }, { new: true }).lean();
    if (!updated) throw new Error('checkout_state_conflict');
    return updated;
}

async function releaseClaim(record, fields = {}, unset = {}) {
    const result = await CheckoutAttempt.updateOne({ _id: record._id, state: record.state, lease_id: record.lease_id }, {
        $set: fields, $unset: { lease_id: '', lease_until: '', ...unset }
    });
    if (result.matchedCount !== 1) throw new Error('checkout_state_conflict');
}

function followUp(delay = 5000) {
    return new Date(Date.now() + delay);
}

function validProviderIdentity(record, intent) {
    ziina.validateIntent(intent, {
        id: record.ziina_intent_id, accountId: record.ziina_account_id,
        operationId: record.ziina_operation_id, amount: record.amount_minor,
        currency: record.currency, test: true
    });
    if (record.ziina_test !== true || record.ziina_account_id !== process.env.ZIINA_ACCOUNT_ID
        || process.env.ZIINA_TEST_MODE !== 'true') throw new Error('payment_environment_mismatch');
}

async function verifyPayment(record) {
    let intent;
    try {
        intent = await ziina.getIntent(record.ziina_intent_id);
    } catch (error) {
        await releaseClaim(record, error.code === 'invalid_ziina_intent'
            ? { state: 'manual_review', next_check_at: null, action_required: 'payment_identity_mismatch', error: 'payment_identity_mismatch' }
            : { next_check_at: followUp(15000), error: 'payment_status_unavailable' });
        return;
    }
    try {
        validProviderIdentity(record, intent);
    } catch {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null,
            action_required: 'payment_identity_mismatch', error: 'payment_identity_mismatch' });
        return;
    }
    if (intent.status === 'completed') {
        await releaseClaim(record, { state: 'payment_verified', payment_verified_at: new Date(),
            next_check_at: followUp(0) }, { error: '', redirect_url: '' });
    } else if (intent.status === 'failed' || intent.status === 'canceled') {
        await releaseClaim(record, { state: 'payment_failed', next_check_at: null },
            { encrypted_details: '', redirect_url: '' });
    } else {
        const expired = Date.now() >= new Date(record.payment_expires_at).getTime();
        await releaseClaim(record, { next_check_at: followUp(expired ? 60000 : 10000),
            ...(expired ? { action_required: 'payment_pending_after_expiry' } : {}) }, { error: '' });
    }
}

async function reconcileBooking(record) {
    if (!record.payment_verified_at || record.ziina_test !== true) {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'payment_not_verified' });
        return;
    }
    let result;
    try {
        result = await booking.checkProcess(record.booking_process_id);
    } catch {
        await releaseClaim(record, { next_check_at: followUp(15000), error: 'supplier_status_unavailable' });
        return;
    }
    if (record.partner_order_id && result.partner_order_id !== record.partner_order_id) {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'supplier_identity_mismatch' });
        return;
    }
    if (result.status === 'confirmed' && result.partner_order_id) {
        await releaseClaim(record, { state: 'booking_confirmed', partner_order_id: result.partner_order_id,
            next_check_at: null }, { encrypted_details: '', redirect_url: '', error: '', action_required: '' });
        return;
    }
    if (['failed', 'expired'].includes(result.status)) {
        await releaseClaim(record, { state: 'booking_failed', next_check_at: followUp(0),
            error: 'supplier_booking_failed' }, { encrypted_details: '' });
        return;
    }
    if (result.status === 'cancelled') {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'review_supplier_cancellation' });
        return;
    }
    if (['finishing', 'processing', '3ds'].includes(result.status)) {
        await releaseClaim(record, { state: 'booking_pending', partner_order_id: result.partner_order_id,
            next_check_at: followUp(result.timed_out ? 60000 : 5000),
            ...(result.timed_out || result.status === '3ds' ? { action_required: 'review_supplier_pending' } : {}) });
        return;
    }
    if (result.status !== 'form_ready' && result.status !== 'card_ready') {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'review_supplier_status' });
        return;
    }
    if (!payment.isCheckoutReady() || process.env.ZIINA_TEST_MODE !== 'true'
        || Date.now() >= new Date(record.form_expires_at).getTime() - 60000
        || Date.now() >= new Date(record.payment_expires_at).getTime()) {
        await releaseClaim(record, { state: 'booking_failed', next_check_at: followUp(0),
            error: 'supplier_form_unavailable' }, { encrypted_details: '' });
        return;
    }
    if (record.state === 'payment_verified') {
        await releaseClaim(record, { state: 'booking_pending', partner_order_id: result.partner_order_id,
            next_check_at: followUp(0) });
        return;
    }
    if (record.state !== 'booking_pending' || !result.partner_order_id || result.status !== 'form_ready') {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'review_supplier_form' });
        return;
    }
    let details;
    try {
        details = checkout.decryptDetails(record);
    } catch {
        await releaseClaim(record, { state: 'booking_failed', next_check_at: followUp(0),
            error: 'guest_details_unavailable' });
        return;
    }
    try {
        await booking.finishProcess(record.booking_process_id, {
            user: details.user, rooms: details.rooms, payment_type: record.supplier_payment
        });
    } catch {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null,
            action_required: 'review_supplier_finish', error: 'supplier_finish_unknown' });
        return;
    }
    await releaseClaim(record, { next_check_at: followUp(5000) });
}

async function reconcileRefund(record) {
    if (!record.payment_verified_at || !record.ziina_intent_id || record.ziina_test !== true) {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'refund_identity_review' });
        return;
    }
    if (record.state === 'booking_failed') {
        if (!payment.isRefundReady() || record.ziina_account_id !== process.env.ZIINA_ACCOUNT_ID) {
            await releaseClaim(record, { state: 'refund_review', next_check_at: null, action_required: 'refund_configuration_unavailable' });
            return;
        }
        const claimed = await updateClaim(record, { state: 'refund_creating', refund_id: crypto.randomUUID(),
            refund_status: 'pending', refund_sent_at: new Date(), next_check_at: followUp(15000) });
        try {
            const refund = await ziina.createRefund({ id: claimed.refund_id, intentId: claimed.ziina_intent_id,
                amount: claimed.amount_minor / 100, currency: claimed.currency, test: true });
            ziina.validateRefund(refund, { id: claimed.refund_id, intentId: claimed.ziina_intent_id,
                amount: claimed.amount_minor, currency: claimed.currency });
            await releaseClaim(claimed, { state: 'refund_pending', refund_status: 'pending', next_check_at: followUp(5000) },
                { encrypted_details: '', error: '' });
        } catch {
            await releaseClaim(claimed, { state: 'refund_unknown', next_check_at: followUp(15000),
                action_required: 'reconcile_refund', error: 'refund_outcome_unknown' });
        }
        return;
    }
    let refund;
    try {
        refund = await ziina.getRefund(record.refund_id);
        ziina.validateRefund(refund, { id: record.refund_id, intentId: record.ziina_intent_id,
            amount: record.amount_minor, currency: record.currency });
    } catch (error) {
        await releaseClaim(record, error.code === 'invalid_ziina_refund'
            ? { state: 'refund_review', next_check_at: null, action_required: 'refund_identity_mismatch', error: 'refund_identity_mismatch' }
            : { state: 'refund_unknown', next_check_at: followUp(60000),
                action_required: 'reconcile_refund', error: 'refund_status_unavailable' });
        return;
    }
    if (refund.status === 'completed') {
        await releaseClaim(record, { state: 'refund_completed', refund_status: 'completed',
            refund_verified_at: new Date(), next_check_at: null },
            { encrypted_details: '', error: '', action_required: '' });
    } else if (refund.status === 'failed') {
        await releaseClaim(record, { state: 'refund_review', refund_status: 'failed',
            action_required: 'refund_failed', next_check_at: null });
    } else {
        await releaseClaim(record, { state: 'refund_pending', refund_status: 'pending', next_check_at: followUp(15000) });
    }
}

async function reconcileAttempt(id) {
    const record = await CheckoutAttempt.findById(id).lean();
    if (!record || !RECONCILE_STATES.includes(record.state)
        || !record.next_check_at || new Date(record.next_check_at).getTime() > Date.now()) {
        return record && checkout.publicView(record);
    }
    const now = new Date();
    const leaseId = crypto.randomUUID();
    const claimed = await CheckoutAttempt.findOneAndUpdate({
        _id: id, state: record.state, next_check_at: { $lte: now },
        $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: now } }]
    }, { $set: { lease_id: leaseId, lease_until: followUp(120000) } }, { new: true }).lean();
    if (!claimed) return checkout.publicView(await CheckoutAttempt.findById(id).lean());
    if (claimed.state === 'preparing' || claimed.state === 'intent_creating') {
        const longRunning = Date.now() - new Date(claimed.createdAt || now).getTime() > 15 * 60 * 1000;
        await releaseClaim(claimed, longRunning ? { state: claimed.state === 'preparing' ? 'preflight_failed' : 'intent_unknown',
            action_required: claimed.state === 'preparing' ? 'retry_with_new_offer' : 'reconcile_payment_intent', next_check_at: null }
            : { next_check_at: followUp(60000) });
    } else if (claimed.state === 'awaiting_payment') {
        await verifyPayment(claimed);
    } else if (['payment_verified', 'booking_pending'].includes(claimed.state)) {
        await reconcileBooking(claimed);
    } else {
        await reconcileRefund(claimed);
    }
    return checkout.publicView(await CheckoutAttempt.findById(id).lean());
}

async function reconcilePendingCheckouts() {
    const records = await CheckoutAttempt.find({ state: { $in: RECONCILE_STATES }, next_check_at: { $lte: new Date() },
        $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: new Date() } }] })
        .select('_id').sort({ next_check_at: 1 }).limit(10).lean();
    const results = await Promise.allSettled(records.map(record => reconcileAttempt(record._id)));
    return { checked: records.length, failed: results.filter(result => result.status === 'rejected').length };
}

function startCheckoutWorker() {
    let running = false;
    const tick = async () => {
        if (running || mongoose.connection.readyState !== 1) return;
        running = true;
        try {
            const result = await reconcilePendingCheckouts();
            if (result.failed) logger.warn('Checkout reconciliation needs retry', { failed: result.failed });
        } catch {
            logger.error('Checkout reconciliation unavailable');
        } finally {
            running = false;
        }
    };
    const timer = setInterval(tick, 5000);
    timer.unref();
    void tick();
    return () => clearInterval(timer);
}

module.exports = { reconcileAttempt, reconcilePendingCheckouts, startCheckoutWorker };