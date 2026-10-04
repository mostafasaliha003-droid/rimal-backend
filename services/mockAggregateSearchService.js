const { normalizeHotelbedsHotel, toCustomerDisplayOffer } = require('./offerNormalizationService');
const { calculateDisplayPrice } = require('./pricingService');
const { createMultiSupplierSearchOrchestrator } = require('./multiSupplierSearchOrchestrator');
const { hotelbeds: hotelbedsOfferCache } = require('./offerCacheService');

const MOCK_HOTEL_CODE = '900001';
const MOCK_RATE_KEY = 'MOCK-NEXTGEN-RATE-900001-BOOKABLE';

function mockAvailability(criteria) {
    const adults = criteria.guests.reduce((total, room) => total + room.adults, 0);
    const children = criteria.guests.reduce((total, room) => total + room.children.length, 0);
    const rooms = criteria.guests.length;
    return {
        code: Number(MOCK_HOTEL_CODE),
        name: 'Rimal Next-Gen Mock Hotel',
        categoryCode: '4EST',
        categoryName: '4 stars',
        destinationName: criteria.destination.name || 'Mock destination',
        currency: 'USD',
        content: {
            contentStatus: 'complete',
            name: 'Rimal Next-Gen Mock Hotel',
            category: { code: '4EST', name: '4 stars' }
        },
        rooms: [{
            code: 'MOCK-DBL',
            name: 'Mock Double Room',
            rates: [{
                rateKey: MOCK_RATE_KEY,
                rateType: 'BOOKABLE',
                rateClass: 'NOR',
                paymentType: 'AT_WEB',
                boardCode: 'BB',
                boardName: 'BED AND BREAKFAST',
                net: '100.00',
                currency: 'USD',
                rooms,
                adults,
                children,
                cancellationPolicies: []
            }]
        }]
    };
}

function createMockAggregateSearchService({
    env = process.env,
    cacheOffers = hotelbedsOfferCache.storeOffers,
    now = () => new Date(),
    createHotelGroupId,
    checkoutEnabled = () => env.MULTI_SUPPLIER_MOCK_SEARCH_ENABLED === 'true'
        && env.HOTELBEDS_MOCK_DATABASE_ENABLED === 'true'
        && env.HOTELBEDS_PREPAID_CHECKOUT_ENABLED === 'true'
        && env.HOTELBEDS_PREPAID_CHECKOUT_APPROVED === 'true'
        && env.HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED === 'true'
        && env.HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED === 'true'
        && env.HOTELBEDS_ENABLED === 'true'
        && String(env.HOTELBEDS_ENV || '').trim().toLowerCase() === 'test'
        && /^[a-f\d]{64}$/i.test(env.PAYMENT_BOOKING_ENCRYPTION_KEY || '')
        && typeof env.ZIINA_MOCK_WEBHOOK_SECRET === 'string'
        && env.ZIINA_MOCK_WEBHOOK_SECRET.length >= 32
} = {}) {
    if (!env || typeof env !== 'object' || typeof cacheOffers !== 'function'
        || typeof now !== 'function' || typeof checkoutEnabled !== 'function') {
        throw new TypeError('mock_aggregate_search_dependencies_invalid');
    }

    const orchestrator = createMultiSupplierSearchOrchestrator({
        mockOnly: true,
        mockCheckoutEnabled: checkoutEnabled(),
        env,
        now,
        timeoutMs: 5000,
        cacheOffers,
        priceOffer: calculateDisplayPrice,
        displayOffer: toCustomerDisplayOffer,
        ...(createHotelGroupId ? { createHotelGroupId } : {}),
        suppliers: [{
            provider: 'hotelbeds',
            mock: true,
            async search(_request, { signal } = {}) {
                if (signal?.aborted) throw new Error('mock_search_aborted');
                return mockAvailability;
            },
            normalize(source, criteria) {
                return normalizeHotelbedsHotel(source(criteria), {
                    stay: { checkIn: criteria.checkIn, checkOut: criteria.checkOut }
                });
            }
        }]
    });

    async function performSearch(criteria) {
        if (env.MULTI_SUPPLIER_MOCK_SEARCH_ENABLED !== 'true') {
            throw Object.assign(new Error('multi_supplier_mock_search_disabled'), {
                code: 'multi_supplier_mock_search_disabled', httpStatus: 503
            });
        }
        const result = await orchestrator.performSearch(criteria);
        return { ...result, mock: true, environment: 'mock' };
    }

    return { performSearch };
}

module.exports = { MOCK_HOTEL_CODE, MOCK_RATE_KEY, mockAvailability, createMockAggregateSearchService };