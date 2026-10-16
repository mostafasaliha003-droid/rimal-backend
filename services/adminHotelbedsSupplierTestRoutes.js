const express = require('express');

function createAdminHotelbedsSupplierTestRouter({ controller, requireAdmin, searchLimiter } = {}) {
    if (typeof controller !== 'function' || typeof requireAdmin !== 'function') {
        throw new TypeError('admin_hotelbeds_supplier_test_routes_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof searchLimiter === 'function' ? searchLimiter : (_req, _res, next) => next();
    if (typeof controller.listHotels !== 'function') {
        throw new TypeError('admin_hotelbeds_supplier_test_routes_dependencies_invalid');
    }
    router.get('/pilot-list', requireAdmin, limiter, controller.listHotels);
    router.post('/supplier-test', requireAdmin, limiter, controller);
    return router;
}

module.exports = createAdminHotelbedsSupplierTestRouter;