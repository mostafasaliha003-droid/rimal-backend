const express = require('express');
module.exports = function createRatehawkHotelReviewRoutes({ reviews, limiter, env = process.env }) {
    const router = express.Router();
    router.get('/:hid/reviews/ratehawk', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const hid = String(req.params.hid), language = req.query.language || 'en', offset = Number(req.query.offset || 0);
        if (!/^\d{1,10}$/.test(hid) || !['ar', 'en', 'es'].includes(language) || !Number.isSafeInteger(offset) || offset < 0 || offset > 200) return res.status(400).json({ status: 'invalid_request' });
        const result = await reviews.load(hid, language, offset);
        if (result.status === 'checking') res.set('Retry-After', '3');
        return res.status(result.status === 'not_found' ? 404 : 200).json({ ...result,
            googleAvailable: env.GOOGLE_REVIEWS_ENABLED === 'true' && Boolean(env.GOOGLE_PLACES_API_KEY?.trim()) });
    });
    return router;
};
