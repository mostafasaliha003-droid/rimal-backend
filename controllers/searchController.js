function createSearchController({ orchestrator }) {
    if (!orchestrator || typeof orchestrator.performSearch !== 'function') {
        throw new TypeError('search_controller_orchestrator_invalid');
    }

    return async function searchController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        try {
            const result = await orchestrator.performSearch(req.body || {});
            return res.status(200).json(result);
        } catch (error) {
            const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 502;
            return res.status(status).json({
                success: false,
                error: typeof error?.code === 'string' ? error.code : 'hotel_search_unavailable'
            });
        }
    };
}

module.exports = createSearchController;