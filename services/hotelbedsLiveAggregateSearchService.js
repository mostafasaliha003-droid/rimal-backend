const { createMultiSupplierSearchOrchestrator } = require('./multiSupplierSearchOrchestrator');
const { createHotelbedsAvailabilityService } = require('./hotelbedsAvailabilityService');
const { normalizeHotelbedsHotel, toCustomerDisplayOffer } = require('./offerNormalizationService');
const { createLivePricingService } = require('./pricingService');
const liveFxService = require('./liveFxService');
const { createOfferCacheService } = require('./offerCacheService');
const HotelbedsOfferCache = require('../models/HotelbedsOfferCache');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const mongoose = require('mongoose');
const { configuredHotelbedsPilotCodes } = require('./hotelbedsPilotList');
const { isVerifiedHotelbedsContent, projectVerifiedHotelContent } = require('./hotelbedsContentPolicy');

const LIVE_SEARCH_GATES = Object.freeze([
    'HOTELBEDS_LIVE_AGGREGATE_SEARCH_ENABLED',
    'MULTI_SUPPLIER_SEARCH_ENABLED',
    'MULTI_SUPPLIER_PRICE_POLICY_APPROVED',
    'MULTI_SUPPLIER_FX_POLICY_APPROVED',
    'MULTI_SUPPLIER_CONTENT_APPROVED',
    'HOTELBEDS_PUBLIC_SEARCH_ENABLED',
    'HOTELBEDS_PUBLIC_PRICING_APPROVED',
    'HOTELBEDS_PUBLIC_PRICE_POLICY_APPROVED',
    'HOTELBEDS_PUBLIC_CONTENT_APPROVED',
    hotelbedsMockDatabase.DATABASE_GATE
]);

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function requiredGates(env) {
    return [
        ...LIVE_SEARCH_GATES,
        'HOTELBEDS_ENABLED',
        'HOTELBEDS_AVAILABILITY_PILOT_ENABLED',
        'HOTELBEDS_PILOT_APPROVED'
    ].every(name => env[name] === 'true');
}

function usableAvailabilityResponse(result) {
    if (!result || result.pricePolicy !== 'supplier-raw-internal-only'
        || !Array.isArray(result.hotels)) throw fail('hotelbeds_internal_availability_response_invalid', 502);
    return result;
}

function hotelbedsSearchCriteriaFrom(input, env = process.env) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw fail('search_criteria_invalid', 400);
    }
    const source = input.destination;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw fail('hotelbeds_pilot_hotel_required', 400);
    }
    const explicitIds = source.providerHotelIds?.hotelbeds ?? input.providerHotelIds?.hotelbeds;
    if (!Array.isArray(explicitIds) || explicitIds.length === 0) {
        throw fail('hotelbeds_pilot_hotel_required', 400);
    }

    let pilotCodes;
    try {
        pilotCodes = configuredHotelbedsPilotCodes(env);
    } catch {
        throw fail('hotelbeds_pilot_hotel_codes_invalid', 503);
    }
    const hotelIds = [...new Set(explicitIds.map(value => {
        if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
        if (typeof value === 'string' && /^\d{1,10}$/.test(value.trim()) && Number(value) > 0) {
            return String(Number(value));
        }
        throw fail('hotelbeds_pilot_hotel_code_invalid', 400);
    }))];
    if (hotelIds.length > 5 || hotelIds.some(code => !pilotCodes.includes(code))) {
        throw fail('hotelbeds_pilot_hotel_not_allowed', 403);
    }

    // Rebuild the supplier contract from allowlisted fields only. Legacy region,
    // hid/hids, hotel_id, and RateHawk provider IDs never cross this boundary.
    return {
        checkIn: input.checkIn ?? input.checkin,
        checkOut: input.checkOut ?? input.checkout,
        guests: input.guests,
        destination: {
            type: 'hotel',
            providerHotelIds: { hotelbeds: hotelIds },
            ...(typeof source.name === 'string' && source.name.trim()
                ? { name: source.name.trim().slice(0, 200) } : {})
        }
    };
}

function createHotelbedsLiveAggregateSearchService({
    env = process.env,
    database = hotelbedsMockDatabase,
    AvailabilityService = createHotelbedsAvailabilityService,
    FxService = liveFxService,
    CacheModel = HotelbedsOfferCache,
    testOnly = false,
    now = () => new Date()
} = {}) {
    if (!env || typeof env !== 'object'
        || !database || typeof database.ensureConnected !== 'function'
        || typeof database.ensureModelConnected !== 'function'
        || typeof database.model !== 'function'
        || typeof AvailabilityService !== 'function'
        || !FxService || typeof FxService.getRate !== 'function'
        || !CacheModel || typeof CacheModel.insertMany !== 'function'
        || typeof now !== 'function'
        || testOnly && process.env.NODE_ENV === 'production') {
        throw new TypeError('hotelbeds_live_aggregate_dependencies_invalid');
    }

    const priceOffer = createLivePricingService({ fxService: FxService });
    let dependenciesPromise = null;
    let orchestrator = null;

    async function getOrchestrator() {
        if (orchestrator) return orchestrator;
        if (!dependenciesPromise) {
            dependenciesPromise = (async () => {
                const connection = await database.ensureConnected({ env });
                const BoundOfferCache = database.model('HotelbedsOfferCache', CacheModel.schema);
                await database.ensureModelConnected(BoundOfferCache, { env });
                if (BoundOfferCache.db !== connection || BoundOfferCache.db === mongoose.connection) {
                    throw fail('hotelbeds_mock_model_connection_mismatch');
                }
                const offerCacheService = createOfferCacheService({
                    Model: BoundOfferCache,
                    providerScope: testOnly ? 'test' : 'hotelbeds',
                    testOnly,
                    sandboxConnection: connection,
                    ...(testOnly ? {
                        ensureDatabaseReady: () => database.ensureModelConnected(BoundOfferCache, {
                            env,
                            expectedConnection: connection
                        })
                    } : {
                        ensureModelConnected: (Model, options) => database.ensureModelConnected(Model, options)
                    })
                });
                const availability = new AvailabilityService({ env });
                const supplier = {
                    provider: 'hotelbeds',
                    async search(criteria) {
                        const result = await availability.searchAvailability(criteria);
                        return usableAvailabilityResponse(result);
                    },
                    normalize(result, criteria) {
                        const hotels = result?.hotels || [];
                        const nowAtProjection = now();
                        const publicHotels = hotels.filter(hotel => isVerifiedHotelbedsContent(hotel, {
                            hotelCode: hotel.code,
                            language: result.contentLanguage,
                            now: nowAtProjection
                        })).map(hotel => ({
                            ...hotel,
                            name: hotel.content.name,
                            category: hotel.content.category || hotel.category,
                            customerContent: projectVerifiedHotelContent(hotel, {
                                hotelCode: hotel.code, language: result.contentLanguage, now: nowAtProjection
                            }),
                            contentHotelCode: hotel.contentHotelCode,
                            contentLanguage: hotel.contentLanguage,
                            contentSource: hotel.contentSource,
                            contentSyncedAt: hotel.contentSyncedAt,
                            sourceContent: hotel.content
                        }));
                        return publicHotels.flatMap(hotel => normalizeHotelbedsHotel(hotel, {
                            stay: { checkIn: criteria.checkIn, checkOut: criteria.checkOut }
                        })).map(offer => ({ ...offer, schemaVersion: 2 }));
                    }
                };

                return createMultiSupplierSearchOrchestrator({
                    suppliers: [supplier],
                    env,
                    now,
                    priceOffer,
                    cacheOffers: offers => offerCacheService.storeOffers(offers, { schemaVersion: 2 }),
                    displayOffer: toCustomerDisplayOffer
                });
            })().catch(error => {
                dependenciesPromise = null;
                throw error;
            });
        }
        orchestrator = await dependenciesPromise;
        return orchestrator;
    }

    async function performSearch(criteria) {
        if (!requiredGates(env)) throw fail('hotelbeds_live_aggregate_search_disabled', 503);
        const supplierCriteria = hotelbedsSearchCriteriaFrom(criteria, env);
        const liveOrchestrator = await getOrchestrator();
        const result = await liveOrchestrator.performSearch(supplierCriteria);
        if (!result || result.schemaVersion !== 2 || result.currency !== 'AED'
            || !Array.isArray(result.hotels)
            || result.hotels.some(hotel => !Array.isArray(hotel.offers))) {
            throw fail('aggregate_response_schema_invalid', 502);
        }
        return result;
    }

    return { performSearch };
}

module.exports = {
    LIVE_SEARCH_GATES,
    requiredGates,
    hotelbedsSearchCriteriaFrom,
    createHotelbedsLiveAggregateSearchService
};