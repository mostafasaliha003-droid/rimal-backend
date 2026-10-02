function createAggregateSearchController({
    service,
    enabled = () => process.env.MULTI_SUPPLIER_MOCK_SEARCH_ENABLED === 'true',
    requiredSchemaVersion
} = {}) {
    if (!service || typeof service.performSearch !== 'function' || typeof enabled !== 'function'
        || requiredSchemaVersion !== undefined && requiredSchemaVersion !== 2) {
        throw new TypeError('aggregate_search_controller_dependencies_invalid');
    }

    return async function aggregateSearchController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        if (!enabled()) return res.status(404).json({ success: false, error: 'not_found' });
        try {
            const result = await service.performSearch(req.body || {});
            if (requiredSchemaVersion !== undefined && result?.schemaVersion !== requiredSchemaVersion) {
                throw Object.assign(new Error('aggregate_response_schema_invalid'), {
                    code: 'aggregate_response_schema_invalid', httpStatus: 502
                });
            }
            return res.status(200).json(result);
        } catch (error) {
            const status = [400, 403, 404, 429, 502, 503].includes(error?.httpStatus)
                ? error.httpStatus : 502;
            return res.status(status).json({
                success: false,
                error: typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
                    ? error.code : 'hotel_search_unavailable'
            });
        }
    };
}

module.exports = createAggregateSearchController;