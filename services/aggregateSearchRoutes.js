const express = require('express');

function createAggregateSearchRouter({
    controller,
    access,
    internalAuth,
    searchLimiter,
    routePath = '/search/aggregate'
} = {}) {
    if (typeof controller !== 'function' || !['public', 'internal'].includes(access)
        || access === 'internal' && typeof internalAuth !== 'function'
        || typeof routePath !== 'string' || !/^\/[a-z0-9/_-]+$/i.test(routePath)) {
        throw new TypeError('aggregate_search_route_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof searchLimiter === 'function'
        ? searchLimiter : (_req, _res, next) => next();
    router.post(routePath, ...(access === 'internal' ? [internalAuth] : []), limiter, controller);
    return router;
}

module.exports = createAggregateSearchRouter;