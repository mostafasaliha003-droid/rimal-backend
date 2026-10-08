const express = require('express');

function createHotelbedsReconciliationRouter({ controller, requireAdmin, searchLimiter } = {}) {
    if (!controller || typeof controller.reconcile !== 'function' || typeof requireAdmin !== 'function') {
        throw new TypeError('hotelbeds_reconciliation_routes_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof searchLimiter === 'function' ? searchLimiter : (_req, _res, next) => next();
    router.get('/reconciliations/:clientReference', requireAdmin, limiter, controller.reconcile);
    return router;
}

module.exports = createHotelbedsReconciliationRouter;
