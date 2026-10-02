const express = require('express');

function createAggregateSearchRouter({
    controller,
    verifyAPIKey,
    searchLimiter,
    routePath = '/search/aggregate'
} = {}) {
    if (typeof controller !== 'function' || typeof verifyAPIKey !== 'function'
        || typeof routePath !== 'string' || !/^\/[a-z0-9/_-]+$/i.test(routePath)) {
        throw new TypeError('aggregate_search_route_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof searchLimiter === 'function'
        ? searchLimiter : (_req, _res, next) => next();
    router.post(routePath, verifyAPIKey, limiter, controller);
    return router;
}

module.exports = createAggregateSearchRouter;