const crypto = require('node:crypto');
const mongoose = require('mongoose');
const BookingWebhook = require('../models/BookingWebhook');
const BookingProcess = require('../models/BookingProcess');
const ratehawk = require('./ratehawkService');
const processes = require('./bookingProcessService');

function fail(code, httpStatus) {
    return Object.assign(new Error(code), { code, httpStatus });
}

async function handleRateHawkWebhook(payload = {}) {
    const signature = ratehawk.verifyWebhookSignature(payload);
    if (!signature.verified) throw fail(signature.reason === 'missing_api_key' ? 'webhook_not_configured' : 'invalid_signature', signature.reason === 'missing_api_key' ? 503 : 401);
    const { partnerOrderId, rawStatus, confirmed, failed } = ratehawk.parseWebhook(payload);
    if (!partnerOrderId?.trim() || (!confirmed && !failed)) throw fail('invalid_webhook_payload', 400);
    if (payload.signature.timestamp > Math.floor(Date.now() / 1000) + 300) throw fail('invalid_webhook_timestamp', 401);
    const receiptId = crypto.createHash('sha256').update(payload.signature.token).digest('hex');
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify([partnerOrderId, rawStatus])).digest('hex');
    let receipt = await BookingWebhook.findById(receiptId).lean();
    if (!receipt) {
        try {
            receipt = await BookingWebhook.create({ _id: receiptId, payload_hash: payloadHash, partner_order_id: partnerOrderId, reported_status: rawStatus, state: 'received' });
        } catch (error) {
            if (error.code !== 11000) throw error;
            receipt = await BookingWebhook.findById(receiptId).lean();
        }
    }
    if (!receipt || receipt.payload_hash !== payloadHash) throw fail('webhook_replay_conflict', 409);
    if (receipt.state === 'processed') return { success: true, received: true, duplicate: true };
    const leaseId = crypto.randomUUID();
    const claimed = await BookingWebhook.findOneAndUpdate({
        _id: receiptId, state: { $ne: 'processed' },
        $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: new Date() } }]
    }, { $set: { state: 'processing', lease_id: leaseId, lease_until: new Date(Date.now() + 60000) } }, { new: true }).lean();
    if (!claimed) throw fail('webhook_processing', 503);
    try {
        const process = await BookingProcess.findOne({ partner_order_id: partnerOrderId }).lean();
        const Booking = mongoose.models.Booking;
        const bookingFilter = { provider: 'ratehawk', $or: [{ supplierReference: partnerOrderId }, { bookingReference: partnerOrderId }] };
        let result;
        if (process) {
            result = await processes.checkProcess(process._id);
        } else {
            const booking = Booking && await Booking.findOne(bookingFilter).lean();
            if (!booking) throw fail('webhook_order_not_found', 503);
            result = ['cancelled', 'canceled'].includes(booking.status) || ['CANCELLED', 'CANCELED'].includes(booking.supplierStatus)
                ? { status: 'cancelled' } : await ratehawk.checkBookingProcess(partnerOrderId);
        }
        if (!['confirmed', 'failed', 'cancelled'].includes(result.status)) throw fail('webhook_status_pending', 503);
        if (Booking && result.status !== 'cancelled') {
            await Booking.updateOne({ ...bookingFilter, status: { $nin: ['cancelled', 'canceled'] }, supplierStatus: { $nin: ['CONFIRMED', 'CONFIRMED_LIVE', 'FAILED', 'CANCELLED_BY_HOTEL', 'CANCELLED', 'CANCELED'] } }, {
                $set: { supplierStatus: result.status === 'confirmed' ? 'CONFIRMED' : 'FAILED', ...(result.status === 'failed' ? { status: 'failed' } : {}) }
            });
        }
        const saved = await BookingWebhook.updateOne({ _id: receiptId, lease_id: leaseId }, {
            $set: {
                state: 'processed', outcome: result.status, processed_at: new Date(),
                action_required: result.status === 'cancelled' ? 'review_customer_refund_and_upsells'
                    : result.status === 'confirmed' ? 'verify_payment_before_customer_confirmation' : 'review_payment_and_refund'
            },
            $unset: { lease_id: '', lease_until: '' }
        });
        if (saved.matchedCount !== 1) throw fail('webhook_storage_conflict', 503);
        return { success: true, received: true };
    } catch (error) {
        await BookingWebhook.updateOne({ _id: receiptId, lease_id: leaseId }, { $set: { state: 'received' }, $unset: { lease_id: '', lease_until: '' } });
        throw error;
    }
}

async function receiveRateHawkWebhook(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
        res.status(200).json(await handleRateHawkWebhook(req.body));
    } catch (error) {
        const known = [400, 401, 409, 503].includes(error.httpStatus) && typeof error.code === 'string' && /^[a-z_]+$/.test(error.code);
        const status = known ? error.httpStatus : 503;
        if (status === 503) res.set('Retry-After', '30');
        res.status(status).json({ success: false, error: known ? error.code : 'webhook_service_unavailable' });
    }
}

module.exports = { handleRateHawkWebhook, receiveRateHawkWebhook };
