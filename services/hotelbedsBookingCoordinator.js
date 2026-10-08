const { checkSelectedRate, isValidRateTerms } = require('./hotelbedsRateCheckService');

function fail(code, httpStatus = 503, details = {}) {
    return Object.assign(new Error(code), { code, httpStatus, ...details });
}

function confirmationFrom(result) {
    const booking = result?.data?.booking;
    if (!result?.ok || !booking || typeof booking !== 'object') return null;
    const bookingReference = typeof booking.reference === 'string' ? booking.reference.trim() : '';
    const status = typeof booking.status === 'string' ? booking.status.trim().toUpperCase() : '';
    if (!bookingReference || bookingReference.length > 200
        || !['CONFIRMED', 'ON_REQUEST', 'PENDING'].includes(status)) return null;
    return { bookingReference, status };
}

async function bestEffort(callback, value) {
    if (typeof callback !== 'function') return;
    try { await callback(value); } catch { /* Keep the durable claim quarantined. */ }
}

function createHotelbedsBookingCoordinator({ client } = {}) {
    if (!client || typeof client.checkRates !== 'function' || typeof client.createBooking !== 'function') {
        throw new TypeError('hotelbeds_booking_coordinator_client_invalid');
    }

    async function book({
        claim,
        onClaimConflict,
        rateType,
        rateKey,
        rateIdentity,
        rateTerms,
        rateReviewValidated = false,
        clientReference,
        supplierContext,
        createBookingRequest,
        beforeBooking,
        onPreflightFailure,
        onOutcomeUnknown,
        onResult
    } = {}) {
        if (typeof claim !== 'function' || typeof createBookingRequest !== 'function'
            || typeof beforeBooking !== 'function'
            || typeof rateKey !== 'string' || !rateKey.trim()
            || !['BOOKABLE', 'RECHECK'].includes(rateType)
            || typeof clientReference !== 'string' || !/^RML[A-Z0-9]{10,17}$/.test(clientReference)
            || supplierContext?.provider !== 'hotelbeds' || supplierContext.origin !== 'live'
            || supplierContext.environment !== 'test'
            || typeof supplierContext.realm !== 'string' || !supplierContext.realm.trim()
            || typeof supplierContext.accountId !== 'string' || !/^[a-f\d]{64}$/i.test(supplierContext.accountId)
            || typeof supplierContext.ownerSubject !== 'string' || !supplierContext.ownerSubject.trim()) {
            throw fail('hotelbeds_booking_coordinator_request_invalid', 400);
        }

        function assertClaimScope(claimed) {
            if (!claimed || claimed.provider !== 'hotelbeds' || claimed.origin !== 'live'
                || claimed.environment !== supplierContext.environment
                || claimed.accountId !== supplierContext.accountId
                || claimed.realm !== supplierContext.realm
                || claimed.ownerSubject !== supplierContext.ownerSubject
                || typeof claimed.realm !== 'string' || !claimed.realm.trim()) {
                throw fail('booking_fixture_or_scope_mismatch', 409);
            }
        }

        // A caller supplies its durable, atomic claim (offer-attempt or verified
        // checkout-session CAS). Nothing supplier-facing happens before it wins.
        const claimed = await claim();
        if (!claimed) {
            if (typeof onClaimConflict === 'function') return onClaimConflict();
            throw fail('hotelbeds_booking_attempt_already_claimed', 409);
        }

        try { assertClaimScope(claimed); }
        catch (error) {
            await bestEffort(onPreflightFailure, claimed);
            throw error;
        }

        let bookingRateKey = rateKey;
        let bookingRequest;
        try {
            if (!isValidRateTerms(rateTerms) || rateTerms.rateCommentsResolved !== true) {
                throw Object.assign(new Error('booking_rate_terms_unavailable'), {
                    code: 'booking_rate_terms_unavailable'
                });
            }
            bookingRequest = await createBookingRequest(claimed);
            if (rateType === 'RECHECK' && rateReviewValidated !== true) {
                bookingRateKey = (await checkSelectedRate(client, rateKey, rateIdentity, rateTerms)).rateKey;
            }
        } catch (error) {
            await bestEffort(onPreflightFailure, claimed);
            const code = error?.code === 'booking_checkrate_rate_key_changed'
                ? 'booking_rate_key_changed'
                : error?.code === 'booking_checkrate_rate_changed'
                    ? 'booking_rate_changed'
                    : error?.code === 'booking_checkrate_terms_changed'
                        ? 'booking_rate_terms_changed'
                        : error?.code === 'booking_rate_terms_unavailable'
                            ? 'booking_rate_terms_unavailable' : 'booking_rate_unavailable';
            throw fail(code, 409);
        }

        if (!bookingRequest || typeof bookingRequest !== 'object' || Array.isArray(bookingRequest)
            || !Array.isArray(bookingRequest.rooms) || bookingRequest.rooms.length !== 1) {
            throw fail('hotelbeds_booking_request_invalid', 400);
        }

        // This durable transition must complete before the only Booking POST.
        await beforeBooking({ claimed, bookingRateKey });

        let response;
        try {
            response = await client.createBooking({
                ...bookingRequest,
                rooms: bookingRequest.rooms.map(room => ({ ...room, rateKey: bookingRateKey })),
                tolerance: '0',
                clientReference
            });
        } catch {
            await bestEffort(onOutcomeUnknown, claimed);
            throw fail('booking_outcome_unknown', 502);
        }

        const confirmation = confirmationFrom(response);
        if (!confirmation) {
            await bestEffort(onOutcomeUnknown, claimed);
            throw fail('booking_outcome_unknown', 502);
        }
        if (typeof onResult === 'function') {
            await onResult({ claimed, bookingRateKey, confirmation, response });
        }
        return { ...confirmation, bookingRateKey, response };
    }

    return { book };
}

module.exports = { createHotelbedsBookingCoordinator };