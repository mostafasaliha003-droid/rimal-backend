const crypto = require('node:crypto');

const API_URL = 'https://api-v2.ziina.com/api';
const SUPPORTED_CURRENCIES = new Set(['AED', 'USD', 'SAR', 'EUR']);
const PAYMENT_STATUSES = new Set(['requires_payment_instrument', 'requires_user_action', 'pending', 'completed', 'failed', 'canceled']);
const REFUND_STATUSES = new Set(['pending', 'completed', 'failed']);
const WEBHOOK_ADDRESSES = new Set(['3.29.184.186', '3.29.190.95', '20.233.47.127', '13.202.161.181']);

function error(code) {
    return Object.assign(new Error(code), { code });
}

function minorUnits(amount) {
    const value = Number(amount);
    const minor = Math.round(value * 100);
    if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(minor)
        || Math.abs(value * 100 - minor) > 0.000001) throw error('invalid_payment_amount');
    return minor;
}

function validId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function validateIntent(intent, { id, amount, currency, accountId, operationId, test } = {}) {
    if (!intent || !validId(intent.id) || !validId(intent.account_id) || !validId(intent.operation_id)
        || !PAYMENT_STATUSES.has(intent.status) || !Number.isSafeInteger(intent.amount) || intent.amount <= 0
        || !SUPPORTED_CURRENCIES.has(intent.currency_code) || intent.tip_amount !== 0 || intent.allow_tips === true
        || (id && intent.id !== id) || (amount !== undefined && intent.amount !== amount)
        || (currency && intent.currency_code !== currency) || (accountId && intent.account_id !== accountId)
        || (operationId && intent.operation_id !== operationId)
        || (typeof intent.test === 'boolean' && typeof test === 'boolean' && intent.test !== test)) throw error('invalid_ziina_intent');
    return intent;
}

function validateRefund(refund, { id, intentId, amount, currency } = {}) {
    if (!refund || !validId(refund.id) || !validId(refund.payment_intent_id)
        || !REFUND_STATUSES.has(refund.status) || !Number.isSafeInteger(refund.amount) || refund.amount <= 0
        || !SUPPORTED_CURRENCIES.has(refund.currency_code)
        || (id && refund.id !== id) || (intentId && refund.payment_intent_id !== intentId)
        || (amount && refund.amount !== amount) || (currency && refund.currency_code !== currency)) throw error('invalid_ziina_refund');
    return refund;
}

async function request(path, { method = 'GET', payload, token = process.env.ZIINA_API_KEY, fetcher = globalThis.fetch } = {}) {
    if (typeof token !== 'string' || !token) throw error('ziina_not_configured');
    let response;
    try {
        response = await fetcher(`${API_URL}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
            signal: AbortSignal.timeout(15000), redirect: 'error'
        });
        if (!response.ok) throw error('ziina_request_failed');
        return await response.json();
    } catch {
        throw error('ziina_request_failed');
    }
}

function returnUrl(frontendUrl, result, reference) {
    const url = new URL('/checkout', frontendUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw error('invalid_frontend_url');
    }
    if (url.username || url.password) throw error('invalid_frontend_url');
    url.searchParams.set('payment', result);
    url.searchParams.set('ref', reference);
    return url.href;
}

async function createIntent({ amount, currency, reference, accountId = process.env.ZIINA_ACCOUNT_ID, test = false, frontendUrl = process.env.FRONTEND_URL || 'https://remalbookings.com', fetcher, token }) {
    if (!SUPPORTED_CURRENCIES.has(currency) || !validId(reference) || !validId(accountId)) throw error('invalid_payment_context');
    const amountMinor = minorUnits(amount);
    const intent = validateIntent(await request('/payment_intent', {
        method: 'POST', fetcher, token, payload: {
            amount: amountMinor, currency_code: currency, test: test === true, allow_tips: false,
            expiry: String(Date.now() + 20 * 60 * 1000),
            success_url: returnUrl(frontendUrl, 'success', reference),
            cancel_url: returnUrl(frontendUrl, 'cancel', reference),
            failure_url: returnUrl(frontendUrl, 'failed', reference)
        }
    }), { amount: amountMinor, currency, accountId, test });
    let redirect;
    try { redirect = new URL(intent.redirect_url); } catch { throw error('invalid_ziina_redirect'); }
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.port
        || !/^(?:[a-z0-9-]+\.)*ziina\.com$/i.test(redirect.hostname)) throw error('invalid_ziina_redirect');
    return { id: intent.id, accountId: intent.account_id, operationId: intent.operation_id,
        status: intent.status, amount: intent.amount, currency: intent.currency_code, redirectUrl: redirect.href };
}

async function getIntent(id, options = {}) {
    if (!validId(id)) throw error('invalid_ziina_intent_id');
    return validateIntent(await request(`/payment_intent/${encodeURIComponent(id)}`, options), { id });
}

async function createRefund({ id, intentId, amount, currency, test = false, fetcher, token }) {
    if (!validId(id) || !validId(intentId) || !SUPPORTED_CURRENCIES.has(currency)) throw error('invalid_refund_context');
    const amountMinor = minorUnits(amount);
    return validateRefund(await request('/refund', {
        method: 'POST', fetcher, token, payload: { id, payment_intent_id: intentId, amount: amountMinor, currency_code: currency, test: test === true }
    }), { id, intentId, amount: amountMinor, currency });
}

async function getRefund(id, options = {}) {
    if (!validId(id)) throw error('invalid_refund_id');
    return validateRefund(await request(`/refund/${encodeURIComponent(id)}`, options), { id });
}

function verifyWebhook(rawBody, signature, address, secret = process.env.ZIINA_WEBHOOK_SECRET) {
    if (!Buffer.isBuffer(rawBody) || typeof secret !== 'string' || secret.length < 32
        || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)
        || !WEBHOOK_ADDRESSES.has(String(address).replace(/^::ffff:/i, ''))) return false;
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest();
    return crypto.timingSafeEqual(digest, Buffer.from(signature, 'hex'));
}

module.exports = { SUPPORTED_CURRENCIES, minorUnits, validateIntent, validateRefund, createIntent, getIntent, createRefund, getRefund, verifyWebhook };