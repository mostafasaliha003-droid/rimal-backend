// services/paymentService.js

const crypto = require('node:crypto');
const { SUPPORTED_CURRENCIES, minorUnits } = require('./ziinaClient');

function supplierIdentity(environment = process.env) {
    if (!environment.RATEHAWK_BASE_URL || !environment.RATEHAWK_KEY_ID) return null;
    let url;
    try { url = new URL(environment.RATEHAWK_BASE_URL); } catch { return null; }
    if (!['api-sandbox.ratehawk.com', 'api.ratehawk.com'].includes(url.hostname) || url.protocol !== 'https:') return null;
    return crypto.createHash('sha256').update(JSON.stringify([url.hostname, environment.RATEHAWK_KEY_ID])).digest('hex');
}

function supplierHost(value, hostname) {
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === 'https:' && url.hostname === hostname && !url.port
        && !url.username && !url.password && !url.search && !url.hash
        && ['/', '/api/b2b/v3', '/api/b2b/v3/'].includes(url.pathname);
}

function isCheckoutReady(environment = process.env) {
    const required = environment.PAYMENT_ROLLOUT_APPROVED === 'true'
        && environment.PAYMENT_CHECKOUT_ENABLED === 'true'
        && environment.RATEHAWK_BOOKING_ENABLED === 'true'
        && environment.ZIINA_REFUNDS_ENABLED === 'true'
        && environment.ZIINA_WEBHOOK_CONFIGURED === 'true'
        && typeof environment.MONGO_URI === 'string' && environment.MONGO_URI.length > 0
        && typeof environment.RATEHAWK_KEY_ID === 'string' && environment.RATEHAWK_KEY_ID.length > 0
        && typeof environment.RATEHAWK_API_KEY === 'string' && environment.RATEHAWK_API_KEY.length > 0
        && typeof environment.ZIINA_API_KEY === 'string' && environment.ZIINA_API_KEY.length > 0
        && typeof environment.ZIINA_ACCOUNT_ID === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(environment.ZIINA_ACCOUNT_ID)
        && typeof environment.ZIINA_WEBHOOK_SECRET === 'string' && environment.ZIINA_WEBHOOK_SECRET.length >= 32
        && /^[a-f\d]{64}$/i.test(environment.PAYMENT_BOOKING_ENCRYPTION_KEY || '');
    if (!required) return false;
    let frontend;
    try { frontend = new URL(environment.FRONTEND_URL); } catch { return false; }
    if (frontend.username || frontend.password) return false;
    if (environment.ZIINA_TEST_MODE === 'true') {
        return environment.PAYMENT_SANDBOX_ENABLED === 'true'
            && environment.PAYMENT_ETG_SANDBOX_ISOLATED === 'true'
            && supplierHost(environment.RATEHAWK_BASE_URL, 'api-sandbox.ratehawk.com')
            && (frontend.protocol === 'https:' || frontend.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(frontend.hostname))
            && !['remalbookings.com', 'www.remalbookings.com'].includes(frontend.hostname);
    }
    return environment.ZIINA_TEST_MODE === 'false'
        && environment.PAYMENT_PRODUCTION_APPROVED === 'true'
        && environment.PAYMENT_SANDBOX_ENABLED === 'false'
        && environment.PAYMENT_ETG_SANDBOX_ISOLATED === 'false'
        && environment.RATEHAWK_CANCELLATION_ENABLED === 'true'
        && typeof environment.RATEHAWK_BOOKING_TOKEN === 'string' && environment.RATEHAWK_BOOKING_TOKEN.length >= 32
        && environment.RATEHAWK_BOOKING_TOKEN !== environment.REMAL_SECURE_KEY
        && Boolean(environment.SMTP_USER && environment.SMTP_PASSWORD)
        && supplierHost(environment.RATEHAWK_BASE_URL, 'api.ratehawk.com')
        && frontend.origin === 'https://remalbookings.com';
}

function isRefundReady(environment = process.env) {
    return environment.ZIINA_REFUNDS_ENABLED === 'true'
    && ['true', 'false'].includes(environment.ZIINA_TEST_MODE)
        && typeof environment.ZIINA_API_KEY === 'string' && environment.ZIINA_API_KEY.length > 0
        && typeof environment.ZIINA_ACCOUNT_ID === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(environment.ZIINA_ACCOUNT_ID);
}

function resolveValidatedPayment(result, expected) {
    const hotels = result?.hotels || (result?.hotel ? [result.hotel] : []);
    const hotel = hotels.find(item => String(item.hid || item.id) === String(expected.hid));
    const rates = hotel?.rates || [];
    if (rates.length !== 1 || result?.changes?.price_changed
        || (expected.roomName && rates[0]?.room_name && rates[0].room_name !== expected.roomName)) {
        throw new Error('RATE_CHANGED');
    }
    const rate = rates[0];
    const payment = rate.payment_options?.payment_types?.find(item => item.type === 'deposit');
    const amount = Number(payment?.amount);
    if (!payment || !SUPPORTED_CURRENCIES.has(payment.currency_code) || payment.currency_code !== expected.currency
        || !Number.isFinite(amount) || amount <= 0 || !rate.book_hash
        || Math.round(amount * 100) !== Math.round(Number(expected.total) * 100)) {
        throw new Error('RATE_CHANGED');
    }
    try { minorUnits(amount); } catch { throw new Error('RATE_CHANGED'); }
    if (payment.currency_code === 'AED' && amount < 2) throw new Error('RATE_CHANGED');
    return { amount, currency: payment.currency_code, book_hash: rate.book_hash };
}

module.exports = {
    isCheckoutReady,
    isRefundReady,
    supplierIdentity,
    resolveValidatedPayment
};
