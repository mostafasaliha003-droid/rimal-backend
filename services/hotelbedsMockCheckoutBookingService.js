function fail(code, httpStatus = 409) {
    return Object.assign(new Error(code), { code, httpStatus, outcomeUnknown: false });
}

function decimalKey(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
    if (!match) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function createHotelbedsMockCheckoutBookingService({
    env = process.env,
    recheckRate = async session => ({
        rateType: 'BOOKABLE',
        net: session.lockedNetPrice,
        currency: session.lockedNetCurrency
    }),
    createBookingReference = session => `HBMOCK-${session.sessionId}`
} = {}) {
    if (!env || typeof recheckRate !== 'function' || typeof createBookingReference !== 'function') {
        throw new TypeError('hotelbeds_mock_booking_dependencies_invalid');
    }

    async function confirmBooking({ session, guestDetails } = {}) {
        if (env.HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED !== 'true'
            || env.HOTELBEDS_ENABLED !== 'true'
            || String(env.HOTELBEDS_ENV || '').toLowerCase() !== 'test') {
            throw Object.assign(new Error('hotelbeds_mock_booking_disabled'), {
                code: 'hotelbeds_mock_booking_disabled', httpStatus: 503, outcomeUnknown: false
            });
        }
        if (!session || session.provider !== 'hotelbeds'
            || session.offerOrigin !== 'mock_fixture'
            || typeof session.providerOfferRef !== 'string' || !session.providerOfferRef
            || !Number.isSafeInteger(session.totalAmount) || session.currency !== 'AED'
            || decimalKey(session.lockedNetPrice) === null
            || !/^[A-Z]{3}$/.test(session.lockedNetCurrency || '')
            || !guestDetails || !Array.isArray(guestDetails.rooms)) {
            throw fail('hotelbeds_mock_booking_context_invalid');
        }

        if (session.rateType === 'RECHECK') {
            let currentRate;
            try {
                currentRate = await recheckRate(session);
            } catch {
                throw fail('booking_checkrate_unavailable', 502);
            }
            if (!currentRate || currentRate.rateType !== 'BOOKABLE') {
                throw fail('booking_rate_not_bookable');
            }
            if (decimalKey(currentRate.net) !== decimalKey(session.lockedNetPrice)
                || String(currentRate.currency || '').trim().toUpperCase() !== session.lockedNetCurrency) {
                throw fail('booking_rate_changed');
            }
        } else if (session.rateType !== 'BOOKABLE') {
            throw fail('booking_rate_not_bookable');
        }

        const bookingReference = createBookingReference(session);
        if (typeof bookingReference !== 'string' || !bookingReference.trim() || bookingReference.length > 200) {
            throw fail('hotelbeds_mock_booking_reference_invalid', 503);
        }
        return { bookingReference: bookingReference.trim(), status: 'CONFIRMED', mocked: true };
    }

    return { confirmBooking };
}

module.exports = { createHotelbedsMockCheckoutBookingService, decimalKey };