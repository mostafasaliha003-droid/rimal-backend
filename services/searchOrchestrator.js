const { createHotelbedsAvailabilityService } = require('./hotelbedsAvailabilityService');
const { normalizeHotelbedsHotel, toCustomerDisplayOffer } = require('./offerNormalizationService');
const { createLivePricingService } = require('./pricingService');
const liveFxService = require('./liveFxService');
const { hotelbeds: hotelbedsOfferCache } = require('./offerCacheService');

const defaultLivePricing = createLivePricingService({ fxService: liveFxService });

const REQUIRED_PUBLIC_GATES = Object.freeze([
    'HOTELBEDS_PUBLIC_SEARCH_ENABLED',
    'HOTELBEDS_PUBLIC_PRICING_APPROVED',
    'HOTELBEDS_PUBLIC_PRICE_POLICY_APPROVED',
    'HOTELBEDS_PUBLIC_CONTENT_APPROVED'
]);

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function positiveInteger(value, code, { allowZero = false, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw fail(code);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > max) {
        throw fail(code);
    }
    return number;
}

function validDate(value, code) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(code);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fail(code);
    return value;
}

function normalizedCriteria(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('search_criteria_invalid');
    const checkIn = validDate(input.checkIn, 'search_check_in_invalid');
    const checkOut = validDate(input.checkOut, 'search_check_out_invalid');
    if (checkOut <= checkIn) throw fail('search_stay_invalid');
    const rooms = positiveInteger(input.rooms ?? 1, 'search_rooms_invalid', { max: 9 });
    const adults = positiveInteger(input.adults ?? 2, 'search_adults_invalid', { max: 36 });
    const children = positiveInteger(input.children ?? 0, 'search_children_invalid', {
        allowZero: true,
        max: 36
    });
    if (children > 0) throw fail('hotelbeds_pilot_children_not_enabled', 400);
    if (adults < rooms) throw fail('search_adults_below_room_count');
    return { checkIn, checkOut, rooms, adults, children };
}

function assertPublicPricingGates(env) {
    const missing = REQUIRED_PUBLIC_GATES.filter(key => env[key] !== 'true');
    if (missing.length) {
        throw Object.assign(fail('hotelbeds_public_search_not_approved', 503), { missingGates: missing });
    }
}

function createSearchOrchestrator({
    availabilityService = createHotelbedsAvailabilityService(),
    normalizeHotel = normalizeHotelbedsHotel,
    priceOffer = defaultLivePricing,
    cacheOffers = hotelbedsOfferCache.storeOffers,
    displayOffer = toCustomerDisplayOffer,
    env = process.env
} = {}) {
    if (!availabilityService || typeof availabilityService.searchAvailability !== 'function'
        || typeof normalizeHotel !== 'function'
        || typeof cacheOffers !== 'function' || typeof displayOffer !== 'function') {
        throw new TypeError('search_orchestrator_dependencies_invalid');
    }

    async function performSearch(input) {
        assertPublicPricingGates(env);
        const criteria = normalizedCriteria(input);
        // 1. Fetch pilot availability. The existing service enforces the approved
        //    pilot list, the internal-only rate policy, and the shared quota gate.
        const availability = await availabilityService.searchAvailability({
            checkIn: criteria.checkIn,
            checkOut: criteria.checkOut,
            occupancies: [{
                rooms: criteria.rooms,
                adults: criteria.adults,
                children: criteria.children
            }]
        });
        if (!availability || availability.pricePolicy !== 'supplier-raw-internal-only'
            || !Array.isArray(availability.hotels)) {
            throw fail('hotelbeds_internal_availability_response_invalid', 502);
        }

        // 2. Normalize each supplier hotel/rate; only supplier offers are passed
        //    downstream, never the original hotel response object.
        const publicHotels = availability.hotels
            .filter(hotel => {
                const content = hotel?.content;
                const contentName = typeof content?.name === 'string' ? content.name.trim() : '';
                const hasMockImage = Array.isArray(content?.images)
                    && content.images.some(image => /^mock\//i.test(String(image?.path || '')));
                return content?.contentStatus === 'complete'
                    && contentName.length > 0
                    && !/^mock\b/i.test(contentName)
                    && !hasMockImage;
            })
            .map(hotel => ({
                ...hotel,
                name: hotel.content.name,
                category: hotel.content.category || hotel.category
            }));

        const normalizedOffers = publicHotels.flatMap(hotel => normalizeHotel(hotel, {
            stay: { checkIn: criteria.checkIn, checkOut: criteria.checkOut }
        }));

        // 3. Convert through live, dated FX quotes and exact BigInt pricing.
        //    Supplier net data remains private for cache locking.
        const pricedOffers = await Promise.all(normalizedOffers.map(async offer => {
            const priced = await priceOffer({ ...offer, origin: 'live' }, 'AED', env.B2C_MARKUP_PERCENT === undefined
                ? {} : { markupPercent: env.B2C_MARKUP_PERCENT });
            return {
                ...priced,
                price: {
                    ...priced.price,
                    customerDisplay: priced.price?.display ?? null
                }
            };
        }));

        // 4. Cache provider tokens before projecting any client-visible data.
        const cachedOffers = await cacheOffers(pricedOffers);
        if (!Array.isArray(cachedOffers) || cachedOffers.length !== pricedOffers.length
            || cachedOffers.some(offer => typeof offer?.publicOfferId !== 'string'
                || !/^[a-f\d]{64}$/i.test(offer.publicOfferId))) {
            throw fail('offer_cache_response_invalid', 503);
        }

        // 5. Run the final customer eligibility projection. The projection omits
        //    supplier net/currency, provider IDs, and opaque booking references.
        const offers = pricedOffers.map((offer, index) => {
            const result = displayOffer(offer, {
                displayPolicyApproved: true,
                displayCurrency: 'AED'
            });
            if (!result?.eligible || !result.offer) return null;
            return { ...result.offer, publicOfferId: cachedOffers[index].publicOfferId };
        }).filter(Boolean);

        return {
            success: true,
            currency: 'AED',
            offers,
            offerCount: offers.length
        };
    }

    return { performSearch };
}

const defaultOrchestrator = createSearchOrchestrator();

function performSearch(input) {
    return defaultOrchestrator.performSearch(input);
}

module.exports = {
    REQUIRED_PUBLIC_GATES,
    normalizedCriteria,
    assertPublicPricingGates,
    createSearchOrchestrator,
    performSearch
};