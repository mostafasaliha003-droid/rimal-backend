const axios = require('axios');
const logger = require('./loggerService');
const limiter = require('./hotelbedsRateLimiter');
const { credentialsFrom } = require('./hotelbedsClient');
const { generateSignature, buildAuthenticationHeaders } = require('./hotelbedsAuthentication');
const { operationBudgetFor } = require('./hotelbedsRateLimiter');

const TEST_CONTENT_BASE_URL = 'https://api.test.hotelbeds.com';
const HOTEL_CONTENT_PATH = '/hotel-content-api/1.0/hotels';
const HOTEL_CATEGORIES_PATH = '/hotel-content-api/1.0/types/categories';
const MAX_PAGE_SIZE = 1000;

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function contentConfigurationFrom(env = process.env) {
    if (env.HOTELBEDS_ENABLED !== 'true') throw fail('hotelbeds_disabled', 503);
    if (String(env.HOTELBEDS_ENV || 'test').trim().toLowerCase() !== 'test') {
        throw fail('hotelbeds_environment_not_supported', 503);
    }
    const { apiKey, secret, accountConfig } = credentialsFrom(env);
    const configuredBaseUrl = String(env.HOTELBEDS_CONTENT_BASE_URL || TEST_CONTENT_BASE_URL).trim();
    let parsed;
    try { parsed = new URL(configuredBaseUrl); } catch { throw fail('hotelbeds_content_endpoint_invalid', 503); }
    if (configuredBaseUrl.replace(/\/+$/, '') !== TEST_CONTENT_BASE_URL
        || parsed.protocol !== 'https:' || parsed.hostname !== new URL(TEST_CONTENT_BASE_URL).hostname
        || parsed.port || parsed.search || parsed.hash
        || parsed.pathname !== '/' && parsed.pathname !== '') {
        throw fail('hotelbeds_content_endpoint_invalid', 503);
    }
    return { apiKey, secret, accountConfig, baseUrl: TEST_CONTENT_BASE_URL };
}

function buildPagedContentQuery({ language, from, to, lastUpdateTime, fields = 'all', codes } = {}, normalizeCode) {
    const normalizedLanguage = String(language || '').trim().toUpperCase();
    const first = Number(from);
    const last = Number(to);
    if (!/^[A-Z]{2,12}$/.test(normalizedLanguage)
        || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)
        || first < 1 || last < first || last - first + 1 > MAX_PAGE_SIZE) {
        throw fail('hotelbeds_content_query_invalid');
    }

    const query = { fields: String(fields).trim(), language: normalizedLanguage, from: first, to: last };
    if (!query.fields || query.fields.length > 100) throw fail('hotelbeds_content_fields_invalid');
    if (codes !== undefined) {
        if (typeof normalizeCode !== 'function' || !Array.isArray(codes) || codes.length < 1 || codes.length > MAX_PAGE_SIZE) {
            throw fail('hotelbeds_content_codes_invalid');
        }
        const normalizedCodes = codes.map(normalizeCode);
        if (normalizedCodes.some(code => code === null) || new Set(normalizedCodes).size !== normalizedCodes.length) {
            throw fail('hotelbeds_content_codes_invalid');
        }
        // The Content API declares `codes` as a non-exploded query array.
        query.codes = normalizedCodes.join(',');
    }
    if (lastUpdateTime !== undefined && lastUpdateTime !== null && lastUpdateTime !== '') {
        const value = String(lastUpdateTime).trim();
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
        if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
            throw fail('hotelbeds_content_last_update_invalid');
        }
        query.lastUpdateTime = value;
    }
    return query;
}

function buildHotelContentQuery(options = {}) {
    return buildPagedContentQuery(options, value => {
        const code = Number(value);
        return Number.isSafeInteger(code) && code > 0 && code <= 2147483647 ? String(code) : null;
    });
}

function buildHotelCategoryQuery(options = {}) {
    return buildPagedContentQuery(options, value => {
        const code = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
        return /^[A-Za-z0-9._-]{1,40}$/.test(code) ? code : null;
    });
}

function createHotelbedsContentClient({
    http = axios.create({ validateStatus: () => true }),
    requestLimiter = limiter,
    env = process.env,
    now = () => Date.now(),
    log = logger
} = {}) {
    async function requestContentPage(path, params) {
        const config = contentConfigurationFrom(env);
        const url = `${config.baseUrl}${path}`;
        const operation = 'contentsync';
        const operationDailyMaxRequests = operationBudgetFor(env, operation);
        await requestLimiter.acquire({
            account: config.accountConfig,
            apiKey: config.apiKey,
            environment: 'test',
            maxRequests: env.HOTELBEDS_RATE_MAX_REQUESTS,
            windowMs: env.HOTELBEDS_RATE_WINDOW_MS,
            dailyMaxRequests: env.HOTELBEDS_DAILY_MAX_REQUESTS,
            dailyWindowMs: env.HOTELBEDS_DAILY_WINDOW_MS,
            operation,
            operationDailyMaxRequests
        });

        const headers = buildAuthenticationHeaders({
            ...config,
            timestampSeconds: Math.floor(now() / 1000),
            method: 'get',
            acceptEncoding: 'gzip'
        });
        const startedAt = now();
        let response;
        try {
            response = await http.request({
                method: 'get', url, params, headers, timeout: 60000,
                maxRedirects: 0, maxContentLength: 16 * 1024 * 1024,
                validateStatus: () => true
            });
        } catch (error) {
            try {
                log.logEtgExchange({ method: 'get', url, requestPayload: null, responsePayload: null,
                    statusCode: error.response?.status, latencyMs: now() - startedAt,
                    error: { code: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code) ? error.code : 'request_failed' } });
            } catch { /* Keep log failures from masking the supplier error. */ }
            throw Object.assign(new Error(error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
                ? 'hotelbeds_content_request_timeout' : 'hotelbeds_content_request_unavailable'), {
                code: error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
                    ? 'hotelbeds_content_request_timeout' : 'hotelbeds_content_request_unavailable',
                httpStatus: 502
            });
        }

        try {
            log.logEtgExchange({ method: 'get', url, requestPayload: null, responsePayload: null,
                statusCode: response.status, latencyMs: now() - startedAt });
        } catch { /* Static-content logging is best effort. */ }
        return {
            ok: response.status >= 200 && response.status < 300,
            httpStatus: response.status,
            data: response.data === undefined ? null : response.data
        };
    }

    async function getHotelsPage(options) {
        return requestContentPage(HOTEL_CONTENT_PATH, buildHotelContentQuery(options));
    }

    async function getCategoriesPage(options) {
        return requestContentPage(HOTEL_CATEGORIES_PATH, buildHotelCategoryQuery(options));
    }

    return { getHotelsPage, getCategoriesPage };
}

const defaultClient = createHotelbedsContentClient();

module.exports = {
    HOTEL_CONTENT_PATH,
    HOTEL_CATEGORIES_PATH,
    TEST_CONTENT_BASE_URL,
    MAX_PAGE_SIZE,
    contentConfigurationFrom,
    // Retain the existing exported name for consumers while sharing one
    // implementation with the Booking API client.
    signatureFor: generateSignature,
    buildPagedContentQuery,
    buildHotelContentQuery,
    buildHotelCategoryQuery,
    createHotelbedsContentClient,
    getHotelsPage: defaultClient.getHotelsPage
};