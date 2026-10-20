const express = require('express');
const crypto = require('node:crypto');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const postBooking = require('./postBookingService');
const payment = require('./paymentService');
const ziina = require('./ziinaClient');
const { bookingLimiter } = require('./securityService');
const rateLimit = require('express-rate-limit');
const cancellationReadLimiter = rateLimit({ windowMs: 60000, max: 30,
    keyGenerator: req => `${req.auth.realm}:${req.auth.subject}`,
    standardHeaders: true, legacyHeaders: false, message: { error: 'cancellation_rate_limited' } });

function createOwnedBookingCancellationRouter({ BookingModel, requireUser, CheckoutModel = CheckoutAttempt,
    operations = postBooking, refundReady = payment.isRefundReady, env = process.env, now = Date.now,
    limiter = bookingLimiter, readLimiter = cancellationReadLimiter } = {}) {
    const router = express.Router();
    const readPolicy = require('./cancellationPolicyReader').createCancellationPolicyReader(id => operations.getBookingInfo(id));
    const fail = (code, httpStatus = 409) => Object.assign(new Error(code), { code, httpStatus });
    function sign(payload) {
        if (!/^[a-f\d]{64}$/i.test(env.PAYMENT_BOOKING_ENCRYPTION_KEY || '')) throw fail('cancellation_unavailable', 503);
        return crypto.createHmac('sha256', Buffer.from(env.PAYMENT_BOOKING_ENCRYPTION_KEY, 'hex'))
            .update(`owned-cancellation-v1:${payload}`).digest('base64url');
    }
    async function owned(req) {
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(req.params.reference || '')) throw fail('booking_not_found', 404);
        if (!req.auth?.subject || !req.auth.realm || req.auth.realm !== env.RIMAL_AUTH_REALM) throw fail('unauthorized', 401);
        const booking = await BookingModel.findOne({ bookingReference: req.params.reference,
            ownerSubject: req.auth.subject, realm: req.auth.realm }).lean();
        if (!booking) throw fail('booking_not_found', 404);
        return booking;
    }
    async function checkoutFor(booking, req) {
        return CheckoutModel.findOne({ reference: booking.bookingReference, partner_order_id: booking.supplierReference,
            ownerSubject: req.auth.subject, realm: req.auth.realm }).lean();
    }
    const handle = fn => async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
        try { res.json(await fn(req)); }
        catch (error) {
            const known = /^[a-z][a-z0-9_]{0,79}$/.test(error.code || '');
            if (error.httpStatus === 429) res.set('Retry-After', String(Math.max(1, Math.ceil((error.retry_after_ms || 60000) / 1000))));
            res.status(known && [400, 401, 404, 409, 429, 502, 503].includes(error.httpStatus) ? error.httpStatus : 503)
                .json({ error: known ? error.code : 'cancellation_unavailable' });
        }
    };
    router.get('/bookings/:reference/cancellation', requireUser, readLimiter, handle(async req => {
        const booking = await owned(req);
        const base = { reference: booking.bookingReference, policy: typeof booking.cancellationPolicy === 'string' ? booking.cancellationPolicy : '', mode: 'support' };
        if (booking.provider !== 'ratehawk' || !booking.supplierReference) return base;
        const checkout = await checkoutFor(booking, req);
        if (checkout?.cancellation_request_hash) return { ...base, mode: 'tracking', cancellation: await operations.checkCancellation(booking.supplierReference) };
        if (booking.status !== 'active') return base;
        const info = await readPolicy(booking.supplierReference);
        if (info.checking || info.pending) return { ...base, mode: 'checking', retry_after_ms: info.retry_after_ms || 3000 };
        const penalty = info.current_penalty;
        if (info.pending || info.status !== 'completed' || info.isCancellable !== true || !penalty) return base;
        const result = { ...base, penalty, upsells: info.upsells_require_manual_cancellation === true };
        if (!/^\d+(?:\.\d+)?$/.test(penalty.amount)
            || info.upsells_require_manual_cancellation || env.RATEHAWK_CANCELLATION_ENABLED !== 'true' || !refundReady()) return result;
        if (!checkout || checkout.state !== 'booking_confirmed' || !checkout.payment_verified_at
            || checkout.ziina_test !== (env.ZIINA_TEST_MODE === 'true') || !Number.isSafeInteger(checkout.amount_minor)
            || checkout.amount_minor <= 0 || checkout.cancellation_request_hash) return result;
        let feeMinor = 0;
        try {
            if (Number(penalty.amount) > 0) {
                const sourceMinor = ziina.minorUnits(penalty.amount, penalty.currency_code);
                feeMinor = penalty.currency_code === checkout.currency ? sourceMinor
                    : require('./checkoutCurrencyService').convertMinor(sourceMinor, penalty.currency_code,
                        checkout.currency, checkout.payment_quote?.rates || {});
            }
        } catch { return result; }
        if (feeMinor > checkout.amount_minor) return result;
        const refund = { amount: ziina.formatAmountMinor(checkout.amount_minor - feeMinor, checkout.currency), currency_code: checkout.currency };
        const fee = { amount: ziina.formatAmountMinor(feeMinor, checkout.currency), currency_code: checkout.currency };
        const expiresAt = now() + 5 * 60 * 1000;
        const payload = Buffer.from(JSON.stringify({ reference: booking.bookingReference, supplier: booking.supplierReference,
            owner: req.auth.subject, realm: req.auth.realm, amount: checkout.amount_minor, currency: checkout.currency,
            penalty, refund, expiresAt })).toString('base64url');
        return { ...result, mode: 'automatic', fee, refund, expires_at: expiresAt, quote_token: `${payload}.${sign(payload)}` };
    }));
    router.post('/bookings/:reference/cancellation', requireUser, limiter, handle(async req => {
        const booking = await owned(req);
        if (req.body?.confirm_cancellation !== true) throw fail('cancellation_confirmation_required', 400);
        const token = req.body?.quote_token;
        if (typeof token !== 'string' || token.length > 4000) throw fail('cancellation_quote_invalid');
        const parts = token.split('.');
        if (parts.length !== 2 || parts[1].length !== 43 || !crypto.timingSafeEqual(Buffer.from(sign(parts[0])), Buffer.from(parts[1]))) throw fail('cancellation_quote_invalid');
        let quote;
        try { quote = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { throw fail('cancellation_quote_invalid'); }
        if (quote.reference !== booking.bookingReference || quote.supplier !== booking.supplierReference || booking.provider !== 'ratehawk'
            || quote.owner !== req.auth.subject || quote.realm !== req.auth.realm || quote.expiresAt <= now()) throw fail('cancellation_quote_expired_or_changed');
        const checkout = await checkoutFor(booking, req);
        if (!checkout || checkout.amount_minor !== quote.amount || checkout.currency !== quote.currency
            || checkout.ziina_test !== (env.ZIINA_TEST_MODE === 'true')) throw fail('cancellation_quote_expired_or_changed');
        // Re-read the supplier policy immediately before cancellation. The core
        // operation also rechecks it and handles uncertain results idempotently.
        return operations.cancelBooking(booking.supplierReference, { confirm_cancellation: true,
            expected_penalty: quote.penalty, confirm_customer_refund: true, customer_refund: quote.refund });
    }));
    router.get('/bookings/:reference/cancellation/status', requireUser, readLimiter, handle(async req => {
        const booking = await owned(req);
        if (booking.provider !== 'ratehawk' || !booking.supplierReference) throw fail('cancellation_unavailable');
        return operations.checkCancellation(booking.supplierReference);
    }));
    router.get('/bookings/:reference/cancellation/receipt', requireUser, readLimiter, async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' });
        try {
            const booking = await owned(req);
            const { details, buffer } = await require('./cancellationReceiptService').generateReceipt(booking.supplierReference);
            if (details.reference !== booking.bookingReference || details.owner !== req.auth.subject || details.realm !== req.auth.realm) throw fail('booking_not_found', 404);
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Remal-Cancellation-${booking.bookingReference}.pdf"` });
            res.send(buffer);
        } catch (error) { res.status(error.httpStatus === 404 ? 404 : 503).json({ error: 'cancellation_receipt_unavailable' }); }
    });
    return router;
}

module.exports = { createOwnedBookingCancellationRouter };
