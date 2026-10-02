const crypto = require('node:crypto');
const hotelbedsClientModule = require('./hotelbedsClient');
const hotelbedsClient = hotelbedsClientModule;

const MAX_NAME_LENGTH = 80;
const MAX_GUESTS = 36;

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

function decimalKey(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match || text.length > 80) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function bookingGate(env) {
    if (env.HOTELBEDS_BOOKING_ENABLED !== 'true' || env.HOTELBEDS_BOOKING_APPROVED !== 'true') {
        throw fail('hotelbeds_booking_disabled', 503);
    }
    if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
        throw fail('hotelbeds_test_environment_required', 503);
    }
}

function confirmationFrom(result) {
    const booking = result?.data?.booking;
    if (!result?.ok || !booking || typeof booking !== 'object') return null;
    const reference = typeof booking.reference === 'string' ? booking.reference.trim() : '';
    const status = typeof booking.status === 'string' ? booking.status.trim().toUpperCase() : '';
    if (!reference || reference.length > 200 || !['CONFIRMED', 'ON_REQUEST', 'PENDING'].includes(status)) return null;
    return { bookingReference: reference, status };
}

function createHotelbedsBookingService({
    client = hotelbedsClient,
    env = process.env,
    now = () => new Date(),
    createAttemptId = () => crypto.randomUUID(),
    createClientReference = () => `RML${crypto.randomBytes(8).toString('hex').toUpperCase()}`
} = {}) {
    if (!client || typeof client.checkRates !== 'function' || typeof client.createBooking !== 'function'
        || typeof now !== 'function' || typeof createAttemptId !== 'function'
        || typeof createClientReference !== 'function') {
        throw new TypeError('hotelbeds_booking_dependencies_invalid');
    }

    async function confirmBooking({ publicOfferId, guestDetails, offerCacheService } = {}) {
        bookingGate(env);
        if (!offerCacheService || typeof offerCacheService.getBookingOffer !== 'function'
            || typeof offerCacheService.claimBookingOffer !== 'function'
            || typeof offerCacheService.finishBookingOffer !== 'function') {
            throw new TypeError('booking_offer_cache_invalid');
        }
        const offer = await offerCacheService.getBookingOffer(publicOfferId);
        if (!offer || offer.provider !== 'hotelbeds') throw fail('booking_offer_not_found', 404);
        if (offer.paymentType !== 'AT_HOTEL') throw fail('booking_payment_flow_required', 409);
        if (!['BOOKABLE', 'RECHECK'].includes(offer.rateType)) throw fail('booking_rate_not_bookable', 409);
        if (typeof offer.opaqueToken !== 'string' || !offer.opaqueToken.trim()) throw fail('booking_rate_key_missing', 409);
        if (decimalKey(offer.lockedNetPrice) === null || !/^[A-Z]{3}$/.test(offer.currency || '')) {
            throw fail('booking_locked_price_invalid', 409);
        }

        const bookingRequest = normalizeGuestDetails(guestDetails, offer);
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

        const claimedOffer = await offerCacheService.claimBookingOffer(publicOfferId, attemptId, clientReference);
        if (!claimedOffer) throw fail('booking_offer_not_found', 404);
        if (claimedOffer.paymentType !== 'AT_HOTEL' || claimedOffer.rateType !== offer.rateType
            || claimedOffer.opaqueToken !== offer.opaqueToken
            || claimedOffer.lockedNetPrice !== offer.lockedNetPrice
            || claimedOffer.currency !== offer.currency) {
            await offerCacheService.finishBookingOffer(publicOfferId, attemptId, { state: 'available' });
            throw fail('booking_offer_state_changed', 409);
        }

        let claimFinalized = false;
        try {
            if (offer.rateType === 'RECHECK') {
                const checked = await client.checkRates({ rooms: [{ rateKey: offer.opaqueToken }] });
                if (!checked?.ok || !checked.data || checked.data.error != null) {
                    await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                        state: 'available', bookingError: 'booking_checkrate_unavailable'
                    });
                    claimFinalized = true;
                    throw fail('booking_checkrate_unavailable', 502);
                }
                const checkedRate = hotelbedsClientModule.findRateByKey(checked.data, offer.opaqueToken);
                if (!checkedRate || checkedRate.rateType !== 'BOOKABLE') {
                    await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                        state: 'available', bookingError: 'booking_rate_not_bookable'
                    });
                    claimFinalized = true;
                    throw fail('booking_rate_not_bookable', 409);
                }
                if (decimalKey(checkedRate.net) !== decimalKey(offer.lockedNetPrice)
                    || String(checkedRate.currency || '').trim().toUpperCase() !== offer.currency) {
                    await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                        state: 'available', bookingError: 'booking_rate_changed'
                    });
                    claimFinalized = true;
                    throw fail('booking_rate_changed', 409);
                }
            }
        } catch (error) {
            if (!claimFinalized) {
                await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                    state: 'available', bookingError: 'booking_preflight_failed'
                });
            }
            throw error;
        }

        let result;
        try {
            result = await client.createBooking({
                ...bookingRequest,
                rooms: bookingRequest.rooms.map(room => ({ ...room, rateKey: offer.opaqueToken })),
                clientReference
            });
        } catch (error) {
            if (error.outcomeUnknown || error.code === 'hotelbeds_request_timeout'
                || error.code === 'hotelbeds_request_unavailable') {
                await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                    state: 'outcome_unknown', clientReference, bookingError: 'booking_outcome_unknown'
                });
                throw fail('booking_outcome_unknown', 502);
            }

            // The Hotelbeds client only throws a non-ambiguous booking error
            // before its Booking transport write (credentials/quota/config gates).
            await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                state: 'available', bookingError: 'booking_preflight_failed'
            });
            throw error;
        }

        const confirmation = confirmationFrom(result);
        if (confirmation) {
            // If persisting this transition fails, keep the atomic claim in
            // `processing`; its clientReference is already durable for manual
            // reconciliation. Never make a possibly-created booking reusable.
            await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
                state: confirmation.status === 'CONFIRMED' ? 'confirmed' : 'pending',
                clientReference,
                bookingReference: confirmation.bookingReference,
                bookingStatus: confirmation.status
            });
            return confirmation;
        }

        // A supplier HTTP response without an unambiguous confirmation may
        // still represent a created reservation; quarantine rather than retry.
        await offerCacheService.finishBookingOffer(offer.publicOfferId, attemptId, {
            state: 'outcome_unknown', clientReference, bookingError: 'booking_confirmation_ambiguous'
        });
        throw fail('booking_outcome_unknown', 502);
    }

    return { confirmBooking };
}

module.exports = { createHotelbedsBookingService };