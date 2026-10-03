const crypto = require('node:crypto');
const CheckoutSession = require('../models/CheckoutSession');
const { decryptGuestDetails } = require('./checkoutSessionService');
const hotelbedsClientModule = require('./hotelbedsClient');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { isValidRateIdentity, isValidRateTerms } = require('./hotelbedsRateCheckService');
const bookingAttemptStoreModule = require('./hotelbedsBookingAttemptStore');
const { createHotelbedsBookingCoordinator } = require('./hotelbedsBookingCoordinator');

const PREPAID_BOOKING_GATES = Object.freeze([
    'HOTELBEDS_PREPAID_BOOKING_ENABLED',
    'HOTELBEDS_PREPAID_BOOKING_APPROVED',
    'HOTELBEDS_CREDIT_LINE_APPROVED'
]);

function fail(code, httpStatus = 409, details = {}) {
    return Object.assign(new Error(code), { code, httpStatus, ...details });
}

function decimalKey(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match || text.length > 80) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function text(value, code, maxLength = 80) {
    if (typeof value !== 'string') throw fail(code, 400);
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw fail(code, 400);
    }
    return normalized;
}

function bookingGuestPayload(guestDetails, occupancy) {
    if (!guestDetails || typeof guestDetails !== 'object' || Array.isArray(guestDetails)
        || occupancy?.rooms !== 1 || occupancy?.children !== 0
        || !Number.isSafeInteger(occupancy?.adults) || occupancy.adults < 1 || occupancy.adults > 36) {
        throw fail('hotelbeds_prepaid_booking_context_invalid');
    }
    const firstName = text(guestDetails.firstName, 'booking_guest_name_invalid');
    const lastName = text(guestDetails.lastName, 'booking_guest_name_invalid');
    const rooms = guestDetails.rooms;
    const guests = rooms?.[0]?.guests;
    if (!Array.isArray(rooms) || rooms.length !== 1 || !Array.isArray(guests)
        || guests.length !== occupancy.adults || guests.some(guest => guest?.is_child === true)) {
        throw fail('hotelbeds_booking_occupancy_unsupported');
    }
    const paxes = guests.map((guest, index) => ({
        roomId: 1,
        type: 'AD',
        name: index === 0 ? firstName : text(guest?.firstName, 'booking_guest_name_invalid'),
        surname: index === 0 ? lastName : text(guest?.lastName, 'booking_guest_name_invalid')
    }));
    return { holder: { name: firstName, surname: lastName }, paxes };
}

function assertApproved(env) {
    if (PREPAID_BOOKING_GATES.some(gate => env[gate] !== 'true')) {
        throw fail('hotelbeds_prepaid_credit_line_booking_disabled', 503);
    }
    if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
        throw fail('hotelbeds_test_environment_required', 503);
    }
}

function sessionQuery(Model, sessionId) {
    return Model.findOne({ sessionId }).select([
        '+paymentIntentId', '+providerOfferRef', '+providerHotelCode', '+lockedNetPrice',
        '+lockedNetCurrency', '+guestDetailsEncrypted', '+bookingAttemptId',
        '+bookingClientReference', '+bookingRateKey', '+bookingIdentity', '+bookingTerms'
    ].join(' ')).lean();
}

async function readSession(Model, sessionId) {
    try {
        const session = await sessionQuery(Model, sessionId);
        if (!session) throw fail('checkout_session_not_found', 404);
        return session;
    } catch (error) {
        if (error?.httpStatus) throw error;
        throw fail('checkout_database_unavailable', 503);
    }
}

function updateSession(Model, sessionId, expectedStatus, attemptId, fields) {
    return Model.findOneAndUpdate({
        sessionId,
        status: expectedStatus,
        bookingAttemptId: attemptId
    }, { $set: fields }, { new: true }).lean();
}

function publicResult(sessionId, status, duplicate = false) {
    return { sessionId, status, duplicate };
}

function duplicateStatus(attempt, fallbackStatus) {
    if (attempt?.state === 'confirmed' && attempt.bookingReference) return 'confirmed';
    if (attempt?.state === 'booking_pending' && attempt.bookingReference) return 'booking_pending';
    if (['claimed', 'booking_processing', 'booking_pending', 'outcome_unknown'].includes(attempt?.state)) {
        return 'outcome_unknown';
    }
    if (['preflight_failed', 'manual_review'].includes(attempt?.state)) return 'refund_review';
    return fallbackStatus || 'outcome_unknown';
}

function createHotelbedsPrepaidBookingService({
    client = hotelbedsClientModule,
    Model = CheckoutSession,
    env = process.env,
    now = () => new Date(),
    createAttemptId = () => crypto.randomUUID(),
    createClientReference = () => `RML${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    decryptGuests = decryptGuestDetails,
    database = hotelbedsMockDatabase,
    testOnly = false,
    ensureDatabaseReady: testEnsureDatabaseReady,
    attemptStore: injectedAttemptStore
} = {}) {
    const attemptStore = injectedAttemptStore || bookingAttemptStoreModule.createHotelbedsBookingAttemptStore({
        database, env, testOnly,
        ...(testOnly ? { ensureDatabaseReady: testEnsureDatabaseReady } : {})
    });
    const coordinator = createHotelbedsBookingCoordinator({ client });
    const ensureDatabaseReady = async () => {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        await database.ensureModelConnected(Model, { env, errorCode: 'checkout_database_unavailable' });
    };
    if (!client || typeof client.checkRates !== 'function' || typeof client.createBooking !== 'function'
        || !Model || typeof Model.findOne !== 'function' || typeof Model.findOneAndUpdate !== 'function'
        || !attemptStore || typeof attemptStore.claim !== 'function'
        || typeof attemptStore.getBySessionId !== 'function' || typeof attemptStore.transition !== 'function'
        || !env || typeof now !== 'function' || typeof createAttemptId !== 'function'
        || typeof createClientReference !== 'function' || typeof decryptGuests !== 'function'
        || !database || testOnly && typeof testEnsureDatabaseReady !== 'function'
        || testOnly && process.env.NODE_ENV === 'production'
        || !testOnly && testEnsureDatabaseReady !== undefined) {
        throw new TypeError('hotelbeds_prepaid_booking_dependencies_invalid');
    }

    async function finalize(sessionId, attemptId, status, lastError, fields = {}) {
        const at = new Date(now());
        if (Number.isNaN(at.getTime())) throw fail('checkout_clock_invalid', 503);
        const updateFields = {
            status,
            ...fields,
            ...(lastError ? { lastError } : {}),
            webhookProcessedAt: at,
            ...(status === 'confirmed' ? { confirmedAt: at, completedAt: at } : {})
        };
        if (status !== 'booking_pending') updateFields.completedAt = at;
        const saved = await updateSession(Model, sessionId, 'booking_processing', attemptId, {
            ...updateFields
        });
        if (!saved) throw fail('checkout_session_state_conflict', 503);
        return publicResult(sessionId, status);
    }

    async function confirmBooking({ sessionId } = {}) {
        assertApproved(env);
        await ensureDatabaseReady();
        if (typeof sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(sessionId)) {
            throw fail('checkout_session_not_found', 404);
        }

        const session = await readSession(Model, sessionId);
        const existingAttempt = await attemptStore.getBySessionId(sessionId);
        if (existingAttempt) {
            return publicResult(sessionId, duplicateStatus(existingAttempt, session.status), true);
        }
        if (['booking_preflight', 'booking_processing', 'booking_pending', 'confirmed', 'outcome_unknown', 'refund_review'].includes(session.status)) {
            return publicResult(sessionId, session.status, true);
        }
        if (session.status !== 'payment_verified' || session.paymentProvider !== 'ziina'
            || session.paymentType !== 'AT_WEB' || !session.paymentVerifiedAt
            || session.offerOrigin !== 'live'
            || typeof session.paymentIntentId !== 'string' || !session.paymentIntentId
            || session.provider !== 'hotelbeds' || !['BOOKABLE', 'RECHECK'].includes(session.rateType)
            || typeof session.providerOfferRef !== 'string' || !session.providerOfferRef.trim()
            || decimalKey(session.lockedNetPrice) === null
            || !/^[A-Z]{3}$/.test(session.lockedNetCurrency || '')
            || !isValidRateIdentity(session.bookingIdentity)
            || !isValidRateTerms(session.bookingTerms)
            || session.bookingIdentity.net !== decimalKey(session.lockedNetPrice)
            || session.bookingIdentity.currency !== session.lockedNetCurrency
            || session.bookingIdentity.paymentType !== session.paymentType
            || !(session.offerExpiresAt instanceof Date) || session.offerExpiresAt <= new Date(now())) {
            throw fail('hotelbeds_prepaid_booking_session_invalid');
        }

        const attemptId = createAttemptId();
        const clientReference = createClientReference();
        if (typeof attemptId !== 'string' || !/^[a-f\d-]{36}$/i.test(attemptId)
            || typeof clientReference !== 'string' || !/^RML[A-Z0-9]{10,17}$/.test(clientReference)) {
            throw fail('hotelbeds_prepaid_booking_reference_invalid', 503);
        }
        const startedAt = new Date(now());
        if (Number.isNaN(startedAt.getTime())) throw fail('checkout_clock_invalid', 503);

        // The durable claim and unique reference are committed before any supplier call.
        const claimedAt = new Date(startedAt);
        let durableClaim;
        try {
            durableClaim = await attemptStore.claim({
                scope: 'prepaid',
                publicOfferId: session.publicOfferId,
                sessionId,
                attemptId,
                clientReference,
                rateKey: session.providerOfferRef,
                rateType: session.rateType,
                rateIdentity: session.bookingIdentity,
                rateTerms: session.bookingTerms,
                state: 'claimed',
                claimedAt
            });
        } catch {
            throw fail('checkout_database_unavailable', 503);
        }
        if (!durableClaim) {
            const existing = await attemptStore.getBySessionId(sessionId);
            return publicResult(sessionId, duplicateStatus(existing, session.status), true);
        }

        let claimed;
        try {
            claimed = await Model.findOneAndUpdate({
                sessionId,
                status: 'payment_verified',
                provider: 'hotelbeds',
                offerOrigin: 'live',
                paymentProvider: 'ziina',
                paymentType: 'AT_WEB',
                paymentIntentId: session.paymentIntentId
            }, { $set: {
                status: 'booking_preflight',
                bookingAttemptId: attemptId,
                bookingClientReference: clientReference,
                bookingStartedAt: startedAt
            } }, { new: true }).select([
                '+providerOfferRef', '+providerHotelCode', '+lockedNetPrice',
                '+lockedNetCurrency', '+guestDetailsEncrypted', '+bookingIdentity', '+bookingTerms'
            ].join(' ')).lean();
        } catch {
            await attemptStore.transition({
                attemptId,
                expectedState: 'claimed',
                nextState: 'preflight_failed',
                fields: { lastError: 'checkout_claim_persistence_failed' }
            }).catch(() => {});
            throw fail('checkout_database_unavailable', 503);
        }
        if (!claimed) {
            await attemptStore.transition({
                attemptId,
                expectedState: 'claimed',
                nextState: 'preflight_failed',
                fields: { lastError: 'checkout_claim_conflict' }
            }).catch(() => {});
            const current = await readSession(Model, sessionId);
            return publicResult(sessionId, current?.status || 'payment_verified', true);
        }

        try {
            const result = await coordinator.book({
                claim: async () => claimed,
                rateType: claimed.rateType,
                rateKey: claimed.providerOfferRef,
                rateIdentity: claimed.bookingIdentity,
                rateTerms: claimed.bookingTerms,
                clientReference: durableClaim.clientReference,
                createBookingRequest: async () => {
                    if (claimed.offerExpiresAt <= new Date(now())) throw fail('checkout_offer_expired', 409);
                    const guests = bookingGuestPayload(
                        decryptGuests(claimed.guestDetailsEncrypted, env), claimed.occupancy
                    );
                    return {
                        holder: guests.holder,
                        rooms: [{ rateKey: claimed.providerOfferRef, paxes: guests.paxes }]
                    };
                },
                beforeBooking: async ({ bookingRateKey }) => {
                    await attemptStore.transition({
                        attemptId,
                        expectedState: 'claimed',
                        nextState: 'booking_processing',
                        fields: { bookingStartedAt: new Date(now()), bookingRateKey }
                    });
                    const saved = await updateSession(Model, sessionId, 'booking_preflight', attemptId, {
                        status: 'booking_processing', bookingRateKey
                    });
                    if (!saved) throw fail('checkout_session_state_conflict', 503);
                },
                onPreflightFailure: async () => {
                    const at = new Date(now());
                    await attemptStore.transition({
                        attemptId,
                        expectedState: 'claimed',
                        nextState: 'preflight_failed',
                        fields: { lastError: 'booking_preflight_failed' }
                    }).catch(() => {});
                    await updateSession(Model, sessionId, 'booking_preflight', attemptId, {
                        status: 'refund_review',
                        lastError: 'booking_preflight_failed',
                        completedAt: at,
                        webhookProcessedAt: at
                    });
                },
                onOutcomeUnknown: async () => {
                    await attemptStore.transition({
                        attemptId,
                        expectedState: 'booking_processing',
                        nextState: 'outcome_unknown',
                        fields: { lastError: 'booking_outcome_unknown' }
                    }).catch(() => {});
                    return finalize(sessionId, attemptId, 'outcome_unknown', 'booking_outcome_unknown');
                },
                onResult: async ({ confirmation, bookingRateKey }) => {
                    const status = confirmation.status === 'CONFIRMED' ? 'confirmed' : 'booking_pending';
                    await attemptStore.transition({
                        attemptId,
                        expectedState: 'booking_processing',
                        nextState: status,
                        fields: {
                            bookingReference: confirmation.bookingReference,
                            bookingStatus: confirmation.status,
                            bookingRateKey
                        }
                    });
                    return finalize(sessionId, attemptId, status, null, {
                        bookingReference: confirmation.bookingReference,
                        hotelbedsBookingStatus: confirmation.status,
                        bookingRateKey
                    });
                }
            });
            return publicResult(sessionId,
                result.status === 'CONFIRMED' ? 'confirmed'
                    : ['ON_REQUEST', 'PENDING'].includes(result.status) ? 'booking_pending' : result.status);
        } catch (error) {
            let currentAttempt = null;
            try { currentAttempt = await attemptStore.getBySessionId(sessionId); } catch { /* Keep the failure quarantined. */ }
            if (currentAttempt?.state === 'outcome_unknown' || currentAttempt?.state === 'booking_processing'
                || error?.code === 'booking_outcome_unknown') {
                return publicResult(sessionId, 'outcome_unknown');
            }
            if (currentAttempt?.state === 'preflight_failed') {
                return publicResult(sessionId, 'refund_review');
            }
            throw error;
        }
    }

    return { confirmBooking };
}

module.exports = {
    PREPAID_BOOKING_GATES,
    bookingGuestPayload,
    createHotelbedsPrepaidBookingService
};