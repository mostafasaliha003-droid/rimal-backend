const express = require('express');

function createAffiliateBookingRouter({ service, securityService, verifyAPIKey }) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        next();
    });

    const sendError = (res, error) => {
        const status = [400, 401, 404, 409, 429, 502, 503].includes(error?.httpStatus)
            ? error.httpStatus : 503;
        const code = /^[a-z][a-z0-9_]{0,79}$/.test(error?.code || '')
            ? error.code : 'affiliate_booking_unavailable';
        return res.status(status).json({ success: false, error: code });
    };
    const accessToken = req => /^Bearer ([a-f\d]{64})$/i.exec(req.get('Authorization') || '')?.[1];

    router.get('/availability', (req, res) => res.json(service.getAvailability()));

    router.post('/hotels/:hid/rates', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
        try {
            const result = await service.getHotelPageRates({ ...(req.body || {}), hid: req.params.hid });
            return res.status(200).json(result);
        } catch (error) {
            return sendError(res, error);
        }
    });

    router.post('/bookings', verifyAPIKey, securityService.bookingLimiter, async (req, res) => {
        try {
            const created = await service.createProcess(req.body || {}, req.get('Idempotency-Key'), req.ip);
            // The server owns the one-shot finish transition. If the response is
            // lost, idempotent replay reads this state and cannot resend finish.
            if (created.status === 'form_ready') {
                try {
                    const finished = await service.finishProcess(created.process_id, created.access_token);
                    const result = { ...created, ...finished, access_token: created.access_token };
                    return res.status(result.status === 'processing' ? 202 : 200).json(result);
                } catch (error) {
                    // finishProcess converts ambiguous supplier responses into a
                    // durable processing state. Other errors must stay visible as
                    // safe failures so clients can retry the same idempotency key.
                    return sendError(res, error);
                }
            }
            return res.status(created.status === 'processing' ? 202 : 200).json(created);
        } catch (error) {
            return sendError(res, error);
        }
    });

    router.get('/bookings/:processId/status', verifyAPIKey, async (req, res) => {
        res.set('Vary', 'Authorization');
        try {
            const result = await service.checkStatus(req.params.processId, accessToken(req));
            return res.status(200).json(result);
        } catch (error) {
            const status = error?.httpStatus === 503 ? 503 : 404;
            return res.status(status).json({ success: false, error: status === 503 ? 'affiliate_booking_unavailable' : 'affiliate_booking_not_found' });
        }
    });

    return router;
}

module.exports = createAffiliateBookingRouter;