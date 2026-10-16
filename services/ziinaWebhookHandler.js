const crypto = require('node:crypto');
const CheckoutSession = require('../models/CheckoutSession');
const { decryptGuestDetails } = require('./checkoutSessionService');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { hotelbedsScopeFrom, ownerSubjectFrom } = require('./hotelbedsScope');
const { validOfferTermsVersion } = require('./offerTermsVersion');

const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function createMockWebhookSignature(rawBody, secret, timestamp) {
    return crypto.createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex');
}

function safeEqualHex(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string'
        || !/^[a-f\d]{64}$/i.test(left) || !/^[a-f\d]{64}$/i.test(right)) return false;
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function createZiinaWebhookHandler({
    Model = CheckoutSession,
    hotelbedsBookingService,
    env = process.env,
    now = () => new Date(),
    verifySignature,
    createBookingReference = () => `HBMOCK-${crypto.randomUUID()}`,
    database = hotelbedsMockDatabase,
    testOnly = false,
    ensureDatabaseReady: testEnsureDatabaseReady
} = {}) {
    const ensureDatabaseReady = async () => {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        await database.ensureModelConnected(Model, { env, errorCode: 'checkout_database_unavailable' });
    };
    if (!Model || typeof Model.findOne !== 'function' || typeof Model.findOneAndUpdate !== 'function'
        || !hotelbedsBookingService || typeof hotelbedsBookingService.confirmBooking !== 'function'
        || typeof now !== 'function' || typeof createBookingReference !== 'function' || !database
        || testOnly && typeof testEnsureDatabaseReady !== 'function'
        || testOnly && process.env.NODE_ENV === 'production'
        || !testOnly && testEnsureDatabaseReady !== undefined) {
        throw new TypeError('ziina_webhook_handler_dependencies_invalid');
    }

    function verifyMockSignature(rawBody, signature, timestampHeader) {
        if (typeof verifySignature === 'function') return verifySignature(rawBody, signature, timestampHeader);
        const secret = env.ZIINA_MOCK_WEBHOOK_SECRET || '';
        if (secret.length < 32 || !Buffer.isBuffer(rawBody) || rawBody.length > MAX_WEBHOOK_BYTES
            || typeof timestampHeader !== 'string' || !/^\d{10,13}$/.test(timestampHeader)) return false;
        const timestamp = Number(timestampHeader) * (timestampHeader.length === 10 ? 1000 : 1);
        const current = new Date(now()).getTime();
        if (!Number.isFinite(current) || Math.abs(current - timestamp) > MAX_WEBHOOK_AGE_MS) return false;
        return safeEqualHex(signature, createMockWebhookSignature(rawBody, secret, timestampHeader));
    }

    async function updateProcessingSession(session, attemptId, fields) {
        const at = new Date(now());
        return Model.findOneAndUpdate({
            sessionId: session.sessionId,
            realm: session.realm,
            environment: session.environment,
            accountId: session.accountId,
            ownerSubject: session.ownerSubject,
            status: 'booking_processing',
            bookingAttemptId: attemptId
        }, {
            $set: { ...fields, completedAt: at, webhookProcessedAt: at }
        }, { new: true }).lean();
    }

    async function handleEvent(event) {
        if (env.HOTELBEDS_PREPAID_CHECKOUT_ENABLED !== 'true'
            || env.HOTELBEDS_PREPAID_CHECKOUT_APPROVED !== 'true'
            || env.HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED !== 'true'
            || env.HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED !== 'true'
            || env.HOTELBEDS_MOCK_DATABASE_ENABLED !== 'true'
            || env.HOTELBEDS_ENABLED !== 'true'
            || String(env.HOTELBEDS_ENV || '').toLowerCase() !== 'test') {
            throw fail('hotelbeds_prepaid_mock_flow_disabled', 503);
        }
        await ensureDatabaseReady();
        let supplierScope;
        try { supplierScope = hotelbedsScopeFrom(env, { testOnly }); }
        catch { throw fail('checkout_scope_unavailable', 503); }
        if (!event || typeof event !== 'object' || Array.isArray(event)
            || event.event !== 'payment_intent.status.updated'
            || event.data?.status !== 'completed'
            || typeof event.data?.id !== 'string' || !/^mock_[a-f\d]{32}$/i.test(event.data.id)
            || typeof event.data?.sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(event.data.sessionId)
            || !Number.isSafeInteger(event.data?.amount) || event.data.amount < 1
            || event.data.currency !== 'AED') throw fail('invalid_mock_payment_event', 400);

        const session = await Model.findOne({ sessionId: event.data.sessionId, ...supplierScope })
            .select([
                '+paymentIntentId', '+providerOfferRef', '+providerHotelCode', '+lockedNetPrice',
                '+lockedNetCurrency', '+guestDetailsEncrypted', '+realm', '+environment', '+accountId',
                '+ownerSubject', '+provider', '+offerOrigin', '+acceptedTermsVersion', '+termsAcceptedAt'
            ].join(' ')).lean();
        if (!session) throw fail('checkout_session_not_found', 404);
        try { ownerSubjectFrom(session.ownerSubject, { testOnly }); }
        catch { throw fail('checkout_session_not_found', 404); }
        const sessionFilter = {
            sessionId: session.sessionId,
            ...supplierScope,
            ownerSubject: session.ownerSubject
        };
        if (session.provider !== 'hotelbeds' || session.offerOrigin !== 'mock_fixture'
            || session.environment !== 'test'
            || !validOfferTermsVersion(session.acceptedTermsVersion)
            || !(session.termsAcceptedAt instanceof Date)
            || Number.isNaN(session.termsAcceptedAt.getTime())) {
            throw fail('checkout_terms_acceptance_required', 409);
        }
        if (session.paymentIntentId !== event.data.id || session.totalAmount !== event.data.amount
            || session.currency !== event.data.currency) throw fail('mock_payment_identity_mismatch', 409);
        if (['confirmed', 'outcome_unknown', 'refund_review'].includes(session.status)) {
            return { sessionId: session.sessionId, status: session.status, duplicate: true };
        }

        const verifiedAt = new Date(now());
        if (Number.isNaN(verifiedAt.getTime())) throw fail('checkout_clock_invalid', 503);

        // Do not attempt to book a provider token after the source offer expired.
        if (!(session.offerExpiresAt instanceof Date) || session.offerExpiresAt <= verifiedAt) {
            const verified = await Model.findOneAndUpdate({
                ...sessionFilter,
                paymentIntentId: event.data.id,
                status: 'awaiting_payment'
            }, {
                $set: {
                    status: 'payment_verified',
                    paymentVerifiedAt: verifiedAt,
                    webhookProcessedAt: verifiedAt
                }
            }, { new: true }).lean();
            if (!verified) {
                const current = await Model.findOne(sessionFilter).lean();
                return { sessionId: session.sessionId, status: current?.status || 'payment_verified', duplicate: true };
            }
            const review = await Model.findOneAndUpdate({
                ...sessionFilter,
                sessionId: verified.sessionId,
                status: 'payment_verified'
            }, {
                $set: {
                    status: 'refund_review',
                    lastError: 'offer_expired_after_payment',
                    completedAt: verifiedAt,
                    webhookProcessedAt: verifiedAt
                }
            }, { new: true }).lean();
            return { sessionId: verified.sessionId, status: review?.status || 'refund_review', duplicate: false };
        }

        // Atomic compare-and-set admits exactly one delivery to booking.
        const verified = await Model.findOneAndUpdate({
            ...sessionFilter,
            paymentIntentId: event.data.id,
            totalAmount: event.data.amount,
            currency: event.data.currency,
            status: 'awaiting_payment'
        }, {
            $set: { status: 'payment_verified', paymentVerifiedAt: verifiedAt, webhookProcessedAt: verifiedAt }
        }, { new: true }).lean();
        if (!verified) {
            const current = await Model.findOne(sessionFilter).lean();
            if (current && current.status !== 'awaiting_payment') {
                return { sessionId: current.sessionId, status: current.status, duplicate: true };
            }
            throw fail('checkout_session_state_conflict', 409);
        }

        const attemptId = crypto.randomUUID();
        const bookingStartedAt = new Date(now());
        const claimed = await Model.findOneAndUpdate({
            ...sessionFilter,
            sessionId: verified.sessionId,
            status: 'payment_verified'
        }, {
            $set: { status: 'booking_processing', bookingAttemptId: attemptId, bookingStartedAt }
        }, { new: true }).select([
            '+offerOrigin', '+providerOfferRef', '+providerHotelCode', '+lockedNetPrice',
            '+lockedNetCurrency', '+guestDetailsEncrypted', '+realm', '+environment',
            '+accountId', '+ownerSubject', '+provider'
        ].join(' ')).lean();
        if (!claimed) {
            const current = await Model.findOne(sessionFilter).lean();
            return { sessionId: verified.sessionId, status: current?.status || 'booking_processing', duplicate: true };
        }

        let guestDetails;
        try {
            guestDetails = decryptGuestDetails(claimed.guestDetailsEncrypted, env);
        } catch {
            await updateProcessingSession(claimed, attemptId, {
                status: 'refund_review', lastError: 'checkout_guest_details_unavailable'
            });
            return { sessionId: claimed.sessionId, status: 'refund_review', duplicate: false };
        }

        let bookingResult;
        try {
            bookingResult = await hotelbedsBookingService.confirmBooking({
                session: {
                    sessionId: claimed.sessionId,
                    publicOfferId: claimed.publicOfferId,
                    provider: claimed.provider,
                    offerOrigin: claimed.offerOrigin,
                    providerHotelCode: claimed.providerHotelCode,
                    providerOfferRef: claimed.providerOfferRef,
                    totalAmount: claimed.totalAmount,
                    currency: claimed.currency,
                    lockedNetPrice: claimed.lockedNetPrice,
                    lockedNetCurrency: claimed.lockedNetCurrency,
                    rateType: claimed.rateType,
                    occupancy: claimed.occupancy,
                    acceptedTermsVersion: claimed.acceptedTermsVersion,
                    termsAcceptedAt: claimed.termsAcceptedAt,
                    offerExpiresAt: claimed.offerExpiresAt
                },
                guestDetails,
                createBookingReference
            });
        } catch (error) {
            const priceChanged = error?.code === 'booking_rate_changed'
                || error?.code === 'booking_rate_not_bookable';
            const knownFailure = priceChanged || error?.outcomeUnknown === false || error?.httpStatus === 409;
            const status = knownFailure ? 'refund_review' : 'outcome_unknown';
            await updateProcessingSession(claimed, attemptId, {
                status,
                lastError: priceChanged ? 'booking_rate_changed_after_payment'
                    : knownFailure ? 'booking_failed_after_payment' : 'booking_outcome_unknown'
            });
            return { sessionId: claimed.sessionId, status, duplicate: false };
        }

        if (!bookingResult || bookingResult.status !== 'CONFIRMED'
            || typeof bookingResult.bookingReference !== 'string' || !bookingResult.bookingReference.trim()) {
            await updateProcessingSession(claimed, attemptId, {
                status: 'outcome_unknown', lastError: 'booking_confirmation_ambiguous'
            });
            return { sessionId: claimed.sessionId, status: 'outcome_unknown', duplicate: false };
        }

        const confirmedAt = new Date(now());
        const confirmed = await Model.findOneAndUpdate({
            ...sessionFilter,
            sessionId: claimed.sessionId,
            status: 'booking_processing',
            bookingAttemptId: attemptId
        }, {
            $set: {
                status: 'confirmed',
                bookingReference: bookingResult.bookingReference.trim(),
                confirmedAt,
                completedAt: confirmedAt,
                webhookProcessedAt: confirmedAt
            }
        }, { new: true }).lean();
        if (!confirmed) throw fail('checkout_session_state_conflict', 503);
        return { sessionId: confirmed.sessionId, status: confirmed.status, duplicate: false };
    }

    async function receiveWebhook(req, res) {
        res.set('Cache-Control', 'no-store');
        try {
            const result = await processSignedEvent(
                req.body,
                req.get('X-Mock-Hmac-Signature'),
                req.get('X-Mock-Timestamp')
            );
            return res.status(200).json({ received: true, ...result });
        } catch (error) {
            const status = error?.httpStatus === 401 ? 401
                : [400, 404, 409, 503].includes(error?.httpStatus) ? error.httpStatus : 503;
            if (status === 503) res.set('Retry-After', '15');
            return res.status(status).json({ received: false,
                error: typeof error?.code === 'string' ? error.code : 'mock_webhook_unavailable' });
        }
    }

    async function processSignedEvent(rawBody, signature, timestampHeader) {
        if (!verifyMockSignature(rawBody, signature, timestampHeader)) {
            throw fail('mock_webhook_signature_invalid', 401);
        }
        let event;
        try {
            event = JSON.parse(rawBody.toString('utf8'));
        } catch {
            throw fail('mock_webhook_payload_invalid', 400);
        }
        return handleEvent(event);
    }

    return { handleEvent, processSignedEvent, receiveWebhook, verifyMockSignature };
}

module.exports = {
    MAX_WEBHOOK_BYTES,
    MAX_WEBHOOK_AGE_MS,
    createMockWebhookSignature,
    createZiinaWebhookHandler
};