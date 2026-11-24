const crypto = require('node:crypto');

/*
 * Tabby "Pay in 4" (UAE). The secret key never leaves the server. Tabby's hosted checkout opens
 * in the guest's browser; its redirect is never payment evidence: every decision is taken from
 * GET /api/v2/payments/{id}. Amounts are AED strings with up to two decimals.
 */
const API_URL = 'https://api.tabby.ai';
const PAYMENT_STATUSES = new Set(['CREATED', 'AUTHORIZED', 'CLOSED', 'REJECTED', 'EXPIRED']);
const REJECTIONS = new Set(['not_available', 'order_amount_too_high', 'order_amount_too_low']);
const WEBHOOK_HEADER = 'X-Pillow-Tabby-Token';
const PAYMENT_ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

function error(code, extra = {}) {
    return Object.assign(new Error(code), { code, ...extra });
}

function settings(environment = process.env) {
    const secretKey = typeof environment.TABBY_SECRET_KEY === 'string' ? environment.TABBY_SECRET_KEY.trim() : '';
    return {
        secretKey,
        merchantCode: typeof environment.TABBY_MERCHANT_CODE === 'string' ? environment.TABBY_MERCHANT_CODE.trim() : '',
        webhookSecret: typeof environment.TABBY_WEBHOOK_SECRET === 'string' ? environment.TABBY_WEBHOOK_SECRET : '',
        test: secretKey.startsWith('sk_test_')
    };
}

/** Tabby is offered only when fully configured, and only with keys that match the payment environment. */
function isTabbyReady(environment = process.env) {
    const config = settings(environment);
    return environment.TABBY_ENABLED === 'true'
        && /^sk_(?:test_)?[A-Za-z0-9-]{20,100}$/.test(config.secretKey)
        && /^[A-Za-z0-9_-]{1,64}$/.test(config.merchantCode)
        && config.webhookSecret.length >= 32
        && ['true', 'false'].includes(environment.ZIINA_TEST_MODE)
        && config.test === (environment.ZIINA_TEST_MODE === 'true');
}

function amountText(minor) {
    if (!Number.isSafeInteger(minor) || minor <= 0) throw error('invalid_tabby_amount');
    return (minor / 100).toFixed(2);
}

function amountMinor(value) {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

async function request(path, { method = 'GET', payload, environment = process.env, fetcher = globalThis.fetch, headers = {}, allowArray = false } = {}) {
    const { secretKey } = settings(environment);
    if (!secretKey) throw error('tabby_not_configured');
    let response;
    try {
        response = await fetcher(`${API_URL}${path}`, {
            method, redirect: 'error', signal: AbortSignal.timeout(20000),
            headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
            ...(payload ? { body: JSON.stringify(payload) } : {})
        });
    } catch {
        throw error('tabby_request_failed');
    }
    let body = null;
    try { body = await response.json(); } catch { /* Some edge errors have no body. */ }
    if (!response.ok) {
        const errorType = typeof body?.errorType === 'string' && /^[a-z_]{1,40}$/.test(body.errorType) ? body.errorType : undefined;
        throw error('tabby_request_failed', { httpStatus: response.status, ...(errorType ? { errorType } : {}) });
    }
    if (!body || typeof body !== 'object' || (!allowArray && Array.isArray(body))) throw error('tabby_request_failed');
    return body;
}

function clean(value, max = 255) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function checkoutUrl(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
        && /^(?:[a-z0-9-]+\.)*tabby\.ai$/i.test(url.hostname) && value.length <= 4096 ? url.href : null;
}

function sessionResult(body) {
    const status = body.status;
    const paymentId = body.payment?.id;
    if (!['created', 'rejected'].includes(status) || typeof body.id !== 'string' || !PAYMENT_ID.test(paymentId || '')) throw error('invalid_tabby_session');
    if (status === 'rejected') {
        const reason = body.configuration?.products?.installments?.rejection_reason;
        return { status, sessionId: body.id, paymentId, rejectionReason: REJECTIONS.has(reason) ? reason : 'not_available' };
    }
    const webUrl = checkoutUrl(body.configuration?.available_products?.installments?.[0]?.web_url);
    if (!webUrl) throw error('invalid_tabby_session');
    return { status, sessionId: body.id, paymentId, webUrl, test: body.payment?.is_test === true };
}

/**
 * One session per "Confirm and pay". The hotel stay travels as Tabby's hotel attachment; the hotel's
 * address stands in for the shipping address, since nothing is shipped.
 */
async function createSession({ reference, amount, language, buyer, registeredSince, hotel, stay, roomName, passengers, returnUrls, environment = process.env, fetcher }) {
    const config = settings(environment);
    const total = amountText(amount);
    const hotelName = clean(hotel.name) || 'Hotel';
    const city = clean(hotel.city) || clean(hotel.countryCode) || hotelName;
    const address = clean(hotel.address) || hotelName;
    const itinerary = { hotel_name: hotelName, address, hotel_city: city, ...(clean(hotel.countryCode, 2) ? { hotel_country: clean(hotel.countryCode, 2) } : {}),
        start_date: stay.checkin, end_date: stay.checkout, number_of_rooms: stay.rooms };
    const body = await request('/api/v2/checkout', { method: 'POST', environment, fetcher, payload: {
        payment: {
            amount: total, currency: 'AED', description: clean(`${hotelName} · ${stay.checkin} → ${stay.checkout}`),
            buyer: { name: clean(buyer.name), email: clean(buyer.email, 254), phone: clean(buyer.phone, 20) },
            shipping_address: { city, address, zip: clean(hotel.zip, 20) || '00000' },
            order: {
                reference_id: reference, updated_at: new Date().toISOString(),
                tax_amount: '0.00', shipping_amount: '0.00', discount_amount: '0.00',
                items: [{ reference_id: String(hotel.hid), title: clean(`${hotelName} · ${roomName}`), description: clean(`${stay.checkin} → ${stay.checkout}`),
                    quantity: 1, unit_price: total, discount_amount: '0.00', category: 'Hotel', is_refundable: true }]
            },
            buyer_history: { registered_since: registeredSince, loyalty_level: 0, is_email_verified: true },
            meta: { order_id: reference },
            attachment: { content_type: 'application/vnd.tabby.v1+json', body: JSON.stringify({ hotel_reservation_details: {
                pnr: reference, hotel_itinerary: [itinerary],
                passengers: passengers.slice(0, 20).map(person => ({ first_name: clean(person.first_name, 50), last_name: clean(person.last_name, 50),
                    full_name: clean(`${person.first_name} ${person.last_name}`, 101) }))
            } }) }
        },
        lang: language === 'ar' ? 'ar' : 'en',
        merchant_code: config.merchantCode,
        merchant_urls: returnUrls
    } });
    return sessionResult(body);
}

/** Pre-scoring: may this buyer pay this amount with Tabby? Creates nothing the guest can pay. */
async function prescore({ amount, email, phone, language, environment = process.env, fetcher }) {
    const config = settings(environment);
    const body = await request('/api/v2/checkout', { method: 'POST', environment, fetcher, payload: {
        payment: { amount: amountText(amount), currency: 'AED', buyer: { email: clean(email, 254), phone: clean(phone, 20) } },
        lang: language === 'ar' ? 'ar' : 'en', merchant_code: config.merchantCode
    } });
    const result = sessionResult(body);
    return result.status === 'created' ? { available: true } : { available: false, reason: result.rejectionReason };
}

function validatePayment(payment, { id, amount, test, reference } = {}) {
    if (!payment || typeof payment !== 'object' || !PAYMENT_ID.test(payment.id || '') || !PAYMENT_STATUSES.has(payment.status)
        || payment.currency !== 'AED' || amountMinor(payment.amount) === null
        || (id && payment.id !== id) || (amount !== undefined && amountMinor(payment.amount) !== amount)
        || (typeof test === 'boolean' && payment.is_test !== test)
        || (reference && payment.order?.reference_id !== reference)) throw error('invalid_tabby_payment');
    return payment;
}

const total = (items, field = 'amount') => (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (amountMinor(item?.[field]) || 0), 0);
const capturedAmount = payment => total(payment.captures);
const refundedAmount = payment => total(payment.refunds);
const findRefund = (payment, referenceId) => (Array.isArray(payment.refunds) ? payment.refunds : []).find(item => item?.reference_id === referenceId) || null;

async function getPayment(id, options = {}) {
    if (!PAYMENT_ID.test(id || '')) throw error('invalid_tabby_payment');
    return request(`/api/v2/payments/${id}`, options);
}

/** Capture the whole amount. reference_id makes a repeated call return the first capture. */
async function capturePayment({ id, amount, referenceId, environment, fetcher }) {
    if (!PAYMENT_ID.test(id || '')) throw error('invalid_tabby_payment');
    return request(`/api/v2/payments/${id}/captures`, { method: 'POST', environment, fetcher,
        payload: { amount: amountText(amount), reference_id: referenceId } });
}

/** Refund (all or part) of a captured payment. Reusing reference_id returns the first refund. */
async function refundPayment({ id, amount, referenceId, reason, environment, fetcher }) {
    if (!PAYMENT_ID.test(id || '')) throw error('invalid_tabby_payment');
    return request(`/api/v2/payments/${id}/refunds`, { method: 'POST', environment, fetcher,
        payload: { amount: amountText(amount), reference_id: referenceId, ...(reason ? { reason: clean(reason) } : {}) } });
}

function verifyWebhook(value, secret = settings().webhookSecret) {
    if (typeof value !== 'string' || typeof secret !== 'string' || secret.length < 32 || value.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(secret));
}

/** Webhooks are registered once per key (scripts/tabby-webhook.js), never from a request. */
async function registerWebhook({ url, environment = process.env, fetcher } = {}) {
    const config = settings(environment);
    return request('/api/v1/webhooks', { method: 'POST', environment, fetcher, headers: { 'X-Merchant-Code': config.merchantCode },
        payload: { url, header: { title: WEBHOOK_HEADER, value: config.webhookSecret } } });
}

async function listWebhooks({ environment = process.env, fetcher } = {}) {
    const config = settings(environment);
    return request('/api/v1/webhooks', { environment, fetcher, allowArray: true, headers: { 'X-Merchant-Code': config.merchantCode } });
}

module.exports = { WEBHOOK_HEADER, PAYMENT_ID, REJECTIONS, settings, isTabbyReady, amountText, amountMinor, createSession, prescore,
    validatePayment, capturedAmount, refundedAmount, findRefund, getPayment, capturePayment, refundPayment, verifyWebhook,
    registerWebhook, listWebhooks, checkoutUrl };
