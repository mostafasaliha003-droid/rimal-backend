// services/paymentService.js

const crypto = require('node:crypto');
const { SUPPORTED_CURRENCIES, minorUnits } = require('./ziinaClient');
const { calculateDisplayPrice } = require('./pricingService');
const { sandboxDatabaseConfigured } = require('./sandboxDatabase');

const B2C_MARKUP_PERCENT = '7';

function customerPrice(rate) {
    const payment = rate?.payment_options?.payment_types?.find(item => item.type === 'deposit');
    // ETG sends show_* fields for customer-facing offers, but B2B prebook
    // responses may contain only the documented amount/currency_code pair.
    // Both describe the same supplier payment here; the customer amount is
    // calculated server-side and verified again before a Ziina intent exists.
    const sourceAmount = payment?.show_amount ?? payment?.amount;
    const sourceCurrency = payment?.show_currency_code ?? payment?.currency_code;
    if (!payment || !SUPPORTED_CURRENCIES.has(sourceCurrency)) throw new Error('RATE_CHANGED');
    try {
        const priced = calculateDisplayPrice({ price: { supplierAmount: {
            amount: sourceAmount, currency: sourceCurrency
        } } }, sourceCurrency, { markupPercent: B2C_MARKUP_PERCENT });
        return { amount: Number(priced.price.display.amount), currency: priced.price.display.currency };
    } catch { throw new Error('RATE_CHANGED'); }
}

function decorateRate(rate) {
    if (!rate || typeof rate !== 'object') return rate;
    try {
        const display = customerPrice(rate);
        return { ...rate, customer_display_amount: display.amount, customer_display_currency: display.currency };
    } catch { return rate; }
}

function decorateHotels(hotels) {
    return (Array.isArray(hotels) ? hotels : []).map(hotel => ({
        ...hotel,
        rates: (hotel.rates || []).map(decorateRate)
    }));
}

function decoratePrebook(result) {
    return { ...result,
        ...(Array.isArray(result?.hotels) ? { hotels: decorateHotels(result.hotels) } : {}),
        ...(result?.rate ? { rate: decorateRate(result.rate) } : {}) };
}

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

function getCheckoutReadiness(environment = process.env) {
    const blockers = [];
    const check = (field, valid) => { if (!valid) blockers.push(field); };
    for (const field of ['PAYMENT_ROLLOUT_APPROVED', 'PAYMENT_CHECKOUT_ENABLED', 'RATEHAWK_BOOKING_ENABLED',
        'ZIINA_REFUNDS_ENABLED', 'ZIINA_WEBHOOK_CONFIGURED']) check(field, environment[field] === 'true');
    for (const field of ['MONGO_URI', 'RATEHAWK_KEY_ID', 'RATEHAWK_API_KEY', 'ZIINA_API_KEY']) {
        check(field, typeof environment[field] === 'string' && environment[field].length > 0);
    }
    check('ZIINA_ACCOUNT_ID', typeof environment.ZIINA_ACCOUNT_ID === 'string'
        && /^[a-zA-Z0-9_-]{1,128}$/.test(environment.ZIINA_ACCOUNT_ID));
    check('ZIINA_WEBHOOK_SECRET', typeof environment.ZIINA_WEBHOOK_SECRET === 'string' && environment.ZIINA_WEBHOOK_SECRET.length >= 32);
    check('PAYMENT_BOOKING_ENCRYPTION_KEY', /^[a-f\d]{64}$/i.test(environment.PAYMENT_BOOKING_ENCRYPTION_KEY || ''));
    let frontend;
    try { frontend = new URL(environment.FRONTEND_URL); } catch { /* Report below. */ }
    check('FRONTEND_URL', Boolean(frontend && !frontend.username && !frontend.password));
    const sandbox = environment.ZIINA_TEST_MODE === 'true';
    check('ZIINA_TEST_MODE', ['true', 'false'].includes(environment.ZIINA_TEST_MODE));
    if (environment.ZIINA_TEST_MODE === 'true') {
        check('PAYMENT_SANDBOX_DATABASE', sandboxDatabaseConfigured(environment));
        check('PAYMENT_SANDBOX_ENABLED', environment.PAYMENT_SANDBOX_ENABLED === 'true');
        check('PAYMENT_ETG_SANDBOX_ISOLATED', environment.PAYMENT_ETG_SANDBOX_ISOLATED === 'true');
        check('RATEHAWK_BASE_URL', supplierHost(environment.RATEHAWK_BASE_URL, 'api-sandbox.ratehawk.com'));
        check('FRONTEND_URL', Boolean(frontend && (frontend.protocol === 'https:'
            || frontend.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(frontend.hostname))
            && !['remalbookings.com', 'www.remalbookings.com'].includes(frontend.hostname)));
    } else {
        check('PAYMENT_PRODUCTION_APPROVED', environment.PAYMENT_PRODUCTION_APPROVED === 'true');
        check('PAYMENT_SANDBOX_ENABLED', environment.PAYMENT_SANDBOX_ENABLED === 'false');
        check('PAYMENT_ETG_SANDBOX_ISOLATED', environment.PAYMENT_ETG_SANDBOX_ISOLATED === 'false');
        check('RATEHAWK_CANCELLATION_ENABLED', environment.RATEHAWK_CANCELLATION_ENABLED === 'true');
        check('RATEHAWK_BOOKING_TOKEN', typeof environment.RATEHAWK_BOOKING_TOKEN === 'string'
            && environment.RATEHAWK_BOOKING_TOKEN.length >= 32 && environment.RATEHAWK_BOOKING_TOKEN !== environment.REMAL_SECURE_KEY);
        check('SMTP_USER', Boolean(environment.SMTP_USER));
        check('SMTP_PASSWORD', Boolean(environment.SMTP_PASSWORD));
        check('RATEHAWK_BASE_URL', supplierHost(environment.RATEHAWK_BASE_URL, 'api.ratehawk.com'));
        check('FRONTEND_URL', frontend?.origin === 'https://remalbookings.com');
    }
    return { ready: blockers.length === 0, mode: sandbox ? 'sandbox' : environment.ZIINA_TEST_MODE === 'false' ? 'production' : 'unconfigured',
        blockers: [...new Set(blockers)] };
}

function isCheckoutReady(environment = process.env) {
    return getCheckoutReadiness(environment).ready;
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
    const display = customerPrice(rate);
    if (!payment || !SUPPORTED_CURRENCIES.has(payment.currency_code)
        || !Number.isFinite(amount) || amount <= 0 || !rate.book_hash
        || display.currency !== expected.currency
        || minorUnits(display.amount) !== Math.round(Number(expected.total) * 100)) {
        throw new Error('RATE_CHANGED');
    }
    try { minorUnits(amount); } catch { throw new Error('RATE_CHANGED'); }
    if (payment.currency_code === 'AED' && amount < 2) throw new Error('RATE_CHANGED');
    return { amount, currency: payment.currency_code, customerAmount: display.amount,
        customerCurrency: display.currency, book_hash: rate.book_hash };
}

module.exports = {
    getCheckoutReadiness,
    isCheckoutReady,
    isRefundReady,
    supplierIdentity,
    resolveValidatedPayment,
    customerPrice,
    decorateRate,
    decorateHotels,
    decoratePrebook,
    B2C_MARKUP_PERCENT
};
