const express = require('express');

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