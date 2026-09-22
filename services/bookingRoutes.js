const express = require('express');
const crypto = require('node:crypto');
const booking = require('./bookingProcessService');
const { bookingLimiter } = require('./securityService');

function authorize(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const secret = process.env.RATEHAWK_BOOKING_TOKEN;
    if (!secret || secret.length < 32 || secret === process.env.REMAL_SECURE_KEY) {
        return res.status(503).json({ success: false, error: 'booking_auth_not_configured' });
    }
    const token = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '')?.[1];
    const digest = value => crypto.createHash('sha256').update(value).digest();
    if (!token || !crypto.timingSafeEqual(digest(token), digest(secret))) {
        return res.status(401).json({ success: false, error: 'unauthorized' });
    }
    if (req.get('Origin')) return res.status(403).json({ success: false, error: 'server_to_server_only' });
    next();
}

function enabled(req, res, next) {
    if (process.env.RATEHAWK_BOOKING_ENABLED !== 'true') return res.status(503).json({ success: false, error: 'booking_disabled' });
    next();
}

function handle(operation) {
    return async (req, res) => {
        try {
            const result = await operation(req);
            res.status(['creating', 'card_pending', 'finishing', 'processing'].includes(result.status) ? 202 : 200).json(result);
        } catch (error) {
            const known = typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code);
            const status = known && [400, 404, 409, 429, 502, 503].includes(error.httpStatus) ? error.httpStatus : 503;
            res.status(status).json({ success: false, error: known ? error.code : 'booking_service_unavailable' });
        }
    };
}

function createBookingRouter() {
    const router = express.Router();
    router.post('/form', authorize, enabled, bookingLimiter, handle(req => booking.createProcess(req.body || {}, req.get('Idempotency-Key'))));
    router.post('/card-token', authorize, enabled, bookingLimiter, handle(req => booking.tokenizeCard(req.body?.process_id, req.body || {})));
    router.post('/finish', authorize, enabled, bookingLimiter, handle(req => booking.finishProcess(req.body?.process_id, req.body || {})));
    router.post('/status', authorize, handle(req => booking.checkProcess(req.body?.process_id)));
    return router;
}

module.exports = createBookingRouter;