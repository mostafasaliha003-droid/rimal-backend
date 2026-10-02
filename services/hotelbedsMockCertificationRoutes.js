const express = require('express');

function createHotelbedsMockCertificationRouter({
    service,
    searchLimiter = (req, res, next) => next(),
    enabled = () => process.env.HOTELBEDS_MOCK_CERTIFICATION_ENABLED === 'true'
} = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        next();
    });

    router.get('/mock-certification-flow', searchLimiter, async (req, res) => {
        if (!enabled()) return res.status(404).json({ success: false, error: 'not_found' });
        try {
            const result = await service.getMockCertificationFlow();
            return res.status(200).json(result);
        } catch {
            return res.status(503).json({ success: false, error: 'hotelbeds_mock_certification_unavailable' });
        }
    });

    return router;
}

module.exports = createHotelbedsMockCertificationRouter;