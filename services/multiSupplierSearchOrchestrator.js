const crypto = require('node:crypto');
const { OFFER_TTL_MS, storeOffers, hotelbeds: hotelbedsOfferCache } = require('./offerCacheService');
const { providerIdentifier, toCustomerDisplayOffer } = require('./offerNormalizationService');
const { configuredHotelbedsPilotCodes } = require('./hotelbedsPilotList');
const { isVerifiedHotelbedsContent } = require('./hotelbedsContentPolicy');

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function safeLiveOfferForDisplay(source, projected, env) {
    if (source?.provider !== 'hotelbeds') return true;
    const availability = source.availability || {};
    const terms = source.contractTerms || {};
    if (!isVerifiedHotelbedsContent({
        code: source.providerHotelId,
        contentHotelCode: source.hotel?.contentHotelCode,
        contentLanguage: source.hotel?.contentLanguage,
        contentSource: source.hotel?.contentSource,
        contentSyncedAt: source.hotel?.contentSyncedAt,
        content: source.hotel?.sourceContent
    }, {
        hotelCode: source.providerHotelId,
        language: source.hotel?.contentLanguage,
        now: new Date()
    })) return false;
    if (env.HOTELBEDS_COMMISSION_NET_CONTRACT_APPROVED !== 'true'
        || availability.rateClass === 'NRF' || availability.packaging !== false
            || availability.sourceMarket || availability.hotelMandatory !== false
        || availability.sellingRate || availability.commission || availability.commissionVAT
        || availability.commissionPCT || source.price?.supplierAmount?.basis !== 'supplier_net'
        || source.cancellation?.refundability === 'non_refundable'
        || terms.rateCommentsResolved === false) return false;
    const schedule = source.cancellation?.schedule || [];
    if (schedule.some(item => !item?.startsAt?.timezoneKnown
        || !projected.cancellation?.schedule?.some(entry => entry.startsAt?.source === item.startsAt.source))) return false;
    if (schedule.some(item => item?.penalty?.currency !== 'AED'
        || !projected.cancellation?.schedule?.some(entry => entry.startsAt?.source === item.startsAt.source
            && entry.feeAmountDisplayable === true))) return false;
    const taxes = source.taxes || {};
    if (taxes.status !== 'provided' || taxes.allIncluded !== true
        || (taxes.items || []).some(item => item.included !== true)) return false;
    return true;
}

function createProviderScopedCacheWriter({
    ratehawkStoreOffers = storeOffers,
    hotelbedsStoreOffers = hotelbedsOfferCache.storeOffers
} = {}) {
    if (typeof ratehawkStoreOffers !== 'function' || typeof hotelbedsStoreOffers !== 'function') {
        throw new TypeError('provider_scoped_cache_dependencies_invalid');
    }
    return async function storeOffersByProvider(offers, options) {
        if (!Array.isArray(offers)) throw fail('offer_cache_offers_invalid');
        const results = new Array(offers.length);
        const groups = new Map();
        offers.forEach((offer, index) => {
            const provider = offer?.provider;
            if (!['hotelbeds', 'ratehawk'].includes(provider)) throw fail('offer_cache_provider_invalid');
            if (!groups.has(provider)) groups.set(provider, []);
            groups.get(provider).push({ offer, index });
        });
        for (const [provider, entries] of groups) {
            const store = provider === 'hotelbeds' ? hotelbedsStoreOffers : ratehawkStoreOffers;
            const stored = await store(entries.map(entry => entry.offer), options);
            if (!Array.isArray(stored) || stored.length !== entries.length
                || stored.some(item => typeof item?.publicOfferId !== 'string'
                    || !/^[a-f\d]{64}$/i.test(item.publicOfferId))) {
                throw fail('offer_cache_response_invalid', 503);
            }
            entries.forEach((entry, index) => { results[entry.index] = stored[index]; });
        }
        return results;
    };
}

const storeOffersByProvider = createProviderScopedCacheWriter();

const GLOBAL_GATES = Object.freeze([
    'MULTI_SUPPLIER_SEARCH_ENABLED',
    'MULTI_SUPPLIER_PRICE_POLICY_APPROVED',
    'MULTI_SUPPLIER_FX_POLICY_APPROVED',
    'MULTI_SUPPLIER_CONTENT_APPROVED'
]);

const SUPPLIER_GATES = Object.freeze({
    hotelbeds: Object.freeze([
        'HOTELBEDS_PUBLIC_SEARCH_ENABLED',
        'HOTELBEDS_PUBLIC_PRICING_APPROVED',
        'HOTELBEDS_PUBLIC_PRICE_POLICY_APPROVED',
        'HOTELBEDS_PUBLIC_CONTENT_APPROVED'
    ]),
    ratehawk: Object.freeze([
        'MULTI_SUPPLIER_RATEHAWK_SEARCH_APPROVED',
        'MULTI_SUPPLIER_RATEHAWK_PRICING_APPROVED',
        'MULTI_SUPPLIER_RATEHAWK_CONTENT_APPROVED'
    ])
});

function positiveInteger(value, code, { allowZero = false, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw fail(code);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > max) throw fail(code);
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
    const checkIn = validDate(input.checkIn ?? input.checkin, 'search_check_in_invalid');
    const checkOut = validDate(input.checkOut ?? input.checkout, 'search_check_out_invalid');
    if (checkOut <= checkIn) throw fail('search_stay_invalid');

    if (!Array.isArray(input.guests) || input.guests.length < 1 || input.guests.length > 9) {
        throw fail('search_occupancy_invalid');
    }
    const guests = input.guests.map(room => {
        const adults = positiveInteger(room?.adults, 'search_occupancy_invalid', { max: 36 });
        const children = room?.children ?? [];
        if (!Array.isArray(children) || children.length > 36
            || children.some(age => !Number.isSafeInteger(age) || age < 0 || age > 17)) {
            throw fail('search_occupancy_invalid');
        }
        return { adults, children: [...children] };
    });

    const sourceDestination = input.destination;
    const source = sourceDestination && typeof sourceDestination === 'object' && !Array.isArray(sourceDestination)
        ? sourceDestination : {};
    const sourceProviderHotelIds = source.providerHotelIds ?? input.providerHotelIds ?? {};
    if (!sourceProviderHotelIds || typeof sourceProviderHotelIds !== 'object'
        || Array.isArray(sourceProviderHotelIds)
        || Object.keys(sourceProviderHotelIds).some(provider => !Object.hasOwn(SUPPLIER_GATES, provider))) {
        throw fail('search_destination_invalid');
    }
    const providerHotelIds = {};
    for (const provider of Object.keys(SUPPLIER_GATES)) {
        const suppliedIds = sourceProviderHotelIds[provider] ?? [];
        if (!Array.isArray(suppliedIds)) throw fail('search_destination_invalid');
        const normalizedIds = suppliedIds.map(value => {
            const id = providerIdentifier(value);
            if (!id) throw fail('search_destination_invalid');
            return id;
        });
        if (normalizedIds.length) providerHotelIds[provider] = [...new Set(normalizedIds)];
    }

    // `hids` is RateHawk-specific. It is deliberately never copied to Hotelbeds.
    const ratehawkHids = input.hids === undefined ? [] : input.hids;
    if (!Array.isArray(ratehawkHids)) throw fail('search_destination_invalid');
    const normalizedRatehawkHids = ratehawkHids.map(value => {
        const id = providerIdentifier(value);
        if (!id) throw fail('search_destination_invalid');
        return id;
    });
    if (normalizedRatehawkHids.length) {
        providerHotelIds.ratehawk = [...new Set([
            ...(providerHotelIds.ratehawk || []), ...normalizedRatehawkHids
        ])];
    }

    const type = source.type || (Object.keys(providerHotelIds).length ? 'hotel' : 'region');
    let destination;
    if (type === 'region') {
        if (Object.keys(providerHotelIds).length) throw fail('search_destination_invalid');
        const rawRegionId = source.regionId ?? source.region_id ?? input.region_id;
        const regionId = rawRegionId === undefined || rawRegionId === null || rawRegionId === ''
            ? null : positiveInteger(rawRegionId, 'search_destination_invalid');
        const name = source.name ?? source.label ?? input.destinationName
            ?? (typeof sourceDestination === 'string' ? sourceDestination : input.query);
        destination = {
            type,
            ...(regionId === null ? {} : { regionId }),
            ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 200) } : {}),
            ...(typeof (source.destinationCode ?? input.destinationCode) === 'string'
                ? { destinationCode: (source.destinationCode ?? input.destinationCode).trim().slice(0, 32) } : {})
        };
        if (destination.regionId === undefined && !destination.name && !destination.destinationCode) {
            throw fail('search_destination_invalid');
        }
    } else if (type === 'hotel') {
        const hotelId = source.hotel_id ?? source.hotelId ?? source.hid;
        const normalizedHotelId = hotelId === undefined ? null : providerIdentifier(hotelId);
        if (hotelId !== undefined && !normalizedHotelId) throw fail('search_destination_invalid');
        if (normalizedHotelId) {
            providerHotelIds.ratehawk = [...new Set([
                ...(providerHotelIds.ratehawk || []), normalizedHotelId
            ])];
        }
        if (!Object.keys(providerHotelIds).length) throw fail('search_destination_invalid');
        destination = { type, providerHotelIds };
    } else if (type === 'geo') {
        if (Object.keys(providerHotelIds).length) throw fail('search_destination_invalid');
        const latitude = Number(source.latitude ?? input.latitude);
        const longitude = Number(source.longitude ?? input.longitude);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
            || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw fail('search_destination_invalid');
        }
        destination = { type, latitude, longitude };
    } else {
        throw fail('search_destination_invalid');
    }

    return {
        checkIn,
        checkOut,
        guests,
        rooms: guests.length,
        adults: guests.reduce((total, room) => total + room.adults, 0),
        children: guests.reduce((total, room) => total + room.children.length, 0),
        destination
    };
}

function freezeCriteria(criteria) {
    for (const room of criteria.guests) {
        Object.freeze(room.children);
        Object.freeze(room);
    }
    Object.freeze(criteria.guests);
    Object.freeze(criteria.destination.providerHotelIds || {});
    Object.freeze(criteria.destination);
    return Object.freeze(criteria);
}

function publicPaymentFlow(value) {
    const type = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (type === 'AT_WEB' || type === 'DEPOSIT') return 'PAY_NOW';
    if (type === 'AT_HOTEL' || type === 'HOTEL') return 'PAY_AT_PROPERTY';
    return 'UNKNOWN';
}

function allGatesEnabled(env, gates) {
    return gates.every(gate => env[gate] === 'true');
}

function offerHotelIdentity(offer) {
    const canonicalId = typeof offer.hotel?.canonicalId === 'string' ? offer.hotel.canonicalId.trim() : '';
    if (canonicalId) return `canonical:${canonicalId}`;
    const providerHotelId = providerIdentifier(offer.providerHotelId);
    if (!providerHotelId) throw fail('aggregate_offer_hotel_identity_invalid', 502);
    return `supplier:${offer.provider}:${providerHotelId}`;
}

function compareDecimalStrings(left, right) {
    const leftMatch = /^(\d+)(?:\.(\d+))?$/.exec(left);
    const rightMatch = /^(\d+)(?:\.(\d+))?$/.exec(right);
    if (!leftMatch || !rightMatch) throw fail('aggregate_display_price_invalid', 502);
    const scale = Math.max(leftMatch[2]?.length || 0, rightMatch[2]?.length || 0);
    const coefficient = match => BigInt(`${match[1]}${(match[2] || '').padEnd(scale, '0')}`);
    const first = coefficient(leftMatch);
    const second = coefficient(rightMatch);
    return first < second ? -1 : first > second ? 1 : 0;
}

function supplierSearchRequest(supplier, criteria) {
    if (supplier.provider === 'hotelbeds') {
        return {
            checkIn: criteria.checkIn,
            checkOut: criteria.checkOut,
            occupancies: criteria.guests.map(room => ({
                rooms: 1,
                adults: room.adults,
                children: room.children.length
            })),
            ...(criteria.destination.providerHotelIds?.hotelbeds
                ? { hotelCodes: criteria.destination.providerHotelIds.hotelbeds } : {})
        };
    }
    return {
        checkin: criteria.checkIn,
        checkout: criteria.checkOut,
        guests: criteria.guests,
        ...(criteria.destination.regionId ? { region_id: criteria.destination.regionId } : {}),
        ...(criteria.destination.destinationCode ? { destinationCode: criteria.destination.destinationCode } : {}),
        ...(criteria.destination.name ? { destination: criteria.destination.name } : {}),
        ...(criteria.destination.providerHotelIds?.ratehawk
            ? { hids: criteria.destination.providerHotelIds.ratehawk } : {}),
        ...(criteria.destination.latitude !== undefined ? {
            latitude: criteria.destination.latitude,
            longitude: criteria.destination.longitude
        } : {})
    };
}

function createMultiSupplierSearchOrchestrator({
    suppliers,
    priceOffer,
    cacheOffers = storeOffersByProvider,
    displayOffer = toCustomerDisplayOffer,
    resolveCanonicalHotelId = async () => null,
    env = process.env,
    now = () => new Date(),
    timeoutMs = Number.parseInt(process.env.MULTI_SUPPLIER_TIMEOUT_MS || '20000', 10),
    createHotelGroupId = () => crypto.randomUUID(),
    mockOnly = false,
    mockCheckoutEnabled = false
} = {}) {
    if (!Array.isArray(suppliers) || !suppliers.length
        || priceOffer !== undefined && typeof priceOffer !== 'function'
        || typeof cacheOffers !== 'function'
        || typeof displayOffer !== 'function' || typeof resolveCanonicalHotelId !== 'function'
        || typeof now !== 'function' || typeof createHotelGroupId !== 'function'
        || typeof mockOnly !== 'boolean' || typeof mockCheckoutEnabled !== 'boolean'
        || !mockOnly && mockCheckoutEnabled) {
        throw new TypeError('multi_supplier_search_dependencies_invalid');
    }
    if (mockOnly && suppliers.some(supplier => supplier?.mock !== true)) {
        throw new TypeError('multi_supplier_mock_adapter_required');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        throw new TypeError('multi_supplier_search_timeout_invalid');
    }

    const seenProviders = new Set();
    for (const supplier of suppliers) {
        if (!supplier || !Object.hasOwn(SUPPLIER_GATES, supplier.provider)
            || seenProviders.has(supplier.provider)
            || typeof supplier.search !== 'function' || typeof supplier.normalize !== 'function') {
            throw new TypeError('multi_supplier_search_adapter_invalid');
        }
        seenProviders.add(supplier.provider);
    }

    async function searchSupplier(supplier, criteria) {
        const controller = new AbortController();
        let timeout;
        const work = async () => {
            const payload = await supplier.search(supplierSearchRequest(supplier, criteria), {
                signal: controller.signal
            });
            const offers = await supplier.normalize(payload, criteria);
            if (!Array.isArray(offers)) throw fail('aggregate_supplier_response_invalid', 502);
            if (offers.some(offer => !offer || offer.provider !== supplier.provider
                || !providerIdentifier(offer.providerHotelId)
                || typeof offer.hotel?.name !== 'string' || !offer.hotel.name.trim())) {
                throw fail('aggregate_supplier_offer_invalid', 502);
            }
            return Promise.all(offers.map(async sourceOffer => {
                const canonicalId = await resolveCanonicalHotelId({
                    provider: sourceOffer.provider,
                    providerHotelId: sourceOffer.providerHotelId,
                    hotel: sourceOffer.hotel
                });
                if (canonicalId !== null && (typeof canonicalId !== 'string'
                    || !canonicalId.trim() || canonicalId.length > 200)) {
                    throw fail('aggregate_hotel_mapping_invalid', 502);
                }
                const offer = {
                    ...sourceOffer,
                    origin: supplier.mock === true ? 'mock_fixture' : 'live',
                    hotel: { ...sourceOffer.hotel, canonicalId: canonicalId?.trim() || null }
                };
                const selectedPriceOffer = supplier.priceOffer || priceOffer;
                if (typeof selectedPriceOffer !== 'function') {
                    throw fail('aggregate_supplier_pricing_unapproved', 503);
                }
                const priced = await selectedPriceOffer(offer, 'AED', env.B2C_MARKUP_PERCENT === undefined
                    ? {} : { markupPercent: env.B2C_MARKUP_PERCENT });
                return {
                    ...priced,
                    price: {
                        ...priced.price,
                        customerDisplay: priced.price?.display ?? priced.price?.customerDisplay ?? null
                    }
                };
            }));
        };

        try {
            return await Promise.race([
                Promise.resolve().then(work),
                new Promise((resolve, reject) => {
                    timeout = setTimeout(() => {
                        controller.abort();
                        reject(fail('aggregate_supplier_timeout', 502));
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    async function performSearch(input) {
        if (mockOnly && env.MULTI_SUPPLIER_MOCK_SEARCH_ENABLED !== 'true') {
            throw fail('multi_supplier_mock_search_disabled', 503);
        }
        if (!mockOnly && !allGatesEnabled(env, GLOBAL_GATES)) {
            throw Object.assign(fail('multi_supplier_search_not_approved', 503), {
                missingGates: GLOBAL_GATES.filter(gate => env[gate] !== 'true')
            });
        }
        const criteria = freezeCriteria(normalizedCriteria(input));
        const enabledSuppliers = mockOnly ? suppliers : suppliers.filter(supplier =>
            allGatesEnabled(env, SUPPLIER_GATES[supplier.provider]));
        const eligibleSuppliers = enabledSuppliers.filter(supplier => {
            if (mockOnly) return true;
            if (criteria.destination.type === 'hotel'
                && !criteria.destination.providerHotelIds?.[supplier.provider]?.length) return false;
            if (supplier.provider !== 'hotelbeds') return true;
            const hotelIds = criteria.destination.providerHotelIds?.hotelbeds;
            if (!hotelIds?.length) return false;
            try {
                const pilotCodes = configuredHotelbedsPilotCodes(env);
                return hotelIds.every(id => pilotCodes.includes(id));
            } catch {
                return false;
            }
        });
        if (!eligibleSuppliers.length) throw fail('multi_supplier_search_not_approved', 503);
        if (eligibleSuppliers.some(supplier => typeof (supplier.priceOffer || priceOffer) !== 'function')) {
            throw fail('aggregate_supplier_pricing_unapproved', 503);
        }

        const settled = await Promise.allSettled(eligibleSuppliers.map(supplier =>
            searchSupplier(supplier, criteria)));
        const successful = settled.filter(result => result.status === 'fulfilled');
        const normalizedOffers = successful.flatMap(result => result.value);
        if (successful.length === 0) {
            const reasons = settled.filter(result => result.status === 'rejected').map(result => result.reason);
            const quotaFailure = reasons.find(error => error?.httpStatus === 429
                && ['hotelbeds_rate_limited', 'hotelbeds_daily_quota_exhausted',
                    'hotelbeds_operation_daily_budget_exhausted'].includes(error.code));
            if (quotaFailure) throw quotaFailure;
            const supplierLimited = reasons.find(error => error?.httpStatus === 429
                && error.code === 'hotelbeds_supplier_rate_limited');
            if (supplierLimited) throw supplierLimited;
            const ambiguousAccess = reasons.find(error => error?.code === 'hotelbeds_supplier_access_ambiguous');
            if (ambiguousAccess) throw ambiguousAccess;
            const temporary = reasons.find(error => error?.httpStatus === 503);
            if (temporary) throw temporary;
            throw fail('multi_supplier_search_unavailable', 502);
        }

        // Mock-only search is a presentation fixture, not a supplier-backed
        // booking offer. Never cache its synthetic opaque reference into the
        // customer checkout cache or advertise an executable payment flow.
        if (mockOnly) {
            const cachedOffers = mockCheckoutEnabled
                ? await cacheOffers(normalizedOffers)
                : [];
            if (mockCheckoutEnabled && (!Array.isArray(cachedOffers)
                || cachedOffers.length !== normalizedOffers.length
                || cachedOffers.some(item => typeof item?.publicOfferId !== 'string'
                    || !/^[a-f\d]{64}$/i.test(item.publicOfferId)))) {
                throw fail('offer_cache_response_invalid', 503);
            }
            const hotels = normalizedOffers.map((offer, index) => {
                const projection = displayOffer(offer, {
                    displayPolicyApproved: true,
                    displayCurrency: 'AED'
                });
                if (!projection?.eligible || !projection.offer
                    || projection.offer.price?.currency !== 'AED'
                    || typeof projection.offer.price?.amount !== 'string'
                    || !/^\d+(?:\.\d{1,2})?$/.test(projection.offer.price.amount)) return null;
                const { canonicalId: ignoredCanonicalId, ...hotel } = projection.offer.hotel || {};
                const { canonicalId: ignoredOfferCanonicalId, ...offerHotel } = projection.offer.hotel || {};
                return {
                    hotelGroupId: createHotelGroupId(),
                    ...hotel,
                    offers: [{
                        ...projection.offer,
                        hotel: offerHotel,
                        provider: offer.provider,
                        mock: true,
                        paymentFlow: mockCheckoutEnabled
                            ? publicPaymentFlow(offer.payment?.type) : 'UNKNOWN',
                        publicOfferId: mockCheckoutEnabled ? cachedOffers[index].publicOfferId : null,
                        expiresAt: null
                    }]
                };
            }).filter(Boolean);
            return {
                success: true,
                schemaVersion: 2,
                currency: 'AED',
                mock: true,
                environment: 'mock',
                partialResults: false,
                hotels,
                hotelCount: hotels.length,
                offerCount: hotels.reduce((total, hotel) => total + hotel.offers.length, 0)
            };
        }

        const eligibleOffers = normalizedOffers.map(offer => ({
            offer,
            identity: offerHotelIdentity(offer),
            projection: displayOffer(offer, { displayPolicyApproved: true, displayCurrency: 'AED' })
        })).filter(item => item.projection?.eligible && item.projection.offer
            && item.projection.offer.price?.currency === 'AED'
            && typeof item.projection.offer.price?.amount === 'string'
            && /^\d+(?:\.\d{1,2})?$/.test(item.projection.offer.price.amount)
            && (mockOnly || safeLiveOfferForDisplay(item.offer, item.projection.offer, env)));

        const hotelGroups = new Map();
        for (const { offer, identity, projection } of eligibleOffers) {
            let group = hotelGroups.get(identity);
            if (!group) {
                const hotelGroupId = createHotelGroupId();
                if (typeof hotelGroupId !== 'string' || !hotelGroupId.trim()) {
                    throw fail('aggregate_hotel_group_identity_invalid', 503);
                }
                const { canonicalId: ignoredCanonicalId, ...publicHotel } = projection.offer.hotel || {};
                group = {
                    identity,
                    hotelGroupId,
                    hotel: publicHotel,
                    offers: []
                };
                hotelGroups.set(identity, group);
            }
            const { canonicalId: ignoredOfferCanonicalId, ...publicOfferHotel } = projection.offer.hotel || {};
            group.offers.push({
                offer,
                publicOffer: { ...projection.offer, hotel: publicOfferHotel }
            });
        }

        const storedAt = new Date(now());
        if (Number.isNaN(storedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        const expiresAt = new Date(storedAt.getTime() + OFFER_TTL_MS).toISOString();
        const cachedOffers = await cacheOffers(eligibleOffers.map(item => item.offer));
        if (!Array.isArray(cachedOffers) || cachedOffers.length !== eligibleOffers.length
            || cachedOffers.some(offer => typeof offer?.publicOfferId !== 'string'
                || !/^[a-f\d]{64}$/i.test(offer.publicOfferId))) {
            throw fail('offer_cache_response_invalid', 503);
        }

        let cachedIndex = 0;
        for (const { offer, identity } of eligibleOffers) {
            const group = hotelGroups.get(identity);
            const publicOffer = group.offers.find(item => item.offer === offer)?.publicOffer;
            if (!publicOffer) throw fail('aggregate_public_offer_projection_invalid', 503);
            group.offers[group.offers.findIndex(item => item.offer === offer)] = {
                ...publicOffer,
                provider: offer.provider,
                paymentFlow: publicPaymentFlow(offer.payment?.type),
                publicOfferId: cachedOffers[cachedIndex].publicOfferId,
                expiresAt
            };
            cachedIndex += 1;
        }

        const hotels = [...hotelGroups.values()].map(group => ({
            hotelGroupId: group.hotelGroupId,
            ...group.hotel,
            offers: group.offers.sort((left, right) => compareDecimalStrings(
                left.price.amount, right.price.amount
            ))
        }));
        return {
            success: true,
            schemaVersion: 2,
            currency: 'AED',
            partialResults: eligibleSuppliers.length !== suppliers.length
                || successful.length !== eligibleSuppliers.length
                || enabledSuppliers.length !== suppliers.length,
            hotels,
            hotelCount: hotels.length,
            offerCount: hotels.reduce((total, hotel) => total + hotel.offers.length, 0)
        };
    }

    return { performSearch };
}

module.exports = {
    GLOBAL_GATES,
    SUPPLIER_GATES,
    normalizedCriteria,
    createProviderScopedCacheWriter,
    safeLiveOfferForDisplay,
    createMultiSupplierSearchOrchestrator
};