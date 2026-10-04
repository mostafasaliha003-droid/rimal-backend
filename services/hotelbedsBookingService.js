const crypto = require('node:crypto');
const hotelbedsClient = require('./hotelbedsClient');
const bookingAttemptStoreModule = require('./hotelbedsBookingAttemptStore');
const rateCheck = require('./hotelbedsRateCheckService');
const { createHotelbedsBookingCoordinator } = require('./hotelbedsBookingCoordinator');
const { hotelbedsScopeFrom, ownerSubjectFrom } = require('./hotelbedsScope');
const { decryptBookingRecordPayload, encryptBookingRecordPayload } = require('./bookingRecordPersistence');
const { normalizeTermsConsent } = require('./offerTermsVersion');

const MAX_NAME_LENGTH = 80;
const MAX_GUESTS = 36;

function decimalKey(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match || text.length > 80) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function nonEmptyText(value, code, maxLength = MAX_NAME_LENGTH) {
    if (typeof value !== 'string') throw fail(code, 400);
    const text = value.trim();
    if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) throw fail(code, 400);
    return text;
}

function normalizeGuestDetails(value, offer) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('booking_guest_details_invalid', 400);
    const firstName = nonEmptyText(value.firstName, 'booking_guest_name_invalid');
    const lastName = nonEmptyText(value.lastName, 'booking_guest_name_invalid');
    if (typeof value.email !== 'string' || value.email.length > 254
        || !/^\S+@\S+\.\S+$/.test(value.email.trim())) {
        throw fail('booking_guest_email_invalid', 400);
    }

    const phone = typeof value.phone === 'string' ? value.phone.trim() : '';
    if (phone.length > 40 || /[\u0000-\u001f\u007f]/.test(phone)) throw fail('booking_guest_phone_invalid', 400);

    const guests = value.rooms?.[0]?.guests;
    const expectedAdults = offer.adultCount;
    if (offer.roomCount !== 1 || offer.childCount !== 0 || !Number.isSafeInteger(expectedAdults)
        || expectedAdults < 1 || expectedAdults > MAX_GUESTS
        || !Array.isArray(value.rooms) || value.rooms.length !== 1
        || !Array.isArray(guests) || guests.length !== expectedAdults
        || guests.some(guest => guest?.is_child === true)) {
        throw fail('hotelbeds_booking_occupancy_unsupported', 400);
    }

    const paxes = guests.map((guest, index) => {
        const paxFirstName = index === 0 ? firstName : nonEmptyText(guest?.firstName, 'booking_guest_name_invalid');
        const paxLastName = index === 0 ? lastName : nonEmptyText(guest?.lastName, 'booking_guest_name_invalid');
        return { roomId: 1, type: 'AD', name: paxFirstName, surname: paxLastName };
    });

    return {
        holder: { name: firstName, surname: lastName },
        rooms: [{ paxes }]
    };
}

function bookingGate(env) {
    if (env.HOTELBEDS_BOOKING_ENABLED !== 'true' || env.HOTELBEDS_BOOKING_APPROVED !== 'true') {
        throw fail('hotelbeds_booking_disabled', 503);
    }
    if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
        throw fail('hotelbeds_test_environment_required', 503);
    }
}

function createHotelbedsBookingService({
    client = hotelbedsClient,
    attemptStore = bookingAttemptStoreModule.createHotelbedsBookingAttemptStore(),
    coordinator = createHotelbedsBookingCoordinator({ client }),
    env = process.env,
    now = () => new Date(),
    createAttemptId = () => crypto.randomUUID(),
    createClientReference = () => `RML${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    persistBooking
} = {}) {
    if (!client || typeof client.checkRates !== 'function' || typeof client.createBooking !== 'function'
        || !attemptStore || typeof attemptStore.claim !== 'function'
        || typeof attemptStore.getByOfferId !== 'function' || typeof attemptStore.transition !== 'function'
        || !coordinator || typeof coordinator.book !== 'function'
        || typeof now !== 'function' || typeof createAttemptId !== 'function'
        || typeof createClientReference !== 'function'
        || (!attemptStore.testOnly && typeof persistBooking !== 'function')
        || (persistBooking !== undefined && typeof persistBooking !== 'function')) {
        throw new TypeError('hotelbeds_booking_dependencies_invalid');
    }

    async function persistConfirmedAttempt(attempt, ownerSubject) {
        if (!persistBooking || !attempt?.bookingReference
            || !['CONFIRMED', 'ON_REQUEST', 'PENDING'].includes(attempt.bookingStatus)) return false;
        const payload = decryptBookingRecordPayload(attempt.bookingRecordPayloadEncrypted, env);
        if (!payload?.guestDetails || !payload?.offer || typeof payload.paymentMethod !== 'string') {
            throw fail('booking_record_payload_unavailable', 503);
        }
        await persistBooking({
            bookingReference: attempt.bookingReference,
            ownerSubject,
            guestDetails: payload.guestDetails,
            offer: payload.offer,
            bookingStatus: attempt.bookingStatus,
            paymentMethod: payload.paymentMethod,
            clientReference: attempt.clientReference
        });
        const nextState = attempt.bookingStatus === 'CONFIRMED' ? 'confirmed' : 'booking_pending';
        if (attempt.state !== nextState) {
            await attemptStore.transition({
                attemptId: attempt.attemptId,
                ownerSubject,
                expectedState: attempt.state,
                nextState,
                fields: { lastError: null }
            });
        }
        return true;
    }

    async function resumePersistedAttempt(attempt, ownerSubject) {
        if (!attempt?.bookingReference || !persistBooking
            || !['booking_processing', 'outcome_unknown'].includes(attempt.state)) return false;
        await persistConfirmedAttempt(attempt, ownerSubject);
        return true;
    }

    async function confirmBooking({ publicOfferId, guestDetails, offerCacheService, ownerSubject,
        termsAccepted, acceptedTermsVersion } = {}) {
        bookingGate(env);
        if (typeof publicOfferId !== 'string' || !/^[a-f\d]{64}$/i.test(publicOfferId)) {
            throw fail('booking_offer_not_found', 404);
        }
        const testOnly = attemptStore.testOnly === true;
        const bookingOwnerSubject = ownerSubjectFrom(ownerSubject, { testOnly });
        const supplierScope = hotelbedsScopeFrom(env, { testOnly });
        if (!offerCacheService || typeof offerCacheService.getBookingOffer !== 'function') {
            throw new TypeError('booking_offer_cache_invalid');
        }

        // The durable attempt outlives the TTL offer cache. Resolve it first so
        // retries never need the offer document and can never recreate a POST.
        const existingAttempt = await attemptStore.getByOfferId(publicOfferId, bookingOwnerSubject, { allowAnyOwner: true });
        if (existingAttempt) {
            try {
                normalizeTermsConsent({
                    termsAccepted,
                    acceptedTermsVersion,
                    expectedTermsVersion: existingAttempt.acceptedTermsVersion,
                    now
                });
            } catch {
                throw fail('booking_terms_acceptance_required', 409);
            }
            if (existingAttempt.ownerSubject !== bookingOwnerSubject) {
                throw fail('booking_attempt_already_claimed', 409);
            }
            if (await resumePersistedAttempt(existingAttempt, bookingOwnerSubject)) {
                return {
                    bookingReference: existingAttempt.bookingReference,
                    status: existingAttempt.bookingStatus
                };
            }
            if (existingAttempt.state === 'confirmed' && existingAttempt.bookingReference) {
                return { bookingReference: existingAttempt.bookingReference, status: 'CONFIRMED' };
            }
            if (existingAttempt.state === 'booking_pending' && existingAttempt.bookingReference
                && ['ON_REQUEST', 'PENDING'].includes(existingAttempt.bookingStatus)) {
                return {
                    bookingReference: existingAttempt.bookingReference,
                    status: existingAttempt.bookingStatus
                };
            }
            throw fail(existingAttempt.state === 'outcome_unknown'
                || existingAttempt.state === 'booking_processing'
                || existingAttempt.state === 'claimed'
                ? 'booking_outcome_unknown' : 'booking_attempt_already_claimed',
            existingAttempt.state === 'outcome_unknown'
                || existingAttempt.state === 'booking_processing'
                || existingAttempt.state === 'claimed' ? 502 : 409);
        }

        const offer = await offerCacheService.getBookingOffer(publicOfferId);
        if (!offer || offer.provider !== 'hotelbeds') throw fail('booking_offer_not_found', 404);
        if (offer.origin !== 'live') throw fail('booking_fixture_or_untrusted_provenance_forbidden', 409);
        let termsConsent;
        try {
            termsConsent = normalizeTermsConsent({
                termsAccepted, acceptedTermsVersion, expectedTermsVersion: offer.termsVersion, now
            });
        }
        catch { throw fail('booking_terms_acceptance_required', 409); }
        if (offer.paymentType !== 'AT_HOTEL') throw fail('booking_payment_flow_required', 409);
        if (!['BOOKABLE', 'RECHECK'].includes(offer.rateType)) throw fail('booking_rate_not_bookable', 409);
        if (typeof offer.opaqueToken !== 'string' || !offer.opaqueToken.trim()) throw fail('booking_rate_key_missing', 409);
        if (!rateCheck.isValidRateIdentity(offer.bookingIdentity)
            || !rateCheck.isValidRateTerms(offer.bookingTerms)
            || offer.bookingIdentity.net !== decimalKey(offer.lockedNetPrice)
            || offer.bookingIdentity.currency !== offer.currency
            || offer.bookingIdentity.paymentType !== offer.paymentType) {
            throw fail('booking_locked_price_invalid', 409);
        }

        const bookingRequest = normalizeGuestDetails(guestDetails, offer);
        const bookingContact = {
            firstName: guestDetails.firstName.trim(),
            lastName: guestDetails.lastName.trim(),
            email: guestDetails.email.trim().toLowerCase(),
            phone: typeof guestDetails.phone === 'string' ? guestDetails.phone.trim() : ''
        };
        const attemptId = createAttemptId();
        if (typeof attemptId !== 'string' || !/^[a-f\d-]{36}$/i.test(attemptId)) {
            throw fail('booking_attempt_id_invalid', 503);
        }
        const clientReference = createClientReference();
        if (typeof clientReference !== 'string' || !/^RML[A-Z0-9]{10,17}$/.test(clientReference)) {
            throw fail('booking_client_reference_invalid', 503);
        }
        const claimedAt = new Date(now());
        if (Number.isNaN(claimedAt.getTime()) || !(offer.expiresAt instanceof Date)
            || offer.expiresAt <= claimedAt) throw fail('offer_cache_booking_expired', 404);

        const bookingRecordPayload = {
            guestDetails: bookingContact,
            paymentMethod: 'hotel',
            offer: {
                providerHotelCode: offer.providerHotelCode,
                lockedSellAmount: offer.lockedSellAmount || null,
                lockedSellCurrency: offer.lockedSellCurrency || null,
                bookingMetadata: offer.bookingMetadata || null
            }
        };
        const bookingRecordPayloadEncrypted = encryptBookingRecordPayload(bookingRecordPayload, env);

        const durableClaim = await attemptStore.claim({
            scope: 'direct',
            provider: 'hotelbeds',
            origin: offer.origin,
            publicOfferId,
            ...supplierScope,
            ownerSubject: bookingOwnerSubject,
            attemptId,
            clientReference,
            rateKey: offer.opaqueToken,
            rateType: offer.rateType,
            rateIdentity: offer.bookingIdentity,
            rateTerms: offer.bookingTerms,
            ...termsConsent,
            bookingRecordPayloadEncrypted,
            state: 'claimed',
            claimedAt
        });
        if (!durableClaim) {
            const existing = await attemptStore.getByOfferId(publicOfferId, bookingOwnerSubject, { allowAnyOwner: true });
            if (!existing) throw fail('booking_attempt_state_unknown', 503);
            if (existing.ownerSubject !== bookingOwnerSubject) throw fail('booking_attempt_already_claimed', 409);
            if (await resumePersistedAttempt(existing, bookingOwnerSubject)) {
                return { bookingReference: existing.bookingReference, status: existing.bookingStatus };
            }
            if (existing.state === 'confirmed' && existing.bookingReference) {
                return { bookingReference: existing.bookingReference, status: 'CONFIRMED' };
            }
            if (existing.state === 'booking_pending' && existing.bookingReference
                && ['ON_REQUEST', 'PENDING'].includes(existing.bookingStatus)) {
                return { bookingReference: existing.bookingReference, status: existing.bookingStatus };
            }
            throw fail(existing.state === 'outcome_unknown'
                || existing.state === 'booking_processing' || existing.state === 'claimed'
                ? 'booking_outcome_unknown' : 'booking_attempt_already_claimed',
            existing.state === 'outcome_unknown'
                || existing.state === 'booking_processing' || existing.state === 'claimed' ? 502 : 409);
        }

        const result = await coordinator.book({
            claim: async () => durableClaim,
            rateType: offer.rateType,
            rateKey: offer.opaqueToken,
            rateIdentity: offer.bookingIdentity,
            rateTerms: offer.bookingTerms,
            clientReference,
            supplierContext: {
                provider: offer.provider,
                origin: offer.origin,
                realm: supplierScope.realm,
                environment: supplierScope.environment,
                accountId: supplierScope.accountId,
                ownerSubject: bookingOwnerSubject
            },
            createBookingRequest: async () => bookingRequest,
            beforeBooking: async ({ bookingRateKey }) => attemptStore.transition({
                attemptId,
                ownerSubject: bookingOwnerSubject,
                expectedState: 'claimed',
                nextState: 'booking_processing',
                fields: { bookingStartedAt: new Date(now()), bookingRateKey }
            }),
            onPreflightFailure: async () => attemptStore.transition({
                attemptId,
                ownerSubject: bookingOwnerSubject,
                expectedState: 'claimed',
                nextState: 'preflight_failed',
                fields: { lastError: 'booking_preflight_failed' }
            }),
            onOutcomeUnknown: async () => attemptStore.transition({
                attemptId,
                ownerSubject: bookingOwnerSubject,
                expectedState: 'booking_processing',
                nextState: 'outcome_unknown',
                fields: { lastError: 'booking_outcome_unknown' }
            }),
            onResult: async ({ bookingRateKey, confirmation }) => {
                const persistedAttempt = await attemptStore.transition({
                    attemptId,
                    ownerSubject: bookingOwnerSubject,
                    expectedState: 'booking_processing',
                    nextState: 'outcome_unknown',
                    fields: {
                        bookingRateKey,
                        bookingReference: confirmation.bookingReference,
                        bookingStatus: confirmation.status,
                        lastError: persistBooking ? 'booking_record_persistence_pending' : null
                    }
                });
                if (persistBooking) {
                    try {
                        await persistConfirmedAttempt(persistedAttempt, bookingOwnerSubject);
                    } catch {
                        throw fail('booking_record_persistence_unknown', 503);
                    }
                    return attemptStore.getByOfferId(publicOfferId, bookingOwnerSubject);
                }
                return attemptStore.transition({
                    attemptId,
                    ownerSubject: bookingOwnerSubject,
                    expectedState: 'outcome_unknown',
                    nextState: confirmation.status === 'CONFIRMED' ? 'confirmed' : 'booking_pending',
                    fields: { lastError: null }
                });
            }
        });
        return { bookingReference: result.bookingReference, status: result.status };
    }

    return { confirmBooking };
}

module.exports = { createHotelbedsBookingService };