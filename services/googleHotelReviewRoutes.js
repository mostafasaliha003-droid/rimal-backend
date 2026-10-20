const express = require('express');
const { LANGUAGES } = require('./googleHotelReviews');
module.exports = function createGoogleHotelReviewRoutes({ reviews, limiter } = {}) {
    const router = express.Router();
    router.get('/reviews/google/availability', (_req, res) => {
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json({ enabled: reviews.enabled() });
    });
    router.get('/:hid/reviews/google', limiter, async (req, res) => {
        res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
        const hid = String(req.params.hid), language = req.query.language || 'en';
        if (!/^\d{1,10}$/.test(hid) || !LANGUAGES.has(language)) return res.status(400).json({ status: 'invalid_request' });
        const result = await reviews.load(hid, language);
        if (result.status === 'limited') res.set('Retry-After', '60');
        return res.status(result.status === 'not_found' ? 404 : result.status === 'limited' ? 429 : 200).json(result);
    });
    return router;
};
