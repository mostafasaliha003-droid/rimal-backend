const CheckoutAttempt = require('../models/CheckoutAttempt');
const BookingProcess = require('../models/BookingProcess');
const payment = require('./paymentService');

const amountKey = value => /^\d+(?:\.\d+)?$/.test(String(value))
    ? String(value).replace(/^0+(?=\d)/, '').replace(/\.0*$/, '').replace(/(\.\d*?)0+$/, '$1') : null;

// Only the validated prebook response supplies these terms. Never copy policy,
// refund or cancellation fields supplied by the checkout browser.
function createSnapshot(info, details, selected) {
    const hotel = info?.hotels?.[0];
    const rate = hotel?.rates?.[0];
    if (info?.hotels?.length !== 1 || hotel?.rates?.length !== 1
        || Number(hotel.hid) !== details.hid || rate.room_name !== details.roomName) {
        throw new Error('prebook_snapshot_identity_mismatch');
    }
    const option = rate.payment_options?.payment_types?.find(item => item.type === selected.type
        && item.currency_code === selected.currency_code && amountKey(item.amount) !== null
        && amountKey(item.amount) === amountKey(selected.amount));
    if (!option) throw new Error('prebook_snapshot_payment_mismatch');
    const policies = option.cancellation_penalties?.policies;
    return {
        version: 1, hid: details.hid, room_name: rate.room_name,
        checkin: details.checkin, checkout: details.checkout,
        payment: { type: selected.type, amount: String(selected.amount), currency_code: selected.currency_code },
        ...(typeof rate.meal === 'string' ? { meal: rate.meal } : {}),
        cancellation_info: { policies: Array.isArray(policies) ? policies.map(policy => ({
            start_at: policy.start_at, end_at: policy.end_at,
            // amount_charge is denominated in this payment's currency_code.
            // amount_show must never be paired with the settlement currency.
            ...(amountKey(policy.amount_charge) !== null ? { penalty: {
                amount: String(policy.amount_charge), currency_code: option.currency_code
            } } : {})
        })) : [] },
        upsells: Array.isArray(info.upsell_data) ? info.upsell_data.map(item => ({ name: item.name })) : []
    };
}

async function readLocalBookingInfo(partnerOrderId) {
    const records = await CheckoutAttempt.find({ partner_order_id: partnerOrderId }).limit(2).lean();
    const record = records[0];
    if (records.length !== 1 || !record.payment_verified_at || !record.supplier_identity
        || record.supplier_identity !== payment.supplierIdentity() || record.prebook_snapshot?.version !== 1) {
        return { success: false, error: 'local_booking_details_unavailable', httpStatus: 409 };
    }
    const process = await BookingProcess.findOne({ _id: record.booking_process_id, partner_order_id: partnerOrderId }).lean();
    if (!process || !['confirmed', 'cancelled'].includes(process.state)) {
        return { success: true, pending: true, order: null, retry_after_ms: 5000 };
    }
    const snapshot = record.prebook_snapshot;
    const order = { cancellation_info: snapshot.cancellation_info };
    return { success: true, pending: false, found: 1, source: 'persisted_prebook',
        order, status: process.state === 'cancelled' ? 'cancelled' : 'completed',
        // A known current penalty and explicit customer consent are still
        // required by postBookingService. The cancel endpoint can reject the
        // request; a local snapshot never proves supplier cancellation success.
        isCancellable: process.state === 'confirmed',
        roomName: snapshot.room_name, checkin: snapshot.checkin, checkout: snapshot.checkout,
        payment: snapshot.payment, upsells: snapshot.upsells || [] };
}

module.exports = { createSnapshot, readLocalBookingInfo };
