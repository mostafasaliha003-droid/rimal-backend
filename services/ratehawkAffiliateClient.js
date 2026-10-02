// Dedicated ETG Affiliate client. Affiliate API keys represent a separate
// contract and must never fall back to the existing B2B credentials.
const axios = require('axios');
const logger = require('./loggerService');
const DEFAULT_BASE_URL = 'https://api-sandbox.ratehawk.com';
function normalizeBaseUrl(value) {
    try {
        const url = new URL(String(value || DEFAULT_BASE_URL).trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
            || !['api.ratehawk.com', 'api-sandbox.ratehawk.com'].includes(url.hostname)) return null;
        const pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/b2b\/v3$/, '');
        if (pathname) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function getConfiguration() {
    const baseUrl = process.env.RATEHAWK_AFFILIATE_BASE_URL
        ? normalizeBaseUrl(process.env.RATEHAWK_AFFILIATE_BASE_URL) : null;
    const keyId = String(process.env.RATEHAWK_AFFILIATE_KEY_ID || '').trim();
    const apiKey = String(process.env.RATEHAWK_AFFILIATE_API_KEY || '').trim();
    const b2bKeyId = String(process.env.RATEHAWK_KEY_ID || '').trim();
    const b2bApiKey = String(process.env.RATEHAWK_API_KEY || '').trim();
    const separateCredentials = keyId && apiKey && keyId !== b2bKeyId && apiKey !== b2bApiKey;
    return {
        baseUrl,
        keyId,
        apiKey,
        configured: Boolean(baseUrl && separateCredentials)
    };
}

function configurationError() {
    const error = new Error('affiliate_supplier_credentials_unavailable');
    error.code = 'affiliate_supplier_credentials_unavailable';
    error.httpStatus = 503;
    return error;
}

function redactAffiliateIds(value) {
    if (Array.isArray(value)) return value.map(redactAffiliateIds);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        key === 'partner_order_id' || key === 'partnerOrderId' ? '[REDACTED]' : redactAffiliateIds(child)]));
}

function redactPersonalData(value) {
    if (Array.isArray(value)) return value.map(redactPersonalData);
    if (!value || typeof value !== 'object') return value;
    const privateFields = new Set(['email', 'phone', 'comment', 'firstname', 'lastname', 'userip']);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key, privateFields.has(key.replace(/[_-]/g, '').toLowerCase())
            ? '[REDACTED]' : redactPersonalData(child)
    ]));
}

async function call(path, data, { timeout = 30000 } = {}) {
    const config = getConfiguration();
    if (!config.configured) throw configurationError();
    const url = `${config.baseUrl}${path}`;
    const startedAt = Date.now();
    let response;
    try {
        response = await axios.post(url, data, {
            auth: { username: config.keyId, password: config.apiKey },
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'RatehawkAffiliate/1.0 (Remal/1.0)' },
            timeout,
            maxRedirects: 0,
            maxContentLength: 8 * 1024 * 1024,
            validateStatus: () => true
        });
    } catch (error) {
        logger.logEtgExchange({ method: 'post', url, auth: true, requestPayload: redactPersonalData(redactAffiliateIds(data)),
            responsePayload: redactPersonalData(redactAffiliateIds(error.response?.data)), statusCode: error.response?.status,
            latencyMs: Date.now() - startedAt, error: { code: error.code || 'request_failed' } });
        const safeError = new Error('affiliate_supplier_request_unavailable');
        safeError.code = error.code || 'affiliate_supplier_request_unavailable';
        safeError.httpStatus = error.response?.status;
        throw safeError;
    }
    logger.logEtgExchange({ method: 'post', url, auth: true, requestPayload: redactPersonalData(redactAffiliateIds(data)),
        responsePayload: redactPersonalData(redactAffiliateIds(response.data)),
        statusCode: response.status, latencyMs: Date.now() - startedAt });
    const body = response.data || {};
    return {
        ok: body.status === 'ok' && (body.error === undefined || body.error === null),
        status: body.status,
        error: body.error || null,
        data: body.data !== undefined ? body.data : null,
        httpStatus: response.status,
        rateLimit: {
            reset: response.headers?.['x-ratelimit-reset'],
            secondsNumber: Number(response.headers?.['x-ratelimit-seconds-number']) || null
        }
    };
}

const hotelPage = (data, options) => call('/api/b2b/v3/search/hp/', data, options);
const prebook = (data, options) => call('/api/b2b/v3/hotel/prebook/', data, options);
const bookingForm = (data, options) => call('/api/b2b/v3/hotel/order/booking/form/', data, options);
const bookingFinish = (data, options) => call('/api/b2b/v3/hotel/order/booking/finish/', data, { timeout: 60000, ...options });
const bookingFinishStatus = (data, options) => call('/api/b2b/v3/hotel/order/booking/finish/status/', data, options);

module.exports = { normalizeBaseUrl, getConfiguration, call, hotelPage, prebook, bookingForm, bookingFinish,
    bookingFinishStatus, _test: { redactAffiliateIds, redactPersonalData } };