const express = require('express');

function createSearchRouter({ controller, searchLimiter }) {
    if (typeof controller !== 'function') {
        throw new TypeError('search_route_dependencies_invalid');
    }

    const router = express.Router();
    const limiter = typeof searchLimiter === 'function'
        ? searchLimiter
        : (req, res, next) => next();

    router.post('/search', (req, res, next) => {
        if (String(req.body?.provider || '').trim().toLowerCase() === 'hotelbeds') return next();
        return next('route');
    }, limiter, controller);

    router.post('/search/hotelbeds', limiter, controller);
    return router;
}

module.exports = createSearchRouter;