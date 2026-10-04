const HotelbedsHotelContent = require('../models/HotelbedsVerifiedHotelContent');
const hotelbedsClient = require('./hotelbedsClient');
const { operationBudgetFor } = require('./hotelbedsRateLimiter');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const HotelbedsRateComment = require('../models/HotelbedsRateComment');
const { parseRateCommentsId, resolveHotelbedsRateComments } = require('./hotelbedsRateCommentResolver');
const { isVerifiedHotelbedsContent } = require('./hotelbedsContentPolicy');

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
    RateCommentModel = HotelbedsRateComment,
    client = hotelbedsClient,
    env = process.env,
    now = () => new Date(),
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
            const status = availability?.httpStatus;
            if (status === 403) throw fail('hotelbeds_supplier_access_ambiguous', 403);
            if (status === 403) throw fail('hotelbeds_supplier_access_ambiguous', 403);
            if (status === 502 || status === 503) throw fail('hotelbeds_supplier_temporarily_unavailable', status);
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
        const contentRowsByCode = new Map();
        for (const row of contentRows || []) {
            const code = Number(row.hotelCode);
            if (!contentRowsByCode.has(code)) contentRowsByCode.set(code, []);
            contentRowsByCode.get(code).push(row);
        }
        const contentByCode = new Map([...contentRowsByCode].map(([code, rows]) => [code,
            rows.length === 1 ? {
                content: rows[0].content,
                source: rows[0].source,
                hotelCode: rows[0].hotelCode,
                language: rows[0].language,
                syncedAt: rows[0].syncedAt
            } : null
        ]));

        const commentIds = [];
        for (const hotel of hotels) {
            const code = hotelCodeOf(hotel);
            for (const room of Array.isArray(hotel.rooms) ? hotel.rooms : []) {
                for (const rate of Array.isArray(room?.rates) ? room.rates : []) {
                    if (rate?.rateCommentsId) commentIds.push({ hotelCode: code, rateCommentsId: rate.rateCommentsId });
                }
            }
        }
        const commentQuery = [...new Map(commentIds.map(item => {
            const identity = parseRateCommentsId(item.rateCommentsId);
            if (!identity) {
                return [`invalid|${item.hotelCode}|${item.rateCommentsId}`, null];
            }
            return [`${item.hotelCode}|${identity.incoming}|${identity.code}|${identity.rateCodes}`, {
                hotelCode: item.hotelCode, language: config.language,
                incoming: identity.incoming, code: identity.code, rateCodes: identity.rateCodes
            }];
        })).values()].filter(Boolean);
        const rateCommentRows = commentQuery.length ? await (async () => {
            await ensureModelConnected(RateCommentModel, {
                env,
                errorCode: 'hotelbeds_rate_comment_database_unavailable'
            });
            return queryExec(RateCommentModel.find({ $or: commentQuery, source: 'hotelbeds_content_api' }));
        })() : [];
        const checkedAt = new Date(now());
        if (!Number.isFinite(checkedAt.getTime())) throw fail('hotelbeds_availability_clock_invalid', 503);

        return {
            hotels: hotels.map(hotel => {
                const code = hotelCodeOf(hotel);
                const cached = code === null ? undefined : contentByCode.get(code);
                const content = cached?.content;
                const contentSource = cached?.source || null;
                const contentSyncedAt = cached?.syncedAt || null;
                const contentTrusted = isVerifiedHotelbedsContent({
                    code,
                    contentHotelCode: cached?.hotelCode,
                    contentLanguage: cached?.language,
                    contentSource,
                    contentSyncedAt,
                    content
                }, { hotelCode: code, language: config.language, now: checkedAt })
                    && Array.isArray(content?.images) && content.images.length > 0
                    && content.images.some(image => image?.type?.code !== 'HAB' && image?.type?.code !== 'ROOM')
                    && typeof content.description === 'string' && content.description.trim().length > 0;
                const rooms = (Array.isArray(hotel.rooms) ? hotel.rooms : []).map(room => ({
                    ...room,
                    rates: (Array.isArray(room?.rates) ? room.rates : []).map(rate => {
                        if (!rate?.rateCommentsId) {
                            return { ...rate, rateCommentsResolved: true,
                                hotelbedsIssues: contentTrusted ? (content.issues || []).map(issue => issue.description).filter(Boolean) : [],
                                hotelbedsMandatoryFacilities: contentTrusted ? (content.facilities || [])
                                    .filter(facility => facility?.voucher === true).map(facility => ({
                                        description: facility.description,
                                        fee: typeof facility.indFee === 'boolean' ? facility.indFee : null,
                                        amount: facility.amount,
                                        currency: facility.currency
                                    })) : [] };
                        }
                        const resolved = resolveHotelbedsRateComments({
                            rateCommentsId: rate.rateCommentsId, hotelCode: code, language: config.language,
                            checkIn, records: rateCommentRows || [], now: checkedAt
                        });
                        return {
                            ...rate,
                            rateCommentsResolved: resolved.resolved,
                            rateComments: resolved.comments,
                            hotelbedsIssues: resolved.issues,
                            hotelbedsMandatoryFacilities: resolved.mandatoryFacilities
                        };
                    })
                }));
                return {
                    ...hotel,
                    rooms,
                    content: contentTrusted ? content : null,
                    contentSource: contentTrusted ? contentSource : null,
                    contentHotelCode: contentTrusted ? code : null,
                    contentLanguage: contentTrusted ? config.language : null,
                    contentSyncedAt: contentTrusted ? contentSyncedAt : null,
                    contentMissing: !contentTrusted
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