const express = require('express');

function createSearchRouter({ controller, verifyAPIKey, searchLimiter }) {
    if (typeof controller !== 'function' || typeof verifyAPIKey !== 'function') {
        throw new TypeError('search_route_dependencies_invalid');
    }

    const router = express.Router();
    const limiter = typeof searchLimiter === 'function'
        ? searchLimiter
        : (req, res, next) => next();

    router.post('/search', (req, res, next) => {
        if (String(req.body?.provider || '').trim().toLowerCase() === 'hotelbeds') return next();
        return next('route');
    }, verifyAPIKey, limiter, controller);

    router.post('/search/hotelbeds', verifyAPIKey, limiter, controller);
    return router;
}

module.exports = createSearchRouter;