function createHotelbedsReconciliationController({ service } = {}) {
    if (!service || typeof service.reconcileByClientReference !== 'function') {
        throw new TypeError('hotelbeds_reconciliation_controller_dependencies_invalid');
    }

    function noStore(res) {
        res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0' });
    }

    // Read-only operator view over the bounded BookingList reconciliation helper.
    // The service never mutates booking attempts; resolution stays a separate,
    // explicitly approved workflow.
    async function reconcile(req, res) {
        noStore(res);
        try {
            const result = await service.reconcileByClientReference(req.params.clientReference);
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            const status = [400, 404, 409, 429, 502, 503].includes(error?.httpStatus) ? error.httpStatus : 503;
            const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
                ? error.code : 'hotelbeds_reconciliation_unavailable';
            return res.status(status).json({ success: false, error: code });
        }
    }

    return { reconcile };
}

module.exports = createHotelbedsReconciliationController;
