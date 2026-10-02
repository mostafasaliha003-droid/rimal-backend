const HotelbedsHotelContent = require('../models/HotelbedsHotelContent');
const hotelbedsClient = require('./hotelbedsClient');
const { operationBudgetFor } = require('./hotelbedsRateLimiter');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');

const MAX_PILOT_HOTELS = 5;
const MAX_PILOT_ROOMS = 9;

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function languageCode(value) {
    const language = String(value || '').trim().toUpperCase();
    if (!/^[A-Z]{2,12}$/.test(language)) throw fail('hotelbeds_pilot_language_invalid', 503);
    return language;
}

function pilotConfigurationFrom(env = process.env) {
    if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
        throw fail('hotelbeds_test_environment_required', 503);
    }
    if (env.HOTELBEDS_AVAILABILITY_PILOT_ENABLED !== 'true'
        || env.HOTELBEDS_PILOT_APPROVED !== 'true') {
        throw fail('hotelbeds_availability_pilot_disabled', 503);
    }
    const rawCodes = String(env.HOTELBEDS_PILOT_HOTEL_CODES || '').trim();
    if (!rawCodes) throw fail('hotelbeds_pilot_hotel_codes_unconfigured', 503);
    const codes = [...new Set(rawCodes.split(',').map(value => {
        const code = Number(value.trim());
        if (!Number.isSafeInteger(code) || code < 1) throw fail('hotelbeds_pilot_hotel_codes_invalid', 503);
        return code;
    }))];
    if (codes.length > MAX_PILOT_HOTELS) throw fail('hotelbeds_pilot_hotel_limit_exceeded', 503);

    const language = languageCode(env.HOTELBEDS_PILOT_LANGUAGE);
    if (env.HOTELBEDS_PILOT_PRICE_POLICY !== 'supplier-raw-internal-only') {
        throw fail('hotelbeds_pilot_price_policy_unapproved', 503);
    }
    const operatorKey = String(env.HOTELBEDS_PILOT_OPERATOR_KEY || '');
    if (operatorKey.length < 32) throw fail('hotelbeds_pilot_operator_unconfigured', 503);
    const availabilityBudget = operationBudgetFor(env, 'availability');
    if (availabilityBudget === null) throw fail('hotelbeds_operation_daily_budget_unconfigured', 503);

    return { codes, language, operatorKey, availabilityBudget };
}

function validDate(value, name) {
    const date = String(value || '').trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw fail(`hotelbeds_${name}_invalid`);
    }
    return date;
}

function normalizeOccupancies(input = {}) {
    let occupancies = input.occupancies;
    if (occupancies === undefined) {
        occupancies = [{
            rooms: 1,
            adults: input.adults ?? 2,
            childrenAges: input.childrenAges ?? []
        }];
    }
    if (!Array.isArray(occupancies) || !occupancies.length || occupancies.length > MAX_PILOT_ROOMS) {
        throw fail('hotelbeds_occupancies_invalid');
    }

    let totalRooms = 0;
    return occupancies.map(occupancy => {
        if (!occupancy || typeof occupancy !== 'object' || Array.isArray(occupancy)) {
            throw fail('hotelbeds_occupancy_invalid');
        }
        const rooms = Number(occupancy.rooms ?? 1);
        const adults = Number(occupancy.adults);
        if (occupancy.paxes !== undefined) throw fail('hotelbeds_pilot_occupancy_shape_unsupported', 400);
        const childAges = occupancy.childrenAges;
        if (childAges !== undefined && !Array.isArray(childAges)) {
            throw fail('hotelbeds_occupancy_invalid');
        }
        const children = occupancy.children === undefined
            ? Array.isArray(childAges) ? childAges.length : 0
            : Number(occupancy.children);
        if (!Number.isSafeInteger(rooms) || rooms < 1
            || !Number.isSafeInteger(adults) || adults < 1
            || !Number.isSafeInteger(children) || children < 0) {
            throw fail('hotelbeds_occupancy_invalid');
        }
        if (children > 0) throw fail('hotelbeds_pilot_children_not_enabled', 400);
        totalRooms += rooms;
        if (totalRooms > MAX_PILOT_ROOMS) throw fail('hotelbeds_occupancy_room_limit_exceeded');
        return { rooms, adults, children };
    });
}

function queryExec(query) {
    let current = query;
    if (current && typeof current.lean === 'function') current = current.lean();
    if (current && typeof current.exec === 'function') return current.exec();
    return Promise.resolve(current);
}

function responseHotelsFrom(response) {
    const hotels = response?.data?.hotels?.hotels;
    if (!Array.isArray(hotels)) throw fail('hotelbeds_availability_response_invalid', 502);
    return hotels;
}

function hotelCodeOf(hotel) {
    const code = Number(hotel?.code ?? hotel?.hotelCode);
    return Number.isSafeInteger(code) && code > 0 ? code : null;
}

function createHotelbedsAvailabilityService({
    ContentModel = HotelbedsHotelContent,
    client = hotelbedsClient,
    env = process.env,
    database = hotelbedsMockDatabase,
    testOnly = false,
    ensureModelConnected: testEnsureModelConnected
} = {}) {
    if (testOnly && (typeof testEnsureModelConnected !== 'function' || process.env.NODE_ENV === 'production')
        || !testOnly && testEnsureModelConnected !== undefined) {
        throw new TypeError('hotelbeds_availability_test_dependency_invalid');
    }
    const ensureModelConnected = testOnly
        ? testEnsureModelConnected
        : database.ensureModelConnected.bind(database);
    async function searchAvailability(input = {}) {
        const config = pilotConfigurationFrom(env);
        if (input.language !== undefined && languageCode(input.language) !== config.language) {
            throw fail('hotelbeds_pilot_language_not_allowed', 403);
        }

        const requestedCodes = input.hotelCodes === undefined
            ? config.codes
            : [...new Set((Array.isArray(input.hotelCodes) ? input.hotelCodes : [input.hotelCodes]).map(value => {
                const code = Number(value);
                if (!Number.isSafeInteger(code) || code < 1) throw fail('hotelbeds_pilot_hotel_code_invalid');
                return code;
            }))];
        if (!requestedCodes.length || requestedCodes.length > MAX_PILOT_HOTELS
            || requestedCodes.some(code => !config.codes.includes(code))) {
            throw fail('hotelbeds_pilot_hotel_not_allowed', 403);
        }

        const checkIn = validDate(input.checkIn ?? input.checkin ?? input.checkInDate, 'check_in');
        const checkOut = validDate(input.checkOut ?? input.checkout ?? input.checkOutDate, 'check_out');
        if (checkOut <= checkIn) throw fail('hotelbeds_stay_invalid');
        const occupancies = normalizeOccupancies(input);

        await ensureModelConnected(ContentModel, {
            env,
            errorCode: 'hotelbeds_content_database_unavailable'
        });

        const availability = await client.availability({
            stay: { checkIn, checkOut },
            occupancies,
            hotels: { hotel: requestedCodes }
        });
        if (!availability?.ok || !availability.data || typeof availability.data !== 'object'
            || availability.data.error !== undefined && availability.data.error !== null) {
            throw fail('hotelbeds_availability_request_failed', 502);
        }
        const hotels = responseHotelsFrom(availability);
        if (hotels.some(hotel => {
            const code = hotelCodeOf(hotel);
            return code === null || !requestedCodes.includes(code);
        })) throw fail('hotelbeds_availability_unexpected_hotel_code', 502);
        const returnedCodes = [...new Set(hotels.map(hotelCodeOf).filter(code => code !== null))];
        if (returnedCodes.length) {
            await ensureModelConnected(ContentModel, {
                env,
                errorCode: 'hotelbeds_content_database_unavailable'
            });
        }
        const contentRows = returnedCodes.length
            ? await queryExec(ContentModel.find({ hotelCode: { $in: returnedCodes }, language: config.language }))
            : [];
        const contentByCode = new Map((contentRows || []).map(row => [Number(row.hotelCode), row.content]));

        return {
            hotels: hotels.map(hotel => {
                const code = hotelCodeOf(hotel);
                const content = code === null ? undefined : contentByCode.get(code);
                return {
                    ...hotel,
                    content: content || null,
                    contentMissing: !content
                };
            }),
            contentLanguage: config.language,
            contentCacheMissCount: hotels.filter(hotel => !contentByCode.has(hotelCodeOf(hotel))).length,
            pricePolicy: 'supplier-raw-internal-only',
            supplierRequests: 1
        };
    }

    return { searchAvailability };
}

module.exports = {
    MAX_PILOT_HOTELS,
    pilotConfigurationFrom,
    normalizeOccupancies,
    responseHotelsFrom,
    createHotelbedsAvailabilityService
};