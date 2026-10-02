const crypto = require('node:crypto');
const express = require('express');

function secureKeyEquals(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createHotelbedsAvailabilityRouter({ service, verifyAPIKey, searchLimiter, env = process.env }) {
    if (!service || typeof service.searchAvailability !== 'function' || typeof verifyAPIKey !== 'function') {
        throw new TypeError('hotelbeds_availability_route_dependencies_invalid');
    }
    const router = express.Router();
    router.post('/availability-pilot', verifyAPIKey, searchLimiter || ((req, res, next) => next()), async (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        try {
            const expected = String(env.HOTELBEDS_PILOT_OPERATOR_KEY || '');
            if (expected.length < 32 || !secureKeyEquals(req.get('x-hotelbeds-operator-key'), expected)) {
                return res.status(403).json({ success: false, error: 'hotelbeds_pilot_operator_forbidden' });
            }
            const result = await service.searchAvailability(req.body || {});
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            const status = Number.isInteger(error.httpStatus) ? error.httpStatus : 502;
            return res.status(status).json({
                success: false,
                error: error.code || 'hotelbeds_availability_unavailable'
            });
        }
    });
    return router;
}

module.exports = createHotelbedsAvailabilityRouter;