function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

const PAGE_SIZE = 25;
const MAX_PAGES = 5;
const MAX_LOOKBACK_DAYS = 30;

function dateOnly(value) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
}

function bookingsFrom(response) {
    const bookings = response?.data?.bookings;
    if (Array.isArray(bookings)) return bookings;
    if (Array.isArray(bookings?.bookings)) return bookings.bookings;
    return null;
}

function normalizeBooking(booking) {
    const bookingReference = typeof booking?.reference === 'string' ? booking.reference.trim() : '';
    const bookingClientReference = typeof booking?.clientReference === 'string'
        ? booking.clientReference.trim() : '';
    const status = typeof booking?.status === 'string' ? booking.status.trim().toUpperCase() : '';
    if (!bookingReference || bookingReference.length > 200 || !bookingClientReference
        || bookingClientReference.length > 200
        || !['CONFIRMED', 'CANCELLED', 'ON_REQUEST', 'PENDING'].includes(status)) return null;
    return { bookingReference, bookingClientReference, status };
}

function createHotelbedsBookingReconciliationService({
    client,
    attemptStore,
    now = () => new Date()
} = {}) {
    if (!client || typeof client.getBookingList !== 'function'
        || !attemptStore || typeof attemptStore.getByClientReference !== 'function'
        || typeof now !== 'function') {
        throw new TypeError('hotelbeds_reconciliation_dependencies_invalid');
    }

    async function reconcileByClientReference(clientReference) {
        if (typeof clientReference !== 'string' || !/^RML[A-Z0-9]{10,17}$/.test(clientReference)) {
            throw fail('hotelbeds_reconciliation_reference_invalid', 400);
        }
        const attempt = await attemptStore.getByClientReference(clientReference);
        if (!attempt || attempt.clientReference !== clientReference) {
            throw fail('hotelbeds_reconciliation_attempt_not_found', 404);
        }

        const createdAt = dateOnly(attempt.claimedAt);
        const end = dateOnly(new Date(now()));
        if (!createdAt || !end || createdAt > end) {
            return { state: 'response_ambiguous', clientReference };
        }
        const earliest = new Date(`${end}T00:00:00.000Z`);
        earliest.setUTCDate(earliest.getUTCDate() - (MAX_LOOKBACK_DAYS - 1));
        if (createdAt < earliest.toISOString().slice(0, 10)) {
            return { state: 'lookback_exceeded', clientReference };
        }

        const matches = [];
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const from = page * PAGE_SIZE + 1;
            const to = from + PAGE_SIZE - 1;
            let response;
            try {
                response = await client.getBookingList({
                    start: createdAt,
                    end,
                    filterType: 'CREATION',
                    status: 'ALL',
                    from,
                    to,
                    clientReference
                });
            } catch {
                return { state: 'query_unavailable', clientReference };
            }
            if (!response?.ok || !response.data || response.data.error != null) {
                return { state: 'query_unavailable', clientReference };
            }

            const bookings = bookingsFrom(response);
            if (!bookings) return { state: 'response_ambiguous', clientReference };

            for (const booking of bookings) {
                if (booking?.clientReference !== clientReference) continue;
                const normalized = normalizeBooking(booking);
                if (!normalized) return { state: 'response_ambiguous', clientReference };
                matches.push(normalized);
            }

            if (bookings.length < PAGE_SIZE) break;
            if (page === MAX_PAGES - 1) return { state: 'response_ambiguous', clientReference };
        }

        if (matches.length === 0) return { state: 'not_found_yet', clientReference };
        if (matches.length !== 1) return { state: 'response_ambiguous', clientReference };

        // Read-only result; a separate operator/workflow must persist any resolution.
        return {
            state: 'found',
            clientReference,
            bookingReference: matches[0].bookingReference,
            bookingStatus: matches[0].status
        };
    }

    return { reconcileByClientReference };
}

module.exports = {
    PAGE_SIZE,
    MAX_PAGES,
    MAX_LOOKBACK_DAYS,
    createHotelbedsBookingReconciliationService
};