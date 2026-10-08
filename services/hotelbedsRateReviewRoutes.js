const express = require('express');

function createHotelbedsRateReviewRouter({ controller, requireUser, bookingLimiter } = {}) {
    if (typeof controller !== 'function' || typeof requireUser !== 'function') {
        throw new TypeError('hotelbeds_rate_review_route_dependencies_invalid');
    }
    const router = express.Router();
    router.post('/offers/review', requireUser,
        typeof bookingLimiter === 'function' ? bookingLimiter : (_req, _res, next) => next(), controller);
    return router;
}

module.exports = createHotelbedsRateReviewRouter;