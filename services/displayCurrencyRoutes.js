const express = require('express');

function createDisplayCurrencyRouter(service) {
    if (!service || typeof service.getRates !== 'function') {
        throw new TypeError('A display-currency service is required');
    }
    const router = express.Router();
    router.get('/display-rates', async (req, res) => {
        res.vary('Accept-Encoding');
        try {
            const rates = await service.getRates();
            res.set('Cache-Control', rates.stale
                ? 'public, max-age=0, stale-while-revalidate=300'
                : 'public, max-age=900, stale-while-revalidate=3600');
            return res.json({ success: true, ...rates });
        } catch {
            res.set('Cache-Control', 'no-store');
            return res.status(503).json({ success: false, error: 'DISPLAY_RATES_UNAVAILABLE' });
        }
    });
    return router;
}

module.exports = createDisplayCurrencyRouter;