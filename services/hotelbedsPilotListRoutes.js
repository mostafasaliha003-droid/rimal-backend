const express = require('express');

// The approved pilot ID list contains no secrets and performs no supplier or
// database work, so the route is intentionally public behind the search rate
// limiter: the browser must never hold a supplier or shared key.
function createHotelbedsPilotListRouter({ controller, searchLimiter } = {}) {
    if (typeof controller !== 'function') {
        throw new TypeError('hotelbeds_pilot_list_route_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof searchLimiter === 'function'
        ? searchLimiter : (_req, _res, next) => next();
    router.get('/pilot-list', limiter, controller);
    return router;
}

module.exports = createHotelbedsPilotListRouter;