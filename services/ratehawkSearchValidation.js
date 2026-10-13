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

function dateAlias(input, aliases, field) {
    const supplied = aliases.filter(alias => Object.hasOwn(input, alias));
    if (!supplied.length) throw fail(`invalid_${field}`);

    const values = supplied.map(alias => input[alias]);
    const first = values[0];
    if (values.some(value => value !== first)) throw fail(`invalid_${field}`);
    return first;
}

function validateRatehawkSearchCriteria(input = {}, {
    now = new Date(),
    defaultResidency = process.env.RATEHAWK_RESIDENCY || 'ae'
} = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw fail('invalid_search_criteria');
    }

    const checkin = dateAlias(input, ['checkin', 'checkIn', 'check_in', 'checkInDate'], 'checkin');
    const checkout = dateAlias(input, ['checkout', 'checkOut', 'check_out', 'checkOutDate'], 'checkout');
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

function validateHotelId(value, field = 'hid') {
    const id = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
    if (!Number.isSafeInteger(id) || id < 0 || id > 9999999999) throw fail(`invalid_${field}`);
    return id;
}

function validateRegionId(value) {
    const id = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) throw fail('invalid_region_id');
    return id;
}

function validateGeoCoordinates(input = {}) {
    const latitude = typeof input.latitude === 'number' || typeof input.latitude === 'string' && input.latitude.trim()
        ? Number(input.latitude)
        : NaN;
    const longitude = typeof input.longitude === 'number' || typeof input.longitude === 'string' && input.longitude.trim()
        ? Number(input.longitude)
        : NaN;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw fail('invalid_geo_coordinates');
    }
    const radius = input.radius === undefined ? 10000 : Number(input.radius);
    if (!Number.isFinite(radius) || radius < 1 || radius > 50000) throw fail('invalid_geo_radius');
    return { latitude, longitude, radius };
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
    validateRatehawkSearchCriteria,
    validateHotelId,
    validateRegionId,
    validateGeoCoordinates
};