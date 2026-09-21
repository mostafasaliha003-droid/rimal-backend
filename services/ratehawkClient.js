// services/ratehawkClient.js
// Low-level client for the Emerging Travel Group (ETG) / RateHawk B2B API v3.
// Docs: https://docs.emergingtravel.com/  |  Auth: HTTP Basic (KEY_ID : API_KEY)

const axios = require('axios');
const logger = require('./loggerService');

const BASE_URL = (process.env.RATEHAWK_BASE_URL || 'https://api-sandbox.ratehawk.com').replace(/\/+$/, '');
const KEY_ID = process.env.RATEHAWK_KEY_ID || '';
const API_KEY = process.env.RATEHAWK_API_KEY || '';

// Default per-endpoint timeouts (ms). Booking/cancel need longer windows.
const DEFAULT_TIMEOUT = 20000;

// ETG error codes that are safe to retry (transient / non-final).
const RETRYABLE_ERRORS = new Set(['unknown', 'timeout']);

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
    const envelope = {
        ok: body.status === 'ok',
        status: body.status,
        error: body.error || null,
        data: body.data,
        debug: body.debug,
        httpStatus: res.status
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
    // total attempts = retries + 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const envelope = await callOnce(method, path, { data, timeout });
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
const bookingForm = (data) => call('post', '/api/b2b/v3/hotel/order/booking/form/', { data, timeout: 30000 });
const bookingFinish = (data) => call('post', '/api/b2b/v3/hotel/order/booking/finish/', { data, timeout: 60000, retries: 0 });
const bookingFinishStatus = (data) => call('post', '/api/b2b/v3/hotel/order/booking/finish/status/', { data, timeout: 30000, retries: 0 });

// ---- Post-booking -----------------------------------------------------------
const orderInfo = (data) => call('post', '/api/b2b/v3/hotel/order/info/', { data, timeout: 30000 });
const cancelOrder = (data) => call('post', '/api/b2b/v3/hotel/order/cancel/', { data, timeout: 60000, retries: 0 });

module.exports = {
    BASE_URL,
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
