function createAdminHotelbedsSupplierTestController({ service } = {}) {
    if (!service || typeof service.run !== 'function' || typeof service.listHotels !== 'function') {
        throw new TypeError('admin_hotelbeds_supplier_test_controller_dependencies_invalid');
    }

    function sendFailure(res, error) {
        const status = [400, 403, 409, 429, 502, 503].includes(error?.httpStatus) ? error.httpStatus : 503;
        const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
            ? error.code : 'hotelbeds_supplier_test_unavailable';
        return res.status(status).json({ success: false, error: code });
    }

    function noStore(res) {
        res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0' });
    }

    async function adminHotelbedsSupplierTestController(req, res) {
        noStore(res);
        try {
            const report = await service.run(req.body);
            return res.status(200).json(report);
        } catch (error) {
            return sendFailure(res, error);
        }
    }

    adminHotelbedsSupplierTestController.listHotels = function listAdminHotelbedsPilotHotels(_req, res) {
        noStore(res);
        try { return res.status(200).json(service.listHotels()); }
        catch (error) { return sendFailure(res, error); }
    };

    return adminHotelbedsSupplierTestController;
}

module.exports = createAdminHotelbedsSupplierTestController;