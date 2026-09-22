const crypto = require('node:crypto');
const mongoose = require('mongoose');
const BookingCancellation = require('../models/BookingCancellation');
const BookingProcess = require('../models/BookingProcess');
const ratehawk = require('./ratehawkService');

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

function view(record) {
    return {
        partner_order_id: record._id,
        success: record.state === 'cancelled',
        status: record.state,
        pending: PENDING.includes(record.state),
        amountRefunded: record.amount_refunded || null,
        amountPayable: record.amount_payable || null,
        amountSell: record.amount_sell || null,
        customer_refund_status: 'not_processed',
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

async function syncCancelled(partnerOrderId) {
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
    const requestHash = crypto.createHash('sha256').update(JSON.stringify([partnerId, penaltyKey, options.acknowledge_upsells === true])).digest('hex');
    const existing = await BookingCancellation.findById(partnerId).lean();
    if (existing) {
        if (existing.request_hash !== requestHash) throw fail('cancellation_request_conflict', 409);
        if (existing.state === 'cancelled') await syncCancelled(partnerId);
        return view(existing);
    }
    if (process.env.RATEHAWK_CANCELLATION_ENABLED !== 'true') throw fail('cancellation_disabled', 503);
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
    if (result.success) await syncCancelled(partnerId);
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
    if (record.state === 'cancelled') await syncCancelled(partnerId);
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
    if (cancelled) await syncCancelled(partnerId);
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