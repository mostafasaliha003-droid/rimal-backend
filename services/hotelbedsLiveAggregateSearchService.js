const { createMultiSupplierSearchOrchestrator } = require('./multiSupplierSearchOrchestrator');
const { createHotelbedsAvailabilityService } = require('./hotelbedsAvailabilityService');
const { normalizeHotelbedsHotel, toCustomerDisplayOffer } = require('./offerNormalizationService');
const { createLivePricingService } = require('./pricingService');
const liveFxService = require('./liveFxService');
const { createOfferCacheService } = require('./offerCacheService');
const HotelbedsOfferCache = require('../models/HotelbedsOfferCache');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const mongoose = require('mongoose');

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
                        const publicHotels = hotels.filter(hotel => {
                            const content = hotel?.content;
                            const name = typeof content?.name === 'string' ? content.name.trim() : '';
                            const hasMockImage = Array.isArray(content?.images)
                                && content.images.some(image => /^mock\//i.test(String(image?.path || '')));
                            return content?.contentStatus === 'complete' && name
                                && !/^mock\b/i.test(name) && !hasMockImage;
                        }).map(hotel => ({
                            ...hotel,
                            name: hotel.content.name,
                            category: hotel.content.category || hotel.category
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
        const liveOrchestrator = await getOrchestrator();
        const result = await liveOrchestrator.performSearch(criteria);
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
    createHotelbedsLiveAggregateSearchService
};