const crypto = require('node:crypto');
const { supplierIdentity } = require('./paymentService');

const TTL_MS = 15 * 60 * 1000;
function invalid() {
    return Object.assign(new Error('offer_context_expired_or_changed'), { code: 'offer_context_expired_or_changed', httpStatus: 409 });
}
function contextKey() {
    const key = process.env.PAYMENT_BOOKING_ENCRYPTION_KEY || '';
    return /^[a-f\d]{64}$/i.test(key) ? Buffer.from(key, 'hex') : null;
}
function issue(info, kind, { now = Date.now(), expiresAt = now + TTL_MS } = {}) {
    const key = contextKey(), scope = supplierIdentity();
    if (!key || !scope) return undefined;
    const body = Buffer.from(JSON.stringify({ version: 1, kind, scope, issued_at: now,
        expires_at: Math.min(expiresAt, now + TTL_MS), info })).toString('base64url');
    const signature = crypto.createHmac('sha256', key).update(`ratehawk-offer-v1:${body}`).digest('base64url');
    return `${body}.${signature}`;
}
function read(token, bookHash, { now = Date.now() } = {}) {
    const key = contextKey(), scope = supplierIdentity();
    if (!key || !scope || typeof token !== 'string' || token.length > 131072) throw invalid();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw invalid();
    const expected = crypto.createHmac('sha256', key).update(`ratehawk-offer-v1:${parts[0]}`).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw invalid();
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw invalid(); }
    const rate = payload.info?.hotels?.[0]?.rates?.[0];
    if (payload.version !== 1 || !['hotelpage', 'prebook'].includes(payload.kind) || payload.scope !== scope
        || !Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)
        || payload.issued_at > now || payload.expires_at <= now || payload.expires_at - payload.issued_at > TTL_MS
        || payload.info?.hotels?.length !== 1 || payload.info.hotels[0]?.rates?.length !== 1
        || !bookHash || rate?.book_hash !== bookHash) throw invalid();
    return { ...payload.info, context_kind: payload.kind, context_expires_at: payload.expires_at };
}
function attachHotelpage(hotels, criteria) {
    const original_request_params = { checkin: criteria.checkin, checkout: criteria.checkout,
        guests: criteria.guests, residency: criteria.residency, language: criteria.language, currency: criteria.currency };
    return (hotels || []).map(hotel => ({ ...hotel, rates: (hotel.rates || []).map(rate => ({ ...rate,
        offer_context: issue({ original_request_params, hotels: [{ hid: hotel.hid, id: hotel.id, rates: [rate] }] }, 'hotelpage')
    })) }));
}
module.exports = { issue, read, attachHotelpage, TTL_MS };
