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
    headers: { 'Content-Type': 'application/json' },
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
        // ETG GET endpoints accept a JSON payload via the `data` query parameter.
        if (data !== undefined) config.params = { data: JSON.stringify(data) };
    } else {
        config.data = data || {};
    }

    const res = await http.request(config);
    const body = res.data || {};
    const rateLimit = readRateLimit(res.headers || {});

    // Proactively warn the ops team when the remaining quota gets dangerously low.
    if (rateLimit.remaining !== null && rateLimit.remaining <= RATE_LIMIT_WARN_THRESHOLD) {
        logger.warn(`⚠️ RateHawk rate limit LOW on ${path}: ${rateLimit.remaining} request(s) left ` +
            `(window ${rateLimit.requestsNumber || '?'}/${rateLimit.secondsNumber || '?'}s, resets ${rateLimit.reset || '?'}).`);
    }

    const envelope = {
        ok: body.status === 'ok',
        status: body.status,
        error: body.error || null,
        data: body.data,
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
async function call(method, path, { data, timeout, retries = 2, backoff = 800 } = {}) {
    let attempt = 0;
    let rlAttempt = 0; // separate budget for HTTP 429 (rate limit) retries
    // total attempts = retries + 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const envelope = await callOnce(method, path, { data, timeout });

            // HTTP 429: honor the rate limit — sleep until X-RateLimit-Reset, then retry.
            if (envelope.httpStatus === 429) {
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

            if (!envelope.ok && isTransient(envelope) && attempt < retries) {
                attempt += 1;
                logger.warn(`RateHawk ${path} transient error "${envelope.error || envelope.httpStatus}". Retry ${attempt}/${retries} in ${backoff}ms`);
                await new Promise(r => setTimeout(r, backoff));
                backoff *= 2;
                continue;
            }
            if (!envelope.ok && envelope.error) {
                logger.warn(`RateHawk ${path} returned error: ${envelope.error} (HTTP ${envelope.httpStatus})`);
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
            logger.error(`RateHawk ${path} request failed`, { error: err.message });
            throw err;
        }
    }
}

// ---- Connectivity / account -------------------------------------------------
const overview = () => call('get', '/api/b2b/v3/overview/');
const contractInfo = () => call('get', '/api/b2b/v3/general/contract/data/info/');

// ---- Static / content data (Content API) -----------------------------------
const hotelStatic = () => call('get', '/api/b2b/v3/hotel/static/', { timeout: 60000 });
const filterValues = () => call('get', '/api/content/v1/filter_values/');
const hotelIdsByFilter = (data) => call('get', '/api/content/v1/hotel_ids_by_filter/', { data });
const hotelContentByIds = (data) => call('post', '/api/content/v1/hotel_content_by_ids/', { data, timeout: 60000 });
const hotelInfo = (data) => call('post', '/api/b2b/v3/hotel/info/', { data });

// ---- Search -----------------------------------------------------------------
const multicomplete = (data) => call('post', '/api/b2b/v3/search/multicomplete/', { data });
const serpRegion = (data) => call('post', '/api/b2b/v3/search/serp/region/', { data, timeout: 30000 });
const serpHotels = (data) => call('post', '/api/b2b/v3/search/serp/hotels/', { data, timeout: 30000 });
const serpGeo = (data) => call('post', '/api/b2b/v3/search/serp/geo/', { data, timeout: 30000 });
const hotelPage = (data) => call('post', '/api/b2b/v3/search/hp/', { data, timeout: 30000 });

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
    overview,
    contractInfo,
    hotelStatic,
    filterValues,
    hotelIdsByFilter,
    hotelContentByIds,
    hotelInfo,
    multicomplete,
    serpRegion,
    serpHotels,
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
