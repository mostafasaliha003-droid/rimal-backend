const SUPPORTED_RESIDENCIES = new Set(require('../shared/ratehawkResidencies.json'));

const MAX_ARRIVAL_DAYS = 730;
const MAX_STAY_DAYS = 30;
const MAX_ROOMS = 9;
const MAX_ADULTS_PER_ROOM = 6;
const MAX_CHILDREN_PER_ROOM = 4;
const MAX_CHILD_AGE = 17;

function fail(code) {
    return Object.assign(new TypeError(code), {
        code,
        ratehawkError: 'invalid_params'
    });
}

function normalizeRatehawkResidency(value, fallback = 'ae') {
    const raw = value === undefined ? fallback : value;
    if (typeof raw !== 'string') throw fail('invalid_residency');

    const residency = raw.trim().toLowerCase();
    if (!SUPPORTED_RESIDENCIES.has(residency)) throw fail('invalid_residency');
    return residency;
}

function parseDate(value, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw fail(`invalid_${field}`);
    }
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        throw fail(`invalid_${field}`);
    }
    return timestamp;
}

function utcDay(value) {
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function validateRatehawkSearchCriteria(input = {}, {
    now = new Date(),
    defaultResidency = process.env.RATEHAWK_RESIDENCY || 'ae'
} = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw fail('invalid_search_criteria');
    }

    const checkin = input.checkin ?? input.checkIn ?? input.check_in ?? input.checkInDate;
    const checkout = input.checkout ?? input.checkOut ?? input.check_out ?? input.checkOutDate;
    const arrival = parseDate(checkin, 'checkin');
    const departure = parseDate(checkout, 'checkout');
    const clock = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(clock.getTime())) throw fail('invalid_search_clock');

    const today = utcDay(clock);
    if (arrival < today || arrival > today + MAX_ARRIVAL_DAYS * 86400000) {
        throw fail('checkin_out_of_range');
    }
    if (departure <= arrival || departure > arrival + MAX_STAY_DAYS * 86400000) {
        throw fail('checkout_out_of_range');
    }

    const guests = input.guests;
    if (!Array.isArray(guests) || guests.length < 1 || guests.length > MAX_ROOMS) {
        throw fail('invalid_occupancy');
    }
    const normalizedGuests = guests.map(room => {
        if (!room || !Number.isSafeInteger(room.adults) || room.adults < 1
            || room.adults > MAX_ADULTS_PER_ROOM || !Array.isArray(room.children)
            || room.children.length > MAX_CHILDREN_PER_ROOM
            || room.children.some(age => !Number.isSafeInteger(age) || age < 0 || age > MAX_CHILD_AGE)) {
            throw fail('invalid_occupancy');
        }
        return { adults: room.adults, children: [...room.children] };
    });

    return {
        ...input,
        checkin,
        checkout,
        residency: normalizeRatehawkResidency(input.residency, defaultResidency),
        guests: normalizedGuests
    };
}

module.exports = {
    MAX_ARRIVAL_DAYS,
    MAX_STAY_DAYS,
    MAX_ROOMS,
    MAX_ADULTS_PER_ROOM,
    MAX_CHILDREN_PER_ROOM,
    MAX_CHILD_AGE,
    SUPPORTED_RESIDENCIES,
    normalizeRatehawkResidency,
    validateRatehawkSearchCriteria
};