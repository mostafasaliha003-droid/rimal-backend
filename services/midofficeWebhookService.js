const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const MidofficeWebhook = require('../models/MidofficeWebhook');
const BookingProcess = require('../models/BookingProcess');
const ratehawk = require('./ratehawkService');

const EVENT_TYPES = new Set(['created', 'updated', 'cancelled']);

function invalidPayload() {
    return Object.assign(new Error('invalid_midoffice_payload'), {
        code: 'invalid_midoffice_payload', httpStatus: 400
    });
}

function parseMidofficeWebhook(payload) {
    const data = payload?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || typeof data.partner_order_id !== 'string' || !data.partner_order_id.trim()
        || data.partner_order_id.length > 256 || !EVENT_TYPES.has(data.type)
        || (data.agreement_number !== undefined && typeof data.agreement_number !== 'string')) {
        throw invalidPayload();
    }
    return {
        partnerOrderId: data.partner_order_id,
        agreementNumber: data.agreement_number,
        eventType: data.type
    };
}

function fail(code, httpStatus) {
    return Object.assign(new Error(code), { code, httpStatus });
}

async function handleMidofficeWebhook(payload) {
    const apiKey = process.env.ETG_MIDOFFICE_API_KEY;
    if (!apiKey) throw fail('midoffice_not_configured', 500);
    if (!ratehawk.verifyWebhookSignature(payload, apiKey).verified) {
        throw fail('invalid_midoffice_signature', 401);
    }
    if (payload.signature.timestamp > Math.floor(Date.now() / 1000) + 300) {
        throw fail('invalid_midoffice_timestamp', 401);
    }
    const { partnerOrderId, agreementNumber, eventType } = parseMidofficeWebhook(payload);
    const receiptId = crypto.createHash('sha256').update(payload.signature.token).digest('hex');
    const payloadHash = crypto.createHash('sha256')
        .update(JSON.stringify([partnerOrderId, agreementNumber ?? null, eventType])).digest('hex');
    try {
        await MidofficeWebhook.create({
            _id: receiptId, payload_hash: payloadHash, partner_order_id: partnerOrderId,
            ...(agreementNumber === undefined ? {} : { agreement_number: agreementNumber }),
            event_type: eventType, action_required: 'reconcile_supplier_booking',
            state: 'pending', next_check_at: new Date()
        });
        return { success: true, received: true };
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    const receipt = await MidofficeWebhook.findById(receiptId).lean();
    if (!receipt) throw fail('midoffice_storage_unavailable', 500);
    if (receipt.payload_hash !== payloadHash) throw fail('midoffice_replay_conflict', 409);
    return { success: true, received: true, duplicate: true };
}

async function reconcileMidofficeReceipt(receiptId) {
    const leaseId = crypto.randomUUID();
    const now = new Date();
    const receipt = await MidofficeWebhook.findOneAndUpdate({
        _id: receiptId, state: 'pending', next_check_at: { $lte: now },
        $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }]
    }, { $set: { check_lease_id: leaseId, check_lease_until: new Date(Date.now() + 60000) } }, { new: true }).lean();
    if (!receipt) return;

    let update;
    let attempts = Number.isSafeInteger(receipt.reconciliation_attempts) && receipt.reconciliation_attempts >= 0
        ? receipt.reconciliation_attempts : 0;
    const retryOrReview = retryAfterMs => attempts >= 10
        ? { state: 'review_required', action_required: 'verify_supplier_order_manually', reconciliation_attempts: attempts }
        : { state: 'pending', action_required: 'reconcile_supplier_booking', reconciliation_attempts: attempts,
            next_check_at: new Date(Date.now() + Math.max(60000, Number.isFinite(retryAfterMs) ? retryAfterMs : 0)) };
    try {
        attempts += 1;
        const partnerOrderId = receipt.partner_order_id;
        const process = await BookingProcess.findOne({ partner_order_id: partnerOrderId }).lean();
        const Booking = mongoose.models.Booking;
        const booking = !process && Booking && await Booking.findOne({
            provider: 'ratehawk', $or: [{ supplierReference: partnerOrderId }, { bookingReference: partnerOrderId }]
        }).lean();
        if (!process && !booking) {
            update = { state: 'review_required', action_required: 'verify_midoffice_order_ownership',
                reconciliation_attempts: attempts };
        } else {
            const result = await ratehawk.retrieveBookings({
                search: { partner_order_ids: [partnerOrderId] }, pagination: { page_number: 1, page_size: 1 }
            }, { redactPayload: true });
            const order = result.orders.length === 1 && result.found_orders === 1 ? result.orders[0] : null;
            if (!order || order.partner_data?.order_id !== partnerOrderId) {
                update = retryOrReview();
            } else {
                const actions = {
                    cancelled: 'review_customer_refund_and_upsells',
                    completed: 'verify_payment_before_customer_confirmation',
                    failed: 'review_payment_and_refund'
                };
                update = { state: 'review_required', supplier_status: Object.hasOwn(actions, order.status) ? order.status : 'unknown',
                    reconciliation_attempts: attempts,
                    action_required: Object.hasOwn(actions, order.status) ? actions[order.status] : 'review_supplier_booking_status' };
            }
        }
    } catch (error) {
        update = retryOrReview(error.retry_after_ms);
    }
    const saved = await MidofficeWebhook.updateOne({ _id: receiptId, state: 'pending', check_lease_id: leaseId }, {
        $set: update, $unset: { check_lease_id: '', check_lease_until: '' }
    });
    if (saved.matchedCount !== 1) throw fail('midoffice_storage_unavailable', 500);
}

async function reconcilePendingMidofficeWebhooks() {
    if (process.env.ETG_MIDOFFICE_RECONCILIATION_ENABLED !== 'true') return { checked: 0, failed: 0 };
    const now = new Date();
    const receipts = await MidofficeWebhook.find({
        state: 'pending', next_check_at: { $lte: now },
        $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }]
    }).select('_id').sort({ next_check_at: 1 }).limit(10).lean();
    const results = await Promise.allSettled(receipts.map(receipt => reconcileMidofficeReceipt(receipt._id)));
    return { checked: receipts.length, failed: results.filter(result => result.status === 'rejected').length };
}

function createMidofficeWebhookRouter() {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        const end = res.end;
        res.end = function (...args) {
            res.removeHeader('ETag');
            return end.apply(this, args);
        };
        if (req.get('Origin')) return res.status(403).json({ success: false, error: 'server_to_server_only' });
        next();
    });
    router.use(express.json({ limit: '8kb' }));
    router.use((error, req, res, next) => {
        if (error?.status >= 400 && error?.status < 500) {
            return res.status(400).json({ success: false, error: 'invalid_midoffice_payload' });
        }
        next(error);
    });
    router.post('/', async (req, res) => {
        if (Object.keys(req.query).length || !req.is('application/json') || !req.body
            || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ success: false, error: 'invalid_midoffice_payload' });
        }
        try {
            return res.status(200).json(await handleMidofficeWebhook(req.body));
        } catch (error) {
            const statuses = {
                invalid_midoffice_payload: 400, invalid_midoffice_signature: 401,
                invalid_midoffice_timestamp: 401, midoffice_replay_conflict: 409,
                midoffice_not_configured: 500, midoffice_storage_unavailable: 500
            };
            const status = Object.hasOwn(statuses, error?.code) && statuses[error.code] === error.httpStatus
                ? error.httpStatus : 500;
            if (status === 500) res.set('Retry-After', '30');
            return res.status(status).json({ success: false,
                error: status === 500 ? 'midoffice_unavailable' : error.code });
        }
    });
    return router;
}

module.exports = { parseMidofficeWebhook, handleMidofficeWebhook, reconcilePendingMidofficeWebhooks, createMidofficeWebhookRouter };