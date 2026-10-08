function createHotelbedsRateReviewController({ service } = {}) {
    if (!service || typeof service.createReview !== 'function') {
        throw new TypeError('hotelbeds_rate_review_controller_dependencies_invalid');
    }
    return async function hotelbedsRateReviewController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        try {
            const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
            const result = await service.createReview({
                publicOfferId: body.publicOfferId,
                ownerSubject: req.auth?.subject,
                idempotencyKey: req.get('Idempotency-Key')
            });
            return res.status(200).json(result);
        } catch (error) {
            const status = [400, 403, 404, 409, 429, 502, 503].includes(error?.httpStatus)
                ? error.httpStatus : 503;
            const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
                ? error.code : 'hotelbeds_rate_review_unavailable';
            return res.status(status).json({ success: false, error: code });
        }
    };
}

module.exports = createHotelbedsRateReviewController;