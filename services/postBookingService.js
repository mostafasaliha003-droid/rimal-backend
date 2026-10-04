const crypto = require('node:crypto');
const mongoose = require('mongoose');
const BookingCancellation = require('../models/BookingCancellation');
const BookingProcess = require('../models/BookingProcess');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const ratehawk = require('./ratehawkService');
const payment = require('./paymentService');

const PENDING = ['cancelling', 'cancel_pending'];

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function orderId(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256) throw fail('invalid_partner_order_id');
    return value.trim();
}

function moneyKey(value) {
    if (!value || typeof value.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.amount)
        || typeof value.currency_code !== 'string' || !/^[A-Z]{3}$/.test(value.currency_code)) throw fail('invalid_cancellation_penalty');
    const [whole, fraction = ''] = value.amount.split('.');
    return `${value.currency_code}:${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
}

function policyTime(value, fallback) {
    if (value === null) return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return NaN;
    return Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

function currentPenalty(order) {
    const policies = order?.cancellation_info?.policies;
    if (!Array.isArray(policies) || !policies.length) throw fail('cancellation_policy_unavailable', 409);
    const now = Date.now();
    const matches = [];
    for (const policy of policies) {
        const start = policyTime(policy?.start_at, -Infinity);
        const end = policyTime(policy?.end_at, Infinity);
        if (Number.isNaN(start) || Number.isNaN(end) || start >= end) throw fail('cancellation_policy_unavailable', 409);
        if (now >= start && now < end) matches.push(policy);
    }
    if (matches.length !== 1) throw fail('cancellation_policy_unavailable', 409);
    try { moneyKey(matches[0].penalty); }
    catch { throw fail('cancellation_policy_unavailable', 409); }
    const { amount, currency_code } = matches[0].penalty;
    return { amount, currency_code };
}

async function view(record) {
    let customerRefundStatus = 'not_processed';
    if (record.checkout_attempt_id && record.state === 'cancelled') {
        const checkout = await CheckoutAttempt.findById(record.checkout_attempt_id).lean();
        customerRefundStatus = !checkout || checkout.partner_order_id !== record._id
            ? 'review' : checkout.state === 'refund_completed' && checkout.refund_verified_at
                ? 'completed' : checkout.state === 'refund_review' || checkout.state === 'manual_review'
                    ? 'review' : checkout.state === 'booking_cancelled' || ['refund_creating', 'refund_unknown', 'refund_pending'].includes(checkout.state)
                        ? 'pending' : 'review';
    }
    return {
        partner_order_id: record._id,
        success: record.state === 'cancelled',
        status: record.state,
        pending: PENDING.includes(record.state),
        amountRefunded: record.amount_refunded || null,
        amountPayable: record.amount_payable || null,
        amountSell: record.amount_sell || null,
        customer_refund_status: customerRefundStatus,
        upsells_require_manual_cancellation: record.upsells_require_manual_cancellation === true,
        action_required: record.action_required,
        ...(record.error ? { error: record.error } : {}),
        ...(PENDING.includes(record.state) ? { next_check_at: record.next_check_at } : {})
    };
}

async function getBookingInfo(partnerOrderId) {
    const info = await ratehawk.getOrderInfo(orderId(partnerOrderId));
    if (!info.success) throw Object.assign(fail(info.error, info.httpStatus || 502), { retry_after_ms: info.retry_after_ms });
    if (info.pending) return info;
    let penalty = null;
    try { penalty = currentPenalty(info.order); } catch {}
    return {
        ...info,
        current_penalty: penalty,
        upsells_require_manual_cancellation: Array.isArray(info.upsells) && info.upsells.length > 0
    };
}

async function syncCancelled(partnerOrderId, cancellation) {
    if (cancellation.checkout_attempt_id) {
        const checkout = await CheckoutAttempt.findById(cancellation.checkout_attempt_id).lean();
        if (!checkout || checkout.partner_order_id !== partnerOrderId || !checkout.payment_verified_at
            || !Number.isSafeInteger(cancellation.customer_refund_amount_minor)
            || cancellation.customer_refund_amount_minor <= 0 || cancellation.customer_refund_amount_minor > checkout.amount_minor
            || checkout.cancellation_request_hash !== cancellation.request_hash) {
            throw fail('customer_refund_link_mismatch', 503);
        }
        if (!checkout.supplier_identity || checkout.supplier_identity !== payment.supplierIdentity()) {
            throw fail('supplier_environment_mismatch', 503);
        }
        if (checkout.state === 'booking_confirmed') {
            const updated = await CheckoutAttempt.updateOne({ _id: checkout._id, state: 'booking_confirmed', partner_order_id: partnerOrderId,
                cancellation_request_hash: cancellation.request_hash, refund_id: { $exists: false } }, { $set: { state: 'booking_cancelled',
                refund_amount_minor: cancellation.customer_refund_amount_minor, refund_status: 'pending', next_check_at: new Date() } });
            if (updated.matchedCount !== 1) throw fail('customer_refund_link_mismatch', 503);
        } else if (checkout.cancellation_request_hash !== cancellation.request_hash
            || !['booking_cancelled', 'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed', 'refund_review'].includes(checkout.state)) {
            throw fail('customer_refund_link_mismatch', 503);
        }
    }
    const Booking = mongoose.models.Booking;
    if (Booking) {
        await Booking.updateOne({ provider: 'ratehawk', $or: [{ supplierReference: partnerOrderId }, { bookingReference: partnerOrderId }] }, {
            $set: { status: 'cancelled', supplierStatus: 'CANCELLED' }
        });
    }
    await BookingProcess.updateOne({ partner_order_id: partnerOrderId }, {
        $set: { state: 'cancelled' }, $unset: { next_check_at: '', data_3ds: '' }
    });
}

function cancellationAmounts(result) {
    return { amount_refunded: result.amountRefunded, amount_payable: result.amountPayable, amount_sell: result.amountSell };
}

async function cancelBooking(partnerOrderId, options = {}) {
    const partnerId = orderId(partnerOrderId);
    if (options.confirm_cancellation !== true) throw fail('cancellation_confirmation_required');
    const penaltyKey = moneyKey(options.expected_penalty);
    const customerRefund = options.customer_refund;
    const refundKey = customerRefund && moneyKey(customerRefund);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify([partnerId, penaltyKey, options.acknowledge_upsells === true,
        options.confirm_customer_refund === true, refundKey])).digest('hex');
    const existing = await BookingCancellation.findById(partnerId).lean();
    if (existing) {
        if (existing.request_hash !== requestHash) throw fail('cancellation_request_conflict', 409);
        if (existing.state === 'cancelled') await syncCancelled(partnerId, existing);
        return view(existing);
    }
    if (process.env.RATEHAWK_CANCELLATION_ENABLED !== 'true') throw fail('cancellation_disabled', 503);
    const attempts = await CheckoutAttempt.find({ partner_order_id: partnerId }).limit(2).lean();
    if (attempts.length > 1) throw fail('customer_refund_link_mismatch', 503);
    const checkout = attempts[0];
    let refundAmountMinor;
    if (checkout) {
        if (checkout.state !== 'booking_confirmed' || !checkout.payment_verified_at || !checkout.ziina_intent_id
            || !Number.isSafeInteger(checkout.amount_minor) || checkout.amount_minor <= 0
            || !payment.isRefundReady() || checkout.ziina_account_id !== process.env.ZIINA_ACCOUNT_ID
            || process.env.ZIINA_TEST_MODE !== String(checkout.ziina_test)) throw fail('customer_refund_unavailable', 503);
        if (!checkout.supplier_identity || checkout.supplier_identity !== payment.supplierIdentity()) {
            throw fail('supplier_environment_mismatch', 503);
        }
        if (checkout.notification_status === 'sending' || checkout.lease_until && new Date(checkout.lease_until) > Date.now()) {
            throw fail('confirmation_delivery_pending', 409);
        }
        if (options.confirm_customer_refund !== true || !customerRefund) throw fail('customer_refund_authorization_required');
        if (customerRefund.currency_code !== checkout.currency || !/^\d+(?:\.\d{1,2})?$/.test(customerRefund.amount)) {
            throw fail('invalid_customer_refund_amount');
        }
        refundAmountMinor = Math.round(Number(customerRefund.amount) * 100);
        if (!Number.isSafeInteger(refundAmountMinor) || refundAmountMinor <= 0 || refundAmountMinor > checkout.amount_minor) {
            throw fail('invalid_customer_refund_amount');
        }
    } else if (customerRefund || options.confirm_customer_refund !== undefined) {
        throw fail('customer_refund_unavailable', 409);
    }
    const info = await getBookingInfo(partnerId);
    if (info.pending) throw fail('order_information_pending', 409);
    const alreadyCancelled = info.status === 'cancelled';
    if (!alreadyCancelled && (info.status !== 'completed' || info.isCancellable !== true)) throw fail('order_not_cancellable', 409);
    if (!alreadyCancelled && (!info.current_penalty || moneyKey(info.current_penalty) !== penaltyKey)) throw fail('cancellation_penalty_changed', 409);
    if (info.upsells_require_manual_cancellation && options.acknowledge_upsells !== true) throw fail('upsells_acknowledgement_required', 409);
    const record = {
        _id: partnerId,
        request_hash: requestHash,
        state: 'cancelling',
        ...(checkout ? { checkout_attempt_id: checkout._id, customer_refund_amount_minor: refundAmountMinor } : {}),
        accepted_penalty: info.current_penalty || { amount: options.expected_penalty.amount, currency_code: options.expected_penalty.currency_code },
        upsells_require_manual_cancellation: info.upsells_require_manual_cancellation,
        action_required: 'verify_supplier_cancellation',
        next_check_at: new Date(Date.now() + 120000)
    };
    try {
        await BookingCancellation.create(record);
    } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicate = await BookingCancellation.findById(partnerId).lean();
        if (!duplicate || duplicate.request_hash !== requestHash) throw fail('cancellation_request_conflict', 409);
        return view(duplicate);
    }
    if (checkout) {
        const claimed = await CheckoutAttempt.findOneAndUpdate({ _id: checkout._id, partner_order_id: partnerId,
            state: 'booking_confirmed', cancellation_request_hash: { $exists: false }, notification_status: { $ne: 'sending' },
            $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: new Date() } }] },
        { $set: { cancellation_request_hash: requestHash, next_check_at: null } }, { new: true }).lean();
        if (!claimed) {
            await BookingCancellation.updateOne({ _id: partnerId, state: 'cancelling' }, {
                $set: { state: 'cancel_failed', action_required: 'review_confirmation_delivery', next_check_at: null }
            });
            throw fail('confirmation_delivery_pending', 409);
        }
    }
    let result;
    if (alreadyCancelled) {
        result = { ...info, status: 'cancelled', success: true };
    } else {
        try {
            if (moneyKey(currentPenalty(info.order)) !== penaltyKey) throw fail('cancellation_penalty_changed', 409);
        } catch (error) {
            result = { success: false, pending: false, error: error.code || 'cancellation_policy_unavailable' };
        }
        if (!result) result = await ratehawk.submitCancellation(partnerId);
    }
    if (result.success) await syncCancelled(partnerId, record);
    const update = {
        state: result.success ? 'cancelled' : result.pending ? 'cancel_pending' : 'cancel_failed',
        ...cancellationAmounts(result),
        action_required: result.success ? 'review_customer_refund_and_upsells' : result.pending ? 'verify_supplier_cancellation' : 'review_cancellation_rejection',
        next_check_at: new Date(Date.now() + 60000)
    };
    if (result.error) update.error = result.error;
    const saved = await BookingCancellation.findOneAndUpdate({ _id: partnerId, state: 'cancelling' }, { $set: update }, { new: true }).lean();
    if (!saved) throw fail('cancellation_storage_conflict', 503);
    return view(saved);
}

async function checkCancellation(partnerOrderId) {
    const partnerId = orderId(partnerOrderId);
    const record = await BookingCancellation.findById(partnerId).lean();
    if (!record) throw fail('cancellation_not_found', 404);
    if (record.checkout_attempt_id) {
        const checkout = await CheckoutAttempt.findById(record.checkout_attempt_id).lean();
        if (!checkout || checkout.partner_order_id !== partnerId
            || !checkout.supplier_identity || checkout.supplier_identity !== payment.supplierIdentity()) {
            throw fail('supplier_environment_mismatch', 503);
        }
    }
    if (record.state === 'cancelled') await syncCancelled(partnerId, record);
    if (!PENDING.includes(record.state) || Number(record.next_check_at) > Date.now()) return view(record);
    const leaseId = crypto.randomUUID();
    const now = new Date(Date.now());
    const claimed = await BookingCancellation.findOneAndUpdate({
        _id: partnerId, state: { $in: PENDING }, next_check_at: { $lte: now },
        $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }]
    }, { $set: { check_lease_id: leaseId, check_lease_until: new Date(Date.now() + 35000) } }, { new: true }).lean();
    if (!claimed) return view(await BookingCancellation.findById(partnerId).lean());
    let info;
    try { info = await getBookingInfo(partnerId); }
    catch (error) { info = { success: false, error: 'order_info_unavailable', retry_after_ms: error.retry_after_ms }; }
    const cancelled = info.success && !info.pending && info.status === 'cancelled';
    if (cancelled) await syncCancelled(partnerId, claimed);
    const update = {
        $set: {
            state: cancelled ? 'cancelled' : 'cancel_pending',
            action_required: cancelled ? 'review_customer_refund_and_upsells' : 'verify_supplier_cancellation',
            next_check_at: new Date(Date.now() + Math.max(60000, Number.isFinite(info.retry_after_ms) ? info.retry_after_ms : 0)),
            ...(cancelled ? cancellationAmounts(info) : {})
        },
        $unset: { check_lease_id: '', check_lease_until: '', error: '' }
    };
    if (info.error) { update.$set.error = info.error; delete update.$unset.error; }
    const saved = await BookingCancellation.findOneAndUpdate({ _id: partnerId, state: { $in: PENDING }, check_lease_id: leaseId }, update, { new: true }).lean();
    return view(saved || await BookingCancellation.findById(partnerId).lean());
}

async function reconcilePendingCancellations() {
    const now = new Date(Date.now());
    const records = await BookingCancellation.find({
        state: { $in: PENDING }, next_check_at: { $lte: now },
        $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }]
    }).select('_id').sort({ next_check_at: 1 }).limit(10).lean();
    const results = await Promise.allSettled(records.map(record => checkCancellation(record._id)));
    return { checked: records.length, failed: results.filter(result => result.status === 'rejected').length };
}

module.exports = { getBookingInfo, cancelBooking, checkCancellation, reconcilePendingCancellations };