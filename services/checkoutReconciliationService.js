const crypto = require('node:crypto');
const mongoose = require('mongoose');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const BookingCancellation = require('../models/BookingCancellation');
const booking = require('./bookingProcessService');
const payment = require('./paymentService');
const ziina = require('./ziinaClient');
const checkout = require('./checkoutProcessService');
const ratehawk = require('./ratehawkService');
const notification = require('./notificationService');
const logger = require('./loggerService');

const RECONCILE_STATES = [
    'preparing', 'intent_creating', 'awaiting_payment', 'payment_verified', 'booking_pending',
    'booking_confirmed', 'booking_cancelled', 'booking_failed', 'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed'
];

async function updateClaim(record, fields, unset = {}, conditions = {}) {
    const updated = await CheckoutAttempt.findOneAndUpdate({ _id: record._id, state: record.state,
        lease_id: record.lease_id, lease_until: { $gt: new Date() }, ...conditions }, {
        $set: { ...fields, lease_until: new Date(Date.now() + 120000) }, $unset: unset
    }, { new: true }).lean();
    if (!updated) throw new Error('checkout_state_conflict');
    return updated;
}

async function releaseClaim(record, fields = {}, unset = {}, conditions = {}) {
    const result = await CheckoutAttempt.updateOne({ _id: record._id, state: record.state,
        lease_id: record.lease_id, lease_until: { $gt: new Date() }, ...conditions }, {
        $set: fields, $unset: { lease_id: '', lease_until: '', ...unset }
    });
    if (result.matchedCount !== 1) throw new Error('checkout_state_conflict');
}

function followUp(delay = 5000) {
    return new Date(Date.now() + delay);
}

function contactDetails(record) {
    const details = checkout.decryptDetails(record);
    const guest = details.rooms[0].guests[0];
    const deleteAt = Date.parse(`${details.checkout}T00:00:00Z`) + 30 * 24 * 60 * 60 * 1000;
    if (!details.user.email || !guest.first_name || !guest.last_name || !details.checkin
        || !Number.isFinite(deleteAt)) throw new Error('missing_notification_details');
    return {
        encrypted_notification: checkout.encryptDetails({ email: details.user.email,
            guestName: `${guest.first_name} ${guest.last_name}`, checkin: details.checkin, checkout: details.checkout }),
        notification_delete_at: new Date(deleteAt)
    };
}

function validProviderIdentity(record, intent) {
    ziina.validateIntent(intent, {
        id: record.ziina_intent_id, accountId: record.ziina_account_id,
        operationId: record.ziina_operation_id, amount: record.amount_minor,
        currency: record.currency, test: record.ziina_test
    });
    if (typeof record.ziina_test !== 'boolean' || record.ziina_account_id !== process.env.ZIINA_ACCOUNT_ID
        || process.env.ZIINA_TEST_MODE !== String(record.ziina_test)) throw new Error('payment_environment_mismatch');
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
    if (!record.payment_verified_at || typeof record.ziina_test !== 'boolean'
        || process.env.ZIINA_TEST_MODE !== String(record.ziina_test)) {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'payment_not_verified' });
        return;
    }
    if (!record.supplier_identity || record.supplier_identity !== payment.supplierIdentity()) {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null,
            action_required: 'supplier_environment_mismatch' });
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
    if (result.status === 'failed') {
        if (!result.partner_order_id) {
            await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'supplier_identity_mismatch' });
            return;
        }
        let supplier;
        try {
            supplier = await ratehawk.checkBookingProcess(result.partner_order_id);
        } catch {
            await releaseClaim(record, { state: 'booking_pending', next_check_at: followUp(60000),
                action_required: 'verify_supplier_failure' });
            return;
        }
        if (supplier.status === 'confirmed') result = { ...result, status: 'confirmed' };
        else if (supplier.status !== 'failed') {
            await releaseClaim(record, { state: 'booking_pending', next_check_at: followUp(60000),
                action_required: 'verify_supplier_failure' });
            return;
        }
    }
    if (result.status === 'confirmed' && result.partner_order_id) {
        let notification;
        try {
            notification = contactDetails(record);
        } catch {
            await releaseClaim(record, { state: 'booking_confirmed', partner_order_id: result.partner_order_id,
                notification_status: 'review', action_required: 'review_notification_details', next_check_at: null },
            { encrypted_details: '', redirect_url: '', error: '' });
            return;
        }
        await releaseClaim(record, { state: 'booking_confirmed', partner_order_id: result.partner_order_id,
            ...notification, notification_status: 'voucher_pending', next_check_at: followUp(0) },
        { encrypted_details: '', redirect_url: '', error: '', action_required: '' });
        return;
    }
    if (['failed', 'expired'].includes(result.status)) {
        let contact;
        try { contact = contactDetails(record); }
        catch { contact = { refund_notification_status: 'review', action_required: 'review_refund_notification_details' }; }
        await releaseClaim(record, { state: 'booking_failed', next_check_at: followUp(0),
            ...contact, error: 'supplier_booking_failed' }, { encrypted_details: '' });
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
    if (!payment.isCheckoutReady()
        || Date.now() >= new Date(record.form_expires_at).getTime() - 60000
        || Date.now() >= new Date(record.payment_expires_at).getTime()) {
        let contact;
        try { contact = contactDetails(record); }
        catch { contact = { refund_notification_status: 'review', action_required: 'review_refund_notification_details' }; }
        await releaseClaim(record, { state: 'booking_failed', next_check_at: followUp(0),
            ...contact, error: 'supplier_form_unavailable' }, { encrypted_details: '' });
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
    if (!record.payment_verified_at || !record.ziina_intent_id || typeof record.ziina_test !== 'boolean') {
        await releaseClaim(record, { state: 'manual_review', next_check_at: null, action_required: 'refund_identity_review' });
        return;
    }
    if (record.ziina_account_id !== process.env.ZIINA_ACCOUNT_ID
        || process.env.ZIINA_TEST_MODE !== String(record.ziina_test)) {
        await releaseClaim(record, { state: 'refund_review', next_check_at: null,
            action_required: 'refund_configuration_unavailable' });
        return;
    }
    if (record.state === 'booking_failed' || record.state === 'booking_cancelled') {
        if (record.state === 'booking_cancelled') {
            const cancellation = await BookingCancellation.findById(record.partner_order_id).lean();
            if (!cancellation || cancellation.checkout_attempt_id !== record._id
                || cancellation.request_hash !== record.cancellation_request_hash
                || !Number.isSafeInteger(record.refund_amount_minor) || record.refund_amount_minor <= 0
                || record.refund_amount_minor > record.amount_minor
                || cancellation.customer_refund_amount_minor !== record.refund_amount_minor) {
                await releaseClaim(record, { state: 'refund_review', next_check_at: null,
                    action_required: 'refund_authorization_mismatch' });
                return;
            }
            if (cancellation.state !== 'cancelled') {
                await releaseClaim(record, { next_check_at: followUp(60000), action_required: 'verify_supplier_cancellation' });
                return;
            }
        }
        if (!payment.isRefundReady() || record.ziina_account_id !== process.env.ZIINA_ACCOUNT_ID
            || process.env.ZIINA_TEST_MODE !== String(record.ziina_test)) {
            await releaseClaim(record, { state: 'refund_review', next_check_at: null, action_required: 'refund_configuration_unavailable' });
            return;
        }
        const claimed = await updateClaim(record, { state: 'refund_creating', refund_id: crypto.randomUUID(),
            refund_amount_minor: record.state === 'booking_failed' ? record.amount_minor : record.refund_amount_minor,
            refund_status: 'pending', refund_sent_at: new Date(), next_check_at: followUp(15000) });
        try {
            const refund = await ziina.createRefund({ id: claimed.refund_id, intentId: claimed.ziina_intent_id,
                amount: claimed.refund_amount_minor / 100, currency: claimed.currency, test: claimed.ziina_test });
            ziina.validateRefund(refund, { id: claimed.refund_id, intentId: claimed.ziina_intent_id,
                amount: claimed.refund_amount_minor, currency: claimed.currency });
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
            amount: record.refund_amount_minor || record.amount_minor, currency: record.currency });
    } catch (error) {
        await releaseClaim(record, error.code === 'invalid_ziina_refund'
            ? { state: 'refund_review', next_check_at: null, action_required: 'refund_identity_mismatch', error: 'refund_identity_mismatch' }
            : { state: 'refund_unknown', next_check_at: followUp(60000),
                action_required: 'reconcile_refund', error: 'refund_status_unavailable' });
        return;
    }
    if (refund.status === 'completed') {
        const canNotify = Boolean(record.encrypted_notification);
        await releaseClaim(record, { state: 'refund_completed', refund_status: 'completed',
            refund_verified_at: new Date(), refund_notification_status: canNotify ? 'pending' : 'review',
            next_check_at: canNotify ? followUp(0) : null,
            ...(canNotify ? {} : { action_required: 'review_refund_notification_details' }) },
        { encrypted_details: '', error: '', ...(canNotify ? { action_required: '' } : {}) });
    } else if (refund.status === 'failed') {
        await releaseClaim(record, { state: 'refund_review', refund_status: 'failed',
            action_required: 'refund_failed', next_check_at: null });
    } else {
        await releaseClaim(record, { state: 'refund_pending', refund_status: 'pending', next_check_at: followUp(15000) });
    }
}

async function reconcileRefundNotification(record) {
    if (record.refund_notification_status === 'sending') {
        await releaseClaim(record, { refund_notification_status: 'unknown', next_check_at: null,
            action_required: 'reconcile_refund_email' });
        return;
    }
    if (record.refund_notification_status !== 'pending' || !record.refund_verified_at || !record.encrypted_notification
        || !Number.isSafeInteger(record.refund_amount_minor) || record.refund_amount_minor <= 0) {
        await releaseClaim(record, { refund_notification_status: 'review', next_check_at: null,
            action_required: 'review_refund_notification_details' });
        return;
    }
    let contact;
    try { contact = checkout.decryptDetails({ encrypted_details: record.encrypted_notification }); }
    catch {
        await releaseClaim(record, { refund_notification_status: 'review', next_check_at: null,
            action_required: 'review_refund_notification_details' });
        return;
    }
    const claimed = await updateClaim(record, { refund_notification_status: 'sending',
        refund_notification_attempted_at: new Date(), next_check_at: followUp(120000) });
    try {
        await notification.sendRefundConfirmation({ ...contact, reference: claimed.reference,
            currency: claimed.currency, amountMinor: claimed.refund_amount_minor });
        await releaseClaim(claimed, { refund_notification_status: 'sent', refund_notification_sent_at: new Date(),
            next_check_at: null }, { error: '', action_required: '' });
    } catch {
        await releaseClaim(claimed, { refund_notification_status: 'unknown', next_check_at: null,
            action_required: 'reconcile_refund_email', error: 'notification_outcome_unknown' });
    }
}

async function reconcileConfirmation(record) {
    if (record.cancellation_request_hash) {
        await releaseClaim(record, { next_check_at: null });
        return;
    }
    if (!record.supplier_identity || record.supplier_identity !== payment.supplierIdentity()) {
        await releaseClaim(record, { notification_status: 'review', next_check_at: null,
            action_required: 'supplier_environment_mismatch' });
        return;
    }
    if (record.notification_status === 'sent') {
        await releaseClaim(record, { next_check_at: null });
        return;
    }
    if (record.notification_status === 'sending') {
        await releaseClaim(record, { notification_status: 'unknown', next_check_at: null,
            action_required: 'reconcile_confirmation_email' });
        return;
    }
    if (record.notification_status !== 'voucher_pending' || !record.partner_order_id || !record.encrypted_notification) {
        await releaseClaim(record, { notification_status: 'review', next_check_at: null,
            action_required: 'review_notification_details' });
        return;
    }
    let contact;
    try {
        contact = checkout.decryptDetails({ encrypted_details: record.encrypted_notification });
    } catch {
        await releaseClaim(record, { notification_status: 'review', next_check_at: null,
            action_required: 'review_notification_details' });
        return;
    }
    let pdfBuffer;
    try {
        pdfBuffer = await ratehawk.retrieveVoucher({ partner_order_id: record.partner_order_id, language: 'en' });
    } catch {
        await releaseClaim(record, { next_check_at: followUp(60000),
            action_required: 'voucher_unavailable', error: 'voucher_unavailable' }, {},
        { cancellation_request_hash: { $exists: false } });
        return;
    }
    const claimed = await updateClaim(record, { notification_status: 'sending', notification_attempted_at: new Date(),
        next_check_at: followUp(120000) }, {}, { cancellation_request_hash: { $exists: false }, notification_status: 'voucher_pending' });
    try {
        await notification.sendVoucherConfirmation({ ...contact, reference: claimed.reference,
            currency: claimed.currency, amountMinor: claimed.amount_minor, pdfBuffer });
        await releaseClaim(claimed, { notification_status: 'sent', notification_sent_at: new Date(),
            next_check_at: null },
        { error: '', action_required: '' });
    } catch {
        await releaseClaim(claimed, { notification_status: 'unknown', next_check_at: null,
            action_required: 'reconcile_confirmation_email', error: 'notification_outcome_unknown' });
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
    } else if (claimed.state === 'booking_confirmed') {
        await reconcileConfirmation(claimed);
    } else if (claimed.state === 'refund_completed') {
        await reconcileRefundNotification(claimed);
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

async function purgeExpiredNotificationContacts(now = new Date()) {
    return CheckoutAttempt.updateMany({ notification_delete_at: { $lte: now },
        encrypted_notification: { $exists: true },
        $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $unset: { encrypted_notification: '' } });
}

function startCheckoutWorker() {
    let running = false;
    const tick = async () => {
        if (running || mongoose.connection.readyState !== 1) return;
        running = true;
        try {
            const result = await reconcilePendingCheckouts();
            if (result.failed) logger.warn('Checkout reconciliation needs retry', { failed: result.failed });
            await purgeExpiredNotificationContacts();
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

module.exports = { reconcileAttempt, reconcilePendingCheckouts, purgeExpiredNotificationContacts, startCheckoutWorker };