// services/ratehawkClient.js
// Low-level client for the Emerging Travel Group (ETG) / RateHawk B2B API v3.
// Docs: https://docs.emergingtravel.com/  |  Auth: HTTP Basic (KEY_ID : API_KEY)

const axios = require('axios');
const logger = require('./loggerService');

// Base URL is fully env-driven (RATEHAWK_BASE_URL). Hosts:
//   Sandbox:    https://api-sandbox.ratehawk.com
//   Production: https://api.ratehawk.com
// (The legacy api.worldota.net / api-sandbox.worldota.net hosts are deprecated.)
// The value may be given as the bare host or with a trailing /api/b2b/v3 — we
// normalize to the host because endpoints hit both /api/b2b/v3/* and /api/content/v1/*.
function normalizeBaseUrl(u) {
    return String(u || 'https://api-sandbox.ratehawk.com')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/api\/b2b\/v3$/, '');
}
const BASE_URL = normalizeBaseUrl(process.env.RATEHAWK_BASE_URL);
const KEY_ID = process.env.RATEHAWK_KEY_ID || '';
const API_KEY = process.env.RATEHAWK_API_KEY || '';

// Default per-endpoint timeouts (ms). Booking/cancel need longer windows.
const DEFAULT_TIMEOUT = 20000;

// ETG error codes that are safe to retry (transient / non-final).
const RETRYABLE_ERRORS = new Set(['unknown', 'timeout']);

// Fatal configuration/auth errors — almost always mean the IP isn't whitelisted
// or the API key is wrong/disabled. Surfaced loudly for the ops team.
const FATAL_ERRORS = new Set([
    'not_allowed_host', 'incorrect_credentials', 'api_access_disabled',
    'no_auth_header', 'invalid_auth_header', 'endpoint_not_active'
]);

// Build an informative Error that carries the ETG error code + validation reason.
function ratehawkError(path, envelope) {
    const reason = envelope.validationError ? ` — ${envelope.validationError}` : '';
    const err = new Error(`RateHawk ${path} error: ${envelope.error}${reason}`);
    err.ratehawkError = envelope.error;
    err.validationError = envelope.validationError || null;
    err.httpStatus = envelope.httpStatus;
    return err;
}

// ---- Rate limiting (ETG X-RateLimit-* headers) ----
const RATE_LIMIT_WARN_THRESHOLD = parseInt(process.env.RATEHAWK_RATE_LIMIT_WARN || '2', 10); // warn when remaining <= this
const MAX_429_RETRIES = parseInt(process.env.RATEHAWK_MAX_429_RETRIES || '3', 10);
const MAX_429_WAIT_MS = parseInt(process.env.RATEHAWK_MAX_429_WAIT_MS || '65000', 10); // cap the sleep so we never hang for too long

function toNumberOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// Parse X-RateLimit-Reset into an absolute epoch-ms. Accepts an epoch (s or ms)
// or an ISO datetime (ETG returns UTC without an explicit timezone).
function parseResetToMs(resetRaw) {
    if (resetRaw === undefined || resetRaw === null || resetRaw === '') return null;
    const s = String(resetRaw).trim();
    if (/^\d+$/.test(s)) {
        let n = Number(s);
        if (n < 1e12) n *= 1000; // epoch seconds -> ms
        return n;
    }
    let iso = s;
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) iso += 'Z'; // assume UTC when no tz provided
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
}

// Read the X-RateLimit-* response headers (axios lowercases header keys).
function readRateLimit(headers = {}) {
    return {
        secondsNumber: toNumberOrNull(headers['x-ratelimit-secondsnumber']),
        requestsNumber: toNumberOrNull(headers['x-ratelimit-requestsnumber']),
        remaining: toNumberOrNull(headers['x-ratelimit-remaining']),
        reset: headers['x-ratelimit-reset'] || null
    };
}

// How long to sleep before retrying a 429, based on X-RateLimit-Reset (bounded).
function rateLimitWaitMs(rl) {
    let waitMs = 1000;
    const resetMs = parseResetToMs(rl && rl.reset);
    if (resetMs) waitMs = resetMs - Date.now();
    else if (rl && rl.secondsNumber) waitMs = rl.secondsNumber * 1000;
    if (!Number.isFinite(waitMs) || waitMs < 0) waitMs = 1000;
    return Math.min(waitMs + 500, MAX_429_WAIT_MS); // small buffer, capped
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const http = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'User-Agent': process.env.RATEHAWK_USER_AGENT || 'RatehawkPartner/1.0 (RimalBackend/1.0)'
    },
    // We resolve for any status code and inspect the ETG envelope ourselves.
    validateStatus: () => true
});

function assertCredentials() {
    if (!KEY_ID || !API_KEY) {
        throw new Error('RateHawk credentials missing: set RATEHAWK_KEY_ID and RATEHAWK_API_KEY');
    }
}

// HTTP Basic Auth header for ETG (KEY_ID:API_KEY). Exposed for callers that build
// their own requests against the configured BASE_URL.
function getAuthHeaders() {
    const token = Buffer.from(`${String(KEY_ID)}:${String(API_KEY)}`).toString('base64');
    return { Authorization: `Basic ${token}` };
}

/**
 * Perform a single ETG API call and normalize the response envelope.
 * ETG always answers with { status, error, data, debug }.
 * Returns: { ok, status, error, data, debug, httpStatus }
 */
async function callOnce(method, path, { data, timeout } = {}) {
    assertCredentials();
    const config = {
        method,
        url: path,
        timeout: timeout || DEFAULT_TIMEOUT,
        auth: { username: String(KEY_ID), password: String(API_KEY) }
    };

    if (method.toLowerCase() === 'get') {
        // ETG rule: for GET requests, the payload MUST be JSON-stringified and appended
        // to the URL as a single query parameter named `data`, e.g.
        //   GET .../api/b2b/v3/hotel/info/?data={"id":"...","language":"en"}
        // (axios URL-encodes the value.) GETs without a payload send no query string.
        if (data !== undefined && data !== null) config.params = { data: JSON.stringify(data) };
    } else {
        // POST: send the JSON payload naturally in the request body.
        config.data = data || {};
    }

    const startedAt = Date.now();
    let res;
    try {
        res = await http.request(config);
    } catch (error) {
        logger.logEtgExchange({
            method: config.method,
            url: http.getUri(config),
            headers: config.headers,
            auth: config.auth,
            requestPayload: config.data !== undefined ? config.data : data,
            responsePayload: error.response && error.response.data,
            statusCode: error.response && error.response.status,
            latencyMs: Date.now() - startedAt,
            error
        });
        throw error;
    }
    logger.logEtgExchange({
        method: config.method,
        url: http.getUri(config),
        headers: config.headers,
        auth: config.auth,
        requestPayload: config.data !== undefined ? config.data : data,
        responsePayload: res.data,
        statusCode: res.status,
        latencyMs: Date.now() - startedAt
    });
    const body = res.data || {};
    const rateLimit = readRateLimit(res.headers || {});

    // Proactively warn the ops team when the remaining quota gets dangerously low.
    if (rateLimit.remaining !== null && rateLimit.remaining <= RATE_LIMIT_WARN_THRESHOLD) {
        logger.warn(`⚠️ RateHawk rate limit LOW on ${path}: ${rateLimit.remaining} request(s) left ` +
            `(window ${rateLimit.requestsNumber || '?'}/${rateLimit.secondsNumber || '?'}s, resets ${rateLimit.reset || '?'}).`);
    }

    // Universal ETG envelope: { data, debug, error, status }. Treat an "error"
    // status OR a non-null error string as a failure, and surface the precise
    // reason from debug.validation_error when present.
    const isError = body.status === 'error' || (body.error !== undefined && body.error !== null);
    const envelope = {
        ok: body.status === 'ok' && !isError,
        status: body.status,
        error: body.error || null,
        validationError: (body.debug && body.debug.validation_error) || null,
        data: body.data !== undefined ? body.data : null, // graceful when empty
        debug: body.debug,
        httpStatus: res.status,
        rateLimit
    };
    return envelope;
}

function isTransient(envelope, err) {
    if (err) {
        // network / abort / timeout
        return err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
    }
    if (!envelope) return false;
    if (envelope.httpStatus >= 500) return true;
    if (envelope.error && RETRYABLE_ERRORS.has(envelope.error)) return true;
    return false;
}

/**
 * Call an ETG endpoint with bounded exponential-backoff retries for transient failures.
 * Non-transient ETG errors (e.g. rate_not_found, soldout) are returned to the caller,
 * not thrown, so callers can branch on `envelope.error`.
 */
async function call(method, path, { data, timeout, retries = 2, backoff = 800, rateLimitRetry = true } = {}) {
    let attempt = 0;
    let rlAttempt = 0; // separate budget for HTTP 429 (rate limit) retries
    // total attempts = retries + 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const envelope = await callOnce(method, path, { data, timeout });

            // HTTP 429: honor the rate limit — sleep until X-RateLimit-Reset, then retry.
            // Callers that must stay fast (e.g. best-effort search enrichment) pass
            // rateLimitRetry:false to get the 429 envelope back immediately instead.
            if (envelope.httpStatus === 429) {
                if (rateLimitRetry === false) {
                    return envelope;
                }
                if (rlAttempt < MAX_429_RETRIES) {
                    rlAttempt += 1;
                    const waitMs = rateLimitWaitMs(envelope.rateLimit);
                    logger.warn(`🚦 RateHawk 429 Too Many Requests on ${path}. Sleeping ${Math.round(waitMs / 1000)}s until reset (${envelope.rateLimit && envelope.rateLimit.reset}), then retry ${rlAttempt}/${MAX_429_RETRIES}...`);
                    await sleep(waitMs);
                    continue;
                }
                logger.error(`🚦 RateHawk 429 on ${path}: exhausted ${MAX_429_RETRIES} rate-limit retries.`);
                return envelope;
            }

            // 5xx / unknown / timeout -> exponential backoff retry.
            if (!envelope.ok && isTransient(envelope) && attempt < retries) {
                attempt += 1;
                logger.warn(`RateHawk ${path} transient error "${envelope.error || envelope.httpStatus}". Retry ${attempt}/${retries} in ${backoff}ms`);
                await new Promise(r => setTimeout(r, backoff));
                backoff *= 2;
                continue;
            }

            // Strict error routing for non-transient failures.
            if (!envelope.ok && (envelope.error || envelope.status === 'error')) {
                const code = envelope.error;
                const reason = envelope.validationError ? ` (${envelope.validationError})` : '';

                // Fatal auth/config errors: IP not whitelisted or bad/disabled keys.
                if (FATAL_ERRORS.has(code)) {
                    logger.error(`🛑 [FATAL CONFIG ERROR] RateHawk ${path}: "${code}"${reason}. ` +
                        `Check IP whitelisting and RATEHAWK_KEY_ID / RATEHAWK_API_KEY.`);
                    throw ratehawkError(path, envelope);
                }

                // Bad request params: throw with the exact failing parameter reason.
                if (code === 'invalid_params') {
                    logger.error(`❌ RateHawk ${path} invalid_params${reason}`);
                    throw ratehawkError(path, envelope);
                }

                // Soft/expected errors (rate_not_found, soldout, lock, order_not_found,
                // contract_mismatch, ...) are returned so callers can branch on them.
                logger.warn(`RateHawk ${path} returned error: "${code}"${reason} (HTTP ${envelope.httpStatus})`);
            }
            return envelope;
        } catch (err) {
            if (isTransient(null, err) && attempt < retries) {
                attempt += 1;
                logger.warn(`RateHawk ${path} network error "${err.code || err.message}". Retry ${attempt}/${retries} in ${backoff}ms`);
                await new Promise(r => setTimeout(r, backoff));
                backoff *= 2;
                continue;
            }
            // Our own classified errors (invalid_params / fatal) are already logged.
            if (!err.ratehawkError) logger.error(`RateHawk ${path} request failed`, { error: err.message });
            throw err;
        }
    }
}

// ---- Connectivity / account -------------------------------------------------
const getApiOverview = () => call('get', '/api/b2b/v3/overview/');
const overview = getApiOverview;
const contractInfo = () => call('get', '/api/b2b/v3/general/contract/data/info/');

// ---- Static / content data (Content API) -----------------------------------
const hotelStatic = () => call('get', '/api/b2b/v3/hotel/static/', { timeout: 60000 });
const filterValues = () => call('get', '/api/content/v1/filter_values/');
const hotelIds = (data = {}) => call('get', '/api/content/v1/hotel/ids', { data, timeout: 60000 });
async function getHotelDumpUrl(language = 'en', inventory = 'all') {
    const response = await call('post', '/api/b2b/v3/hotel/info/dump/', {
        data: { language, inventory },
        timeout: 60000
    });
    if (!response.ok) {
        throw new Error(response.error || `RateHawk hotel dump request failed with HTTP ${response.httpStatus}`);
    }
    const url = response.data && response.data.url;
    if (typeof url !== 'string' || !url) {
        throw new Error('RateHawk hotel dump response did not contain data.url');
    }
    return url;
}
function extractDumpUrl(response, label) {
    if (!response.ok) {
        throw new Error(response.error || `RateHawk ${label} request failed with HTTP ${response.httpStatus}`);
    }
    const url = response.data && response.data.url;
    if (typeof url !== 'string' || !url) {
        throw new Error(`RateHawk ${label} response did not contain data.url`);
    }
    return url;
}

async function getCustomDumpUrl(type, language = 'en') {
    if (typeof type !== 'string' || !type.trim()) throw new TypeError('custom dump type is required');
    const response = await call('post', '/api/b2b/v3/hotel/custom/dump/', {
        data: { type, language },
        timeout: 60000
    });
    return extractDumpUrl(response, 'custom hotel dump');
}

async function getIncrementalDumpUrl(language = 'en', inventory = 'all') {
    const response = await call('post', '/api/b2b/v3/hotel/info/incremental_dump/', {
        data: { language, inventory },
        timeout: 60000
    });
    return extractDumpUrl(response, 'incremental hotel dump');
}

async function getReviewsDumpUrl(language = 'en') {
    const response = await call('post', '/api/b2b/v3/hotel/reviews/dump/', {
        data: { language },
        timeout: 60000
    });
    return extractDumpUrl(response, 'hotel reviews dump');
}

async function getRegionDumpUrl() {
    const response = await call('get', '/api/b2b/v3/hotel/region/dump/', { timeout: 60000 });
    return extractDumpUrl(response, 'region dump');
}

async function getIncrementalReviewsDumpUrl(language = 'en') {
    const response = await call('post', '/api/b2b/v3/hotel/incremental_reviews/dump/', {
        data: { language },
        timeout: 60000
    });
    return extractDumpUrl(response, 'incremental hotel reviews dump');
}

async function getPoiDumpUrl(language = 'en') {
    const response = await call('post', '/api/b2b/v3/hotel/poi/dump/', {
        data: { language },
        timeout: 60000
    });
    return extractDumpUrl(response, 'hotel POI dump');
}

async function getHotelStaticData() {
    const response = await call('get', '/api/b2b/v3/hotel/static/', { timeout: 60000 });
    if (!response.ok) {
        throw new Error(response.error || `RateHawk hotel static request failed with HTTP ${response.httpStatus}`);
    }
    return response.data;
}

async function getSingleHotelInfo(hid, language = 'en') {
    const numericHid = Number(hid);
    if (!Number.isInteger(numericHid) || numericHid < 0 || numericHid > 0xFFFFFFFF) {
        throw new TypeError('hid must be a uint32 integer');
    }
    const response = await call('post', '/api/b2b/v3/hotel/info/', {
        data: { hid: numericHid, language },
        timeout: 30000
    });
    if (!response.ok) throw ratehawkError('/api/b2b/v3/hotel/info/', response);
    return response.data;
}
const hotelContent = (data = {}) => call('post', '/api/content/v1/hotel_content_by_ids/', {
    data: { ...data, language: 'en' },
    timeout: 60000
});
function validateHotelReviewHids(hids) {
    if (!Array.isArray(hids) || hids.length > 100) {
        throw new TypeError('hids must be an array of no more than 100 uint32 integers');
    }
    if (hids.some(hid => !Number.isInteger(hid) || hid < 0 || hid > 0xFFFFFFFF)) {
        throw new TypeError('hids must contain only uint32 integers');
    }
}

function extractHotelReviewRecords(data) {
    const source = data && data.data !== undefined ? data.data : data;
    const records = Array.isArray(source)
        ? source
        : (source && (source.hotels || source.reviews || source.items));
    if (!Array.isArray(records)) return [];
    return records
        .map(record => {
            if (!record || typeof record !== 'object') return null;
            const hid = record.hid ?? record.hotel_id ?? record.id;
            const reviews = Array.isArray(record.reviews)
                ? record.reviews
                : (Array.isArray(record.review) ? record.review : []);
            if (hid === undefined || hid === null) return null;
            return { hid: Number(hid), reviews };
        })
        .filter(record => Number.isInteger(record.hid) && record.hid >= 0 && record.hid <= 0xFFFFFFFF);
}

async function fetchHotelReviews(hids, language = 'en') {
    validateHotelReviewHids(hids);
    if (typeof language !== 'string' || !language.trim()) {
        throw new TypeError('language must be a non-empty string');
    }
    let response;
    try {
        response = await call('post', '/api/content/v1/hotel_reviews_by_ids/', {
            data: { hids, language },
            timeout: 60000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            logger.warn('ETG hotel reviews rejected parameters', {
                validationError: error.validationError || error.message
            });
            return [];
        }
        if (error.ratehawkError === 'no_hotel_reviews' || error.httpStatus === 500) {
            logger.warn('ETG hotel reviews are unavailable for these hotels', { error: error.message });
            return [];
        }
        throw error;
    }
    if (response.error === 'invalid_params') {
        logger.warn('ETG hotel reviews rejected parameters', {
            validationError: response.validationError || 'unknown validation error'
        });
        return [];
    }
    if (response.error === 'no_hotel_reviews' || response.httpStatus === 500) {
        logger.warn('ETG hotel reviews are unavailable for these hotels', {
            error: response.error || response.httpStatus
        });
        return [];
    }
    if (!response.ok) throw new Error(response.error || 'ETG hotel reviews request failed');
    return extractHotelReviewRecords(response.data);
}
function normalizeHotelIdFilters(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
        throw new TypeError('Hotel ID filters must be an object');
    }
    const payload = {};
    const integerArrays = ['country', 'star_rating'];
    const stringArrays = ['kind', 'serp_filter'];

    integerArrays.forEach(key => {
        if (filters[key] === undefined) return;
        if (!Array.isArray(filters[key]) || filters[key].some(value => !Number.isInteger(value))) {
            throw new TypeError(`${key} must be an array of integers`);
        }
        payload[key] = filters[key];
    });
    stringArrays.forEach(key => {
        if (filters[key] === undefined) return;
        if (!Array.isArray(filters[key]) || filters[key].some(value => typeof value !== 'string')) {
            throw new TypeError(`${key} must be an array of strings`);
        }
        payload[key] = filters[key];
    });
    if (filters.updated_since !== undefined) {
        if (typeof filters.updated_since !== 'string') throw new TypeError('updated_since must be a string');
        payload.updated_since = filters.updated_since;
    }
    return payload;
}

async function fetchHotelIdsByFilter(filters = {}) {
    const payload = normalizeHotelIdFilters(filters);
    let response;
    try {
        response = await call('post', '/api/content/v1/hotel_ids_by_filter/', {
            data: payload,
            timeout: 60000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            logger.warn('ETG hotel IDs by filter rejected parameters', {
                validationError: error.validationError || error.message
            });
            return [];
        }
        if (error.ratehawkError === 'no_hotel_ids' || error.httpStatus === 500) {
            logger.warn('ETG hotel IDs by filter returned no hotel IDs', { error: error.message });
            return [];
        }
        throw error;
    }

    if (response.error === 'invalid_params') {
        logger.warn('ETG hotel IDs by filter rejected parameters', {
            validationError: response.validationError || 'unknown validation error'
        });
        return [];
    }
    if (response.error === 'no_hotel_ids' || response.httpStatus === 500) {
        logger.warn('ETG hotel IDs by filter returned no hotel IDs', { error: response.error || response.httpStatus });
        return [];
    }
    if (!response.ok) throw new Error(response.error || 'ETG hotel IDs by filter request failed');

    const hids = response.data && response.data.hids;
    return Array.isArray(hids) ? hids : [];
}

const hotelIdsByFilter = fetchHotelIdsByFilter;
const hotelContentByIds = (data) => call('post', '/api/content/v1/hotel_content_by_ids/', { data, timeout: 60000 });
const hotelInfo = (data) => call('post', '/api/b2b/v3/hotel/info/', { data });

// ---- Search -----------------------------------------------------------------
const multicomplete = (data) => call('post', '/api/b2b/v3/search/multicomplete/', { data });
async function suggestHotelAndRegion(query, language = 'en') {
    let response;
    try {
        response = await call('post', '/api/b2b/v3/search/multicomplete/', {
            data: { query, language },
            timeout: 30000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params' || error.ratehawkError === 'core_search_error') {
            logger.warn('RateHawk autocomplete failed', {
                error: error.ratehawkError,
                validationError: error.validationError || null
            });
        }
        throw error;
    }
    if (!response.ok) {
        if (response.error === 'invalid_params' || response.error === 'core_search_error') {
            logger.warn('RateHawk autocomplete failed', {
                error: response.error,
                validationError: response.validationError || null
            });
        }
        throw ratehawkError('/api/b2b/v3/search/multicomplete/', response);
    }
    return response.data && response.data.data !== undefined
        ? response.data.data
        : response.data;
}
const serpRegion = (data) => call('post', '/api/b2b/v3/search/serp/region/', { data, timeout: 30000 });
const serpHotels = (data) => call('post', '/api/b2b/v3/search/serp/hotels/', { data, timeout: 30000 });
async function searchHotels(params = {}) {
    let response;
    try {
        response = await call('post', '/api/b2b/v3/search/serp/hotels/', {
            data: params,
            timeout: 30000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params' || error.ratehawkError === 'core_search_error') {
            logger.warn('RateHawk hotel ID search failed', {
                error: error.ratehawkError,
                validationError: error.validationError || null
            });
        }
        throw error;
    }
    if (!response.ok) {
        if (response.error === 'invalid_params' || response.error === 'core_search_error') {
            logger.warn('RateHawk hotel ID search failed', {
                error: response.error,
                validationError: response.validationError || null
            });
        }
        throw ratehawkError('/api/b2b/v3/search/serp/hotels/', response);
    }
    return response.data && response.data.data !== undefined
        ? response.data.data
        : response.data;
}
async function searchHotelsByGeo(params = {}) {
    let response;
    try {
        response = await call('post', '/api/b2b/v3/search/serp/geo/', {
            data: params,
            timeout: 30000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params' || error.ratehawkError === 'core_search_error') {
            logger.warn('RateHawk geo search failed', {
                error: error.ratehawkError,
                validationError: error.validationError || null
            });
        }
        throw error;
    }
    if (!response.ok) {
        if (response.error === 'invalid_params' || response.error === 'core_search_error') {
            logger.warn('RateHawk geo search failed', {
                error: response.error,
                validationError: response.validationError || null
            });
        }
        throw ratehawkError('/api/b2b/v3/search/serp/geo/', response);
    }
    return response.data && response.data.data !== undefined
        ? response.data.data
        : response.data;
}
async function searchHotelsByRegion(params = {}) {
    let response;
    try {
        response = await call('post', '/api/b2b/v3/search/serp/region/', {
            data: params,
            timeout: 30000
        });
    } catch (error) {
        if (['invalid_params', 'hotels_not_found', 'core_search_error'].includes(error.ratehawkError)) {
            logger.warn('RateHawk region search failed', {
                error: error.ratehawkError,
                validationError: error.validationError || null
            });
        }
        throw error;
    }
    if (!response.ok) {
        if (['invalid_params', 'hotels_not_found', 'core_search_error'].includes(response.error)) {
            logger.warn('RateHawk region search failed', {
                error: response.error,
                validationError: response.validationError || null
            });
        }
        throw ratehawkError('/api/b2b/v3/search/serp/region/', response);
    }
    return response.data && response.data.data !== undefined
        ? response.data.data
        : response.data;
}
async function sortHotelsInRegion(params = {}) {
    let response;
    try {
        response = await call('post', '/api/b2b/v3/search/hotelsort/', {
            data: params,
            timeout: 30000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params' || error.ratehawkError === 'hotels_not_found') {
            logger.warn('RateHawk hotel region sort failed', {
                error: error.ratehawkError,
                validationError: error.validationError || null
            });
        }
        throw error;
    }
    if (!response.ok) {
        if (response.error === 'invalid_params' || response.error === 'hotels_not_found') {
            logger.warn('RateHawk hotel region sort failed', {
                error: response.error,
                validationError: response.validationError || null
            });
        }
        throw ratehawkError('/api/b2b/v3/search/hotelsort/', response);
    }
    const data = response.data && response.data.data !== undefined
        ? response.data.data
        : response.data;
    return data && Array.isArray(data.hotels) ? data.hotels : [];
}
async function getHotelPageRates(params = {}) {
    let response;
    try {
        response = await call('post', '/api/b2b/v3/search/hp/', {
            data: params,
            timeout: 30000
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params' || error.ratehawkError === 'core_search_error') {
            logger.warn('RateHawk hotelpage rates lookup failed', {
                error: error.ratehawkError,
                validationError: error.validationError || null
            });
        }
        throw error;
    }
    if (!response.ok) {
        if (response.error === 'invalid_params' || response.error === 'core_search_error') {
            logger.warn('RateHawk hotelpage rates lookup failed', {
                error: response.error,
                validationError: response.validationError || null
            });
        }
        throw ratehawkError('/api/b2b/v3/search/hp/', response);
    }
    return response.data && response.data.data !== undefined
        ? response.data.data
        : response.data;
}
const serpGeo = (data) => call('post', '/api/b2b/v3/search/serp/geo/', { data, timeout: 30000 });
const hotelPage = (data, opts = {}) => call('post', '/api/b2b/v3/search/hp/', { data, timeout: 30000, ...opts });

// ---- Prebook ----------------------------------------------------------------
const prebook = (data) => call('post', '/api/b2b/v3/hotel/prebook/', { data, timeout: 30000, retries: 1 });
const prebookFromSerp = (data) => call('post', '/api/b2b/v3/serp/prebook/', { data, timeout: 30000, retries: 1 });

// ---- Booking ----------------------------------------------------------------
// No blind retry: ETG requires retrying booking/form with a NEW partner_order_id
// (handled by the service layer), otherwise you get double_booking_form.
const bookingForm = (data) => call('post', '/api/b2b/v3/hotel/order/booking/form/', { data, timeout: 30000, retries: 0 });
const bookingFinish = (data) => call('post', '/api/b2b/v3/hotel/order/booking/finish/', { data, timeout: 60000, retries: 0 });
const bookingFinishStatus = (data) => call('post', '/api/b2b/v3/hotel/order/booking/finish/status/', { data, timeout: 30000, retries: 0 });

// ---- Post-booking -----------------------------------------------------------
const orderInfo = (data) => call('post', '/api/b2b/v3/hotel/order/info/', { data, timeout: 30000 });
const cancelOrder = (data) => call('post', '/api/b2b/v3/hotel/order/cancel/', { data, timeout: 60000, retries: 0 });

module.exports = {
    BASE_URL,
    getAuthHeaders,
    call,
    getApiOverview,
    overview,
    contractInfo,
    getHotelDumpUrl,
    getCustomDumpUrl,
    getIncrementalDumpUrl,
    getReviewsDumpUrl,
    getRegionDumpUrl,
    getIncrementalReviewsDumpUrl,
    getPoiDumpUrl,
    getHotelStaticData,
    getSingleHotelInfo,
    hotelStatic,
    filterValues,
    hotelIds,
    hotelContent,
    validateHotelReviewHids,
    extractHotelReviewRecords,
    fetchHotelReviews,
    normalizeHotelIdFilters,
    fetchHotelIdsByFilter,
    hotelIdsByFilter,
    hotelContentByIds,
    hotelInfo,
    multicomplete,
    suggestHotelAndRegion,
    serpRegion,
    serpHotels,
    searchHotels,
    searchHotelsByGeo,
    searchHotelsByRegion,
    sortHotelsInRegion,
    getHotelPageRates,
    serpGeo,
    hotelPage,
    prebook,
    prebookFromSerp,
    bookingForm,
    bookingFinish,
    bookingFinishStatus,
    orderInfo,
    cancelOrder
};
