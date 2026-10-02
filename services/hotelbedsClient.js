const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const logger = require('./loggerService');
const rateLimiter = require('./hotelbedsRateLimiter');
const { validateCredential, generateSignature, buildAuthenticationHeaders } = require('./hotelbedsAuthentication');
const { operationBudgetFor } = require('./hotelbedsRateLimiter');

const TEST_BASE_URL = 'https://api.test.hotelbeds.com';
const TEST_MTLS_BASE_URL = 'https://api-mtls.test.hotelbeds.com';
const MAX_HOTELS_PER_AVAILABILITY = 2000;
const ENDPOINTS = Object.freeze({
    status: { method: 'get', path: '/hotel-api/1.0/status', timeoutMs: 15000, mtls: false },
    availability: { method: 'post', path: '/hotel-api/1.0/hotels', timeoutMs: 30000, mtls: true },
    checkRates: { method: 'post', path: '/hotel-api/1.0/checkrates', timeoutMs: 30000, mtls: true },
    booking: { method: 'post', path: '/hotel-api/1.0/bookings', timeoutMs: 60000, mtls: true }
});

function fail(code, httpStatus = 503, details = {}) {
    return Object.assign(new Error(code), { code, httpStatus, ...details });
}

function credentialsFrom(env = process.env) {
    if (env.HOTELBEDS_ENABLED !== 'true') throw fail('hotelbeds_disabled', 503);
    const environment = String(env.HOTELBEDS_ENV || 'test').trim().toLowerCase();
    if (environment !== 'test') throw fail('hotelbeds_environment_not_supported', 503);

    // Preserve the exact opaque credentials used for hashing; reject surrounding
    // whitespace/control characters rather than silently changing the hash input.
    const apiKey = validateCredential(env.HOTELBEDS_API_KEY);
    const secret = validateCredential(env.HOTELBEDS_SECRET);
    const accountConfig = String(env.HOTELBEDS_ACCOUNT_CONFIG || '').trim();
    if (!apiKey || !secret || !accountConfig) throw fail('hotelbeds_credentials_unavailable', 503);

    return { environment, apiKey, secret, accountConfig };
}

function configurationFrom(env = process.env, { readFileSync = fs.readFileSync } = {}) {
    const credentials = credentialsFrom(env);
    const bookingBaseUrl = String(env.HOTELBEDS_MTLS_BASE_URL || '').trim();
    if (!bookingBaseUrl) throw fail('hotelbeds_mtls_endpoint_unconfigured');
    let parsedBookingUrl;
    try { parsedBookingUrl = new URL(bookingBaseUrl); } catch { throw fail('hotelbeds_mtls_endpoint_invalid'); }
    if (bookingBaseUrl.replace(/\/+$/, '') !== TEST_MTLS_BASE_URL
        || parsedBookingUrl.protocol !== 'https:' || parsedBookingUrl.hostname !== 'api-mtls.test.hotelbeds.com'
        || parsedBookingUrl.port || parsedBookingUrl.search || parsedBookingUrl.hash
        || parsedBookingUrl.pathname !== '/' && parsedBookingUrl.pathname !== '') {
        throw fail('hotelbeds_mtls_endpoint_invalid');
    }
    const configuredCertPath = String(env.HOTELBEDS_MTLS_CERT_PATH || '').trim();
    const configuredKeyPath = String(env.HOTELBEDS_MTLS_KEY_PATH || '').trim();
    if (!configuredCertPath || !configuredKeyPath) {
        throw fail('hotelbeds_mtls_certificate_unavailable');
    }
    // Relative local paths are resolved from the backend project root, not the
    // process working directory, so the documented ./certs paths work reliably.
    const certPath = path.isAbsolute(configuredCertPath)
        ? configuredCertPath : path.resolve(__dirname, '..', configuredCertPath);
    const keyPath = path.isAbsolute(configuredKeyPath)
        ? configuredKeyPath : path.resolve(__dirname, '..', configuredKeyPath);
    let cert;
    let key;
    try {
        cert = readFileSync(certPath);
        key = readFileSync(keyPath);
        if (!cert.length || !key.length) throw new Error('empty_client_certificate');
    } catch {
        throw fail('hotelbeds_mtls_certificate_unavailable');
    }

    return {
        ...credentials,
        baseUrl: bookingBaseUrl.replace(/\/+$/, ''), cert, key
    };
}

function createMutualTlsAgent(config) {
    return new https.Agent({
        cert: config.cert,
        key: config.key,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    });
}

function safeLog(log, entry) {
    try { log.logEtgExchange(entry); } catch { /* Logging must not alter supplier request behavior. */ }
}

function findRateByKey(value, rateKey, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return null;
    visited.add(value);
    if (!Array.isArray(value) && value.rateKey === rateKey) return value;
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
        const found = findRateByKey(child, rateKey, visited);
        if (found) return found;
    }
    return null;
}

function isSuccessfulResponse(response) {
    return Boolean(response && response.ok && response.data && typeof response.data === 'object'
        && (response.data.error === undefined || response.data.error === null));
}

function validateAvailabilityPayload(payload) {
    const requestedHotels = payload?.hotels?.hotel;
    if (Array.isArray(requestedHotels) && requestedHotels.length > MAX_HOTELS_PER_AVAILABILITY) {
        throw fail('hotelbeds_availability_hotel_limit_exceeded', 400, {
            maxHotels: MAX_HOTELS_PER_AVAILABILITY
        });
    }
}

function createHotelbedsClient({
    http = axios.create({ validateStatus: () => true }),
    limiter = rateLimiter,
    env = process.env,
    readFileSync = fs.readFileSync,
    agentFactory = createMutualTlsAgent,
    now = () => Date.now(),
    log = logger
} = {}) {
    async function request(operation, payload) {
        const endpoint = ENDPOINTS[operation];
        if (!endpoint) throw fail('hotelbeds_operation_not_supported', 400);
        if (endpoint.method === 'post'
            && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
            throw fail('hotelbeds_invalid_request', 400);
        }
        if (operation === 'availability') validateAvailabilityPayload(payload);

        const credentials = credentialsFrom(env);
        const transport = endpoint.mtls
            ? configurationFrom(env, { readFileSync })
            : { ...credentials, baseUrl: TEST_BASE_URL };
        const operationDailyMaxRequests = operationBudgetFor(env, operation);
        await limiter.acquire({
            account: credentials.accountConfig,
            apiKey: credentials.apiKey,
            environment: credentials.environment,
            maxRequests: env.HOTELBEDS_RATE_MAX_REQUESTS,
            windowMs: env.HOTELBEDS_RATE_WINDOW_MS,
            dailyMaxRequests: env.HOTELBEDS_DAILY_MAX_REQUESTS,
            dailyWindowMs: env.HOTELBEDS_DAILY_WINDOW_MS,
            operation,
            operationDailyMaxRequests
        });

        const url = `${transport.baseUrl}${endpoint.path}`;
        const httpsAgent = endpoint.mtls ? agentFactory(transport) : undefined;

        // The signature timestamp must be fresh after any limiter wait.
        const timestampSeconds = Math.floor(now() / 1000);
        const headers = buildAuthenticationHeaders({
            ...credentials,
            timestampSeconds,
            method: endpoint.method
        });

        const startedAt = now();
        let response;
        try {
            response = await http.request({
                method: endpoint.method,
                url,
                headers,
                ...(endpoint.method === 'post' ? { data: payload } : {}),
                ...(httpsAgent ? { httpsAgent } : {}),
                timeout: endpoint.timeoutMs,
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 8 * 1024 * 1024,
                validateStatus: () => true
            });
        } catch (error) {
            safeLog(log, {
                method: endpoint.method,
                url,
                requestPayload: null,
                responsePayload: null,
                statusCode: error.response?.status,
                latencyMs: now() - startedAt,
                error: { code: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code) ? error.code : 'request_failed' }
            });
            throw fail(error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
                ? 'hotelbeds_request_timeout' : 'hotelbeds_request_unavailable', 502,
            operation === 'booking' ? { outcomeUnknown: true } : {});
        } finally {
            httpsAgent?.destroy?.();
        }

        safeLog(log, {
            method: endpoint.method,
            url,
            requestPayload: null,
            responsePayload: null,
            statusCode: response.status,
            latencyMs: now() - startedAt
        });

        return {
            ok: response.status >= 200 && response.status < 300,
            httpStatus: response.status,
            data: response.data === undefined ? null : response.data
        };
    }

    async function bookSelectedRate({ availabilityResponse, rateKey, bookingRequest, roomIndex = 0 } = {}) {
        if (!isSuccessfulResponse(availabilityResponse)) {
            throw fail('hotelbeds_availability_response_invalid', 400);
        }
        if (typeof rateKey !== 'string' || !rateKey.trim()
            || !bookingRequest || !Array.isArray(bookingRequest.rooms)
            || !Number.isSafeInteger(roomIndex) || roomIndex < 0 || roomIndex >= bookingRequest.rooms.length) {
            throw fail('hotelbeds_booking_selection_invalid', 400);
        }

        // rateKey is opaque: select it by exact equality and never parse its format.
        const selectedRate = findRateByKey(availabilityResponse.data, rateKey);
        if (!selectedRate || !['BOOKABLE', 'RECHECK'].includes(selectedRate.rateType)) {
            throw fail('hotelbeds_rate_not_found', 409);
        }

        let bookingRateKey = rateKey;
        let checkRatesResponse = null;
        if (selectedRate.rateType === 'RECHECK') {
            // Hotelbeds recommends one rateKey per CheckRate operation.
            checkRatesResponse = await request('checkRates', { rooms: [{ rateKey }] });
            if (!isSuccessfulResponse(checkRatesResponse)) {
                return { ok: false, stage: 'checkRates', checkRates: checkRatesResponse };
            }
            const checkedRate = findRateByKey(checkRatesResponse.data, rateKey);
            if (!checkedRate || checkedRate.rateType !== 'BOOKABLE') {
                return {
                    ok: false,
                    stage: 'checkRates',
                    checkRates: checkRatesResponse,
                    error: 'hotelbeds_rate_not_bookable_after_recheck'
                };
            }
            bookingRateKey = checkedRate.rateKey;
        }

        const rooms = bookingRequest.rooms.map((room, index) => index === roomIndex
            ? { ...room, rateKey: bookingRateKey }
            : room);
        let bookingResponse;
        try {
            bookingResponse = await request('booking', { ...bookingRequest, rooms });
        } catch (error) {
            if (!error.outcomeUnknown) throw error;
            return { ok: false, stage: 'booking', outcomeUnknown: true,
                error: 'hotelbeds_booking_outcome_unknown' };
        }

        return {
            ok: isSuccessfulResponse(bookingResponse),
            stage: 'booking',
            outcomeUnknown: false,
            ...(checkRatesResponse ? { checkRates: checkRatesResponse } : {}),
            booking: bookingResponse
        };
    }

    return {
        getStatus: () => request('status'),
        availability: payload => request('availability', payload),
        checkRates: payload => request('checkRates', payload),
        createBooking: payload => request('booking', payload),
        bookSelectedRate
    };
}

const defaultClient = createHotelbedsClient();

module.exports = {
    TEST_BASE_URL,
    TEST_MTLS_BASE_URL,
    MAX_HOTELS_PER_AVAILABILITY,
    ENDPOINTS,
    generateSignature,
    createMutualTlsAgent,
    findRateByKey,
    validateAvailabilityPayload,
    credentialsFrom,
    configurationFrom,
    createHotelbedsClient,
    buildAuthenticationHeaders,
    getStatus: defaultClient.getStatus,
    availability: defaultClient.availability,
    checkRates: defaultClient.checkRates,
    createBooking: defaultClient.createBooking
};