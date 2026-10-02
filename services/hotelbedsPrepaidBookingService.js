const crypto = require('node:crypto');
const CheckoutSession = require('../models/CheckoutSession');
const { decryptGuestDetails } = require('./checkoutSessionService');
const hotelbedsClientModule = require('./hotelbedsClient');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');

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
        '+bookingClientReference', '+bookingRateKey'
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
    ensureDatabaseReady: testEnsureDatabaseReady
} = {}) {
    const ensureDatabaseReady = async () => {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        await database.ensureModelConnected(Model, { env, errorCode: 'checkout_database_unavailable' });
    };
    if (!client || typeof client.checkRates !== 'function' || typeof client.createBooking !== 'function'
        || !Model || typeof Model.findOne !== 'function' || typeof Model.findOneAndUpdate !== 'function'
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
                '+lockedNetCurrency', '+guestDetailsEncrypted'
            ].join(' ')).lean();
        } catch {
            throw fail('checkout_database_unavailable', 503);
        }
        if (!claimed) {
            const current = await readSession(Model, sessionId);
            return publicResult(sessionId, current?.status || 'payment_verified', true);
        }

        let guests;
        let bookingRateKey = claimed.providerOfferRef;
        try {
            if (claimed.offerExpiresAt <= new Date(now())) throw fail('checkout_offer_expired', 409);
            guests = bookingGuestPayload(decryptGuests(claimed.guestDetailsEncrypted, env), claimed.occupancy);

            if (claimed.rateType === 'RECHECK') {
                const response = await client.checkRates({ rooms: [{ rateKey: claimed.providerOfferRef }] });
                if (!response?.ok || !response.data || response.data.error != null) {
                    throw fail('booking_checkrate_unavailable', 502);
                }
                const checked = hotelbedsClientModule.findRateByKey(response.data, claimed.providerOfferRef);
                if (!checked || checked.rateType !== 'BOOKABLE' || checked.paymentType !== 'AT_WEB'
                    || decimalKey(checked.net) !== decimalKey(claimed.lockedNetPrice)
                    || String(checked.currency || '').trim().toUpperCase() !== claimed.lockedNetCurrency
                    || typeof checked.rateKey !== 'string' || !checked.rateKey.trim()) {
                    throw fail('booking_rate_changed_after_payment', 409);
                }
                bookingRateKey = checked.rateKey;
            }
        } catch (error) {
            const at = new Date(now());
            try {
                await updateSession(Model, sessionId, 'booking_preflight', attemptId, {
                    status: 'refund_review',
                    lastError: error?.code === 'booking_rate_changed_after_payment'
                        ? 'booking_rate_changed_after_payment' : 'booking_preflight_failed',
                    completedAt: at,
                    webhookProcessedAt: at
                });
            } catch {
                // The durable preflight claim remains quarantined if Mongo fails.
            }
            return publicResult(sessionId, 'refund_review');
        }

        let preflightComplete;
        try {
            preflightComplete = await Model.findOneAndUpdate({
                sessionId,
                status: 'booking_preflight',
                bookingAttemptId: attemptId,
                bookingClientReference: clientReference
            }, { $set: {
                status: 'booking_processing',
                bookingRateKey
            } }, { new: true }).lean();
        } catch {
            throw fail('checkout_database_unavailable', 503);
        }
        if (!preflightComplete) throw fail('checkout_session_state_conflict', 503);

        const bookingRequest = {
            holder: guests.holder,
            rooms: [{ rateKey: bookingRateKey, paxes: guests.paxes }],
            clientReference
        };

        let response;
        try {
            response = await client.createBooking(bookingRequest);
        } catch (error) {
            if (error?.outcomeUnknown || error?.code === 'hotelbeds_request_timeout'
                || error?.code === 'hotelbeds_request_unavailable') {
                return finalize(sessionId, attemptId, 'outcome_unknown', 'booking_outcome_unknown');
            }
            return finalize(sessionId, attemptId, 'refund_review', 'booking_request_rejected');
        }

        const booking = response?.data?.booking;
        const bookingReference = typeof booking?.reference === 'string' ? booking.reference.trim() : '';
        const bookingStatus = typeof booking?.status === 'string' ? booking.status.trim().toUpperCase() : '';
        if (response?.ok && bookingReference && bookingReference.length <= 200
            && bookingStatus === 'CONFIRMED') {
            return finalize(sessionId, attemptId, 'confirmed', null, {
                bookingReference,
                hotelbedsBookingStatus: bookingStatus
            });
        }
        if (response?.ok && bookingReference && bookingReference.length <= 200
            && ['ON_REQUEST', 'PENDING'].includes(bookingStatus)) {
            const saved = await updateSession(Model, sessionId, 'booking_processing', attemptId, {
                status: 'booking_pending',
                bookingReference,
                hotelbedsBookingStatus: bookingStatus,
                webhookProcessedAt: new Date(now())
            });
            if (!saved) throw fail('checkout_session_state_conflict', 503);
            return publicResult(sessionId, 'booking_pending');
        }
        return finalize(sessionId, attemptId, 'outcome_unknown', 'booking_confirmation_ambiguous');
    }

    return { confirmBooking };
}

module.exports = {
    PREPAID_BOOKING_GATES,
    bookingGuestPayload,
    createHotelbedsPrepaidBookingService
};