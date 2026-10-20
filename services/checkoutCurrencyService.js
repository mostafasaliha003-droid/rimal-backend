const crypto = require('node:crypto');
const currencies = require('../shared/paymentCurrencies.json');
const ziina = require('./ziinaClient');
const ratehawk = require('./ratehawkService');
const TTL = 20 * 60 * 1000;
const cache = new Map();
function fail(code) { return Object.assign(new Error(code), { code, httpStatus: 409 }); }
function key() {
    if (!/^[a-f\d]{64}$/i.test(process.env.PAYMENT_BOOKING_ENCRYPTION_KEY || '')) throw fail('checkout_quote_unavailable');
    return Buffer.from(process.env.PAYMENT_BOOKING_ENCRYPTION_KEY, 'hex');
}
function offer(input) {
    const result = { hid: Number(input.hid), book_hash: input.book_hash, roomName: input.roomName,
        checkin: input.checkin, checkout: input.checkout, currency: input.currency,
        amount_minor: input.amount_minor ?? ziina.minorUnits(input.total, input.currency),
        guests: input.guests?.map(room => ({ adults: room.adults, children: [...room.children].sort((a, b) => a - b) })) };
    if (!Number.isSafeInteger(result.hid) || result.hid < 1 || typeof result.book_hash !== 'string'
        || !result.book_hash || result.book_hash.length > 1024 || typeof result.roomName !== 'string'
        || !result.roomName || result.roomName.length > 256 || !/^\d{4}-\d{2}-\d{2}$/.test(result.checkin || '')
        || !/^\d{4}-\d{2}-\d{2}$/.test(result.checkout || '') || !Array.isArray(result.guests)
        || !result.guests.length || result.guests.length > 9 || result.guests.some(r =>
            !Number.isInteger(r.adults) || r.adults < 1 || r.adults > 6 || r.children.length > 4
            || r.children.some(age => !Number.isInteger(age) || age < 0 || age > 17))) throw fail('invalid_checkout_quote');
    return result;
}
function binding(input) { return crypto.createHash('sha256').update(JSON.stringify(offer(input))).digest('hex'); }
function parts(value) {
    const match = String(value).match(/^(\d+)(?:\.(\d{1,12}))?$/);
    if (!match) throw fail('checkout_fx_unavailable');
    return { n: BigInt(match[1] + (match[2] || '')), d: 10n ** BigInt((match[2] || '').length) };
}
function convertMinor(amount, source, target, rates) {
    if (!currencies[source] || !currencies[target] || !Number.isSafeInteger(amount) || amount <= 0) throw fail('invalid_checkout_quote');
    const from = parts(rates[source]), to = parts(rates[target]);
    if (from.n <= 0n || to.n <= 0n) throw fail('checkout_fx_unavailable');
    const step = BigInt(currencies[target].step);
    const numerator = BigInt(amount) * to.n * from.d * (10n ** BigInt(currencies[target].decimals));
    const denominator = (10n ** BigInt(currencies[source].decimals)) * to.d * from.n * step;
    const rounded = ((numerator * 2n + denominator) / (denominator * 2n)) * step;
    const value = Number(rounded);
    if (!Number.isSafeInteger(value) || value <= 0) throw fail('invalid_checkout_quote');
    return value;
}
async function liveRates(source, target, { fetcher = globalThis.fetch, now = Date.now() } = {}) {
    if (source === target) return { rates: { [source]: 1 }, date: new Date(now).toISOString().slice(0, 10) };
    const quotes = [...new Set([source, target].filter(c => c !== 'USD'))].sort();
    const cacheKey = quotes.join(',');
    const previous = cache.get(cacheKey);
    if (fetcher === globalThis.fetch && previous && now - previous.at < 5 * 60 * 1000) return previous.value;
    let rows;
    try {
        const r = await fetcher(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=${quotes.join(',')}`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
        if (!r.ok) throw fail('checkout_fx_unavailable');
        rows = await r.json();
    } catch { throw fail('checkout_fx_unavailable'); }
    if (!Array.isArray(rows)) throw fail('checkout_fx_unavailable');
    const rates = { USD: 1 }, dates = [];
    for (const currency of quotes) {
        const matches = rows.filter(r => r.base === 'USD' && r.quote === currency);
        const row = matches[0], published = Date.parse(`${row?.date}T00:00:00Z`);
        if (matches.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')
            || !Number.isFinite(published) || new Date(published).toISOString().slice(0, 10) !== row.date
            || now - published > 5 * 86400000 || published - now > 86400000
            || !Number.isFinite(Number(row.rate)) || Number(row.rate) <= 0) throw fail('checkout_fx_unavailable');
        parts(row.rate); rates[currency] = row.rate; dates.push(row.date);
    }
    const value = { rates, date: dates.sort()[0] };
    if (fetcher === globalThis.fetch) cache.set(cacheKey, { at: now, value });
    return value;
}
function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${crypto.createHmac('sha256', key()).update('checkout-fx-v1:' + data).digest('hex')}`;
}
async function createQuote(input, identity, options = {}) {
    if (identity?.role !== 'user' || !identity.subject || !identity.realm) throw fail('unauthorized');
    const target = input.payment_currency;
    if (!currencies[target]) throw fail('unsupported_payment_currency');
    const details = offer(input);
    const info = await ratehawk.getRateDetailsByHash(details.book_hash);
    require('./checkoutProcessService').verifyRateIdentity(info, details);
    const now = options.now ?? Date.now();
    const fx = await liveRates(details.currency, target, { ...options, now });
    const amount = convertMinor(details.amount_minor, details.currency, target, fx.rates);
    const payload = { v: 1, owner: identity.subject, realm: identity.realm, offer: binding(details),
        currency: target, amount_minor: amount, source_currency: details.currency, source_amount_minor: details.amount_minor,
        test: process.env.ZIINA_TEST_MODE === 'true', expires_at: now + TTL, fx_date: fx.date, rates: fx.rates };
    return { currency: target, amount: ziina.majorUnits(amount, target), amount_formatted: ziina.formatAmountMinor(amount, target),
        expires_at: payload.expires_at, token: sign(payload) };
}
function readQuote(token, details, identity, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 8192) throw fail('invalid_checkout_quote');
    const [data, signature, extra] = token.split('.');
    const expected = crypto.createHmac('sha256', key()).update('checkout-fx-v1:' + data).digest('hex');
    if (extra || !/^[a-f\d]{64}$/.test(signature || '') || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw fail('invalid_checkout_quote');
    let q;
    try { q = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { throw fail('invalid_checkout_quote'); }
    if (q.v !== 1 || q.owner !== identity.subject || q.realm !== identity.realm || q.offer !== binding(details)
        || q.test !== (process.env.ZIINA_TEST_MODE === 'true') || !Number.isFinite(q.expires_at) || q.expires_at <= now
        || !currencies[q.currency] || !Number.isSafeInteger(q.amount_minor) || q.amount_minor <= 0
        || q.amount_minor % currencies[q.currency].step !== 0) throw fail('checkout_quote_expired_or_changed');
    return q;
}
module.exports = { createQuote, readQuote, convertMinor, liveRates };
