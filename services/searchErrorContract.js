const LOCAL_QUOTA_CODES = new Set([
    'hotelbeds_rate_limited',
    'hotelbeds_daily_quota_exhausted',
    'hotelbeds_operation_daily_budget_exhausted'
]);
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

function safeRetryAfterSecondsFromMs(value) {
    return Number.isFinite(value) && value > 0
        ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(value / 1000))) : null;
}

function responseForSearchError(error) {
    const status = [400, 403, 404, 409, 429, 502, 503].includes(error?.httpStatus)
        ? error.httpStatus : 502;
    if (error?.code === 'hotelbeds_supplier_access_ambiguous') {
        return { status: 502, code: 'hotelbeds_supplier_access_ambiguous' };
    }
    if (status === 429 && LOCAL_QUOTA_CODES.has(error?.code)) {
        const retryAfterSeconds = safeRetryAfterSecondsFromMs(error.retryAfterMs);
        return {
            status,
            code: 'hotelbeds_local_quota_exhausted',
            quotaScope: ['burst', 'daily', 'operation_daily'].includes(error.quotaScope) ? error.quotaScope : 'unknown',
            ...(retryAfterSeconds ? { retryAfterSeconds } : {})
        };
    }
    if (status === 429 && error?.code === 'local_search_rate_limited') {
        const retryAfterSeconds = safeRetryAfterSecondsFromMs(error.retryAfterMs);
        return { status, code: 'local_search_rate_limited', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
    }
    if (status === 429 && error?.code === 'hotelbeds_supplier_rate_limited') {
        return { status, code: 'hotelbeds_supplier_rate_limited' };
    }
    if (status === 503) return { status, code: 'hotel_search_temporarily_unavailable' };
    if (status === 502) return { status, code: 'hotel_search_unavailable' };
    const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
        ? error.code : 'hotel_search_unavailable';
    return { status, code };
}

function sendSearchError(res, error) {
    const result = responseForSearchError(error);
    if (result.retryAfterSeconds) res.set('Retry-After', String(result.retryAfterSeconds));
    return res.status(result.status).json({
        success: false,
        error: result.code,
        ...(result.quotaScope ? { quotaScope: result.quotaScope } : {}),
        ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
    });
}

module.exports = { LOCAL_QUOTA_CODES, safeRetryAfterSecondsFromMs, responseForSearchError, sendSearchError };