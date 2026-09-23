// services/paymentService.js

const { SUPPORTED_CURRENCIES, minorUnits } = require('./ziinaClient');

function isCheckoutReady(environment = process.env) {
    const required = environment.PAYMENT_ROLLOUT_APPROVED === 'true'
        && environment.PAYMENT_CHECKOUT_ENABLED === 'true'
        && environment.RATEHAWK_BOOKING_ENABLED === 'true'
        && environment.ZIINA_REFUNDS_ENABLED === 'true'
        && environment.ZIINA_WEBHOOK_CONFIGURED === 'true'
        && environment.PAYMENT_ETG_SANDBOX_ISOLATED === 'true'
        && typeof environment.MONGO_URI === 'string' && environment.MONGO_URI.length > 0
        && typeof environment.ZIINA_API_KEY === 'string' && environment.ZIINA_API_KEY.length > 0
        && typeof environment.ZIINA_ACCOUNT_ID === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(environment.ZIINA_ACCOUNT_ID)
        && typeof environment.ZIINA_WEBHOOK_SECRET === 'string' && environment.ZIINA_WEBHOOK_SECRET.length >= 32
        && /^[a-f\d]{64}$/i.test(environment.PAYMENT_BOOKING_ENCRYPTION_KEY || '');
    if (!required || environment.ZIINA_TEST_MODE !== 'true' || environment.PAYMENT_SANDBOX_ENABLED !== 'true') return false;
    let frontend;
    try { frontend = new URL(environment.FRONTEND_URL); } catch { return false; }
    return /^https:\/\/api-sandbox\.ratehawk\.com\/?(?:api\/b2b\/v3\/?)*$/.test(environment.RATEHAWK_BASE_URL || '')
        && (frontend.protocol === 'https:' || frontend.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(frontend.hostname))
        && !frontend.username && !frontend.password
        && !['remalbookings.com', 'www.remalbookings.com'].includes(frontend.hostname);
}

function isRefundReady(environment = process.env) {
    return environment.ZIINA_REFUNDS_ENABLED === 'true'
        && environment.ZIINA_TEST_MODE === 'true'
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
    resolveValidatedPayment
};
