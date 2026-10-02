const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    GLOBAL_GATES,
    SUPPLIER_GATES,
    createMultiSupplierSearchOrchestrator
} = require('../services/multiSupplierSearchOrchestrator');

const CRITERIA = Object.freeze({
    checkin: '2026-11-10',
    checkout: '2026-11-12',
    guests: [{ adults: 2, children: [] }],
    destination: { type: 'region', region_id: 42, label: 'Fixture region' }
});

const HOTEL_CRITERIA = Object.freeze({
    ...CRITERIA,
    destination: {
        type: 'hotel',
        providerHotelIds: { hotelbeds: ['74001'], ratehawk: ['rh-991', 'rh-992'] },
        label: 'Fixture hotel'
    }
});

function approvedEnv(providers = ['hotelbeds', 'ratehawk']) {
    return {
        ...Object.fromEntries([
            ...GLOBAL_GATES,
            ...providers.flatMap(provider => SUPPLIER_GATES[provider])
        ].map(name => [name, 'true'])),
        HOTELBEDS_COMMISSION_NET_CONTRACT_APPROVED: 'true',
        HOTELBEDS_PILOT_HOTEL_CODES: '74001'
    };
}

function offer(provider, providerHotelId, {
    canonicalId = null,
    amount = '100.00',
    currency = 'EUR',
    name = `Fixture hotel ${providerHotelId}`
} = {}) {
    return {
        schemaVersion: 1,
        origin: 'live',
        provider,
        providerHotelId,
        hotel: {
            canonicalId,
            name,
            category: { code: '4EST', name: '4 stars' },
            ...(provider === 'hotelbeds' ? {
                contentSource: 'hotelbeds_content_api',
                contentHotelCode: providerHotelId,
                contentLanguage: 'ENG',
                contentSyncedAt: '2026-10-01T12:00:00.000Z',
                sourceContent: {
                    contentStatus: 'complete',
                    name,
                    category: { code: '4EST', name: '4 stars' }
                }
            } : {})
        },
        room: { name: 'Double room' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        availability: {
            rateType: 'BOOKABLE',
            ...(provider === 'hotelbeds' ? { rateClass: 'NOR', packaging: false, hotelMandatory: false } : {})
        },
        payment: { type: provider === 'hotelbeds' ? 'AT_HOTEL' : 'deposit' },
        price: {
            supplierAmount: { amount, currency, basis: provider === 'hotelbeds' ? 'supplier_net' : 'fixture' },
            display: { amount, currency: 'AED' }
        },
        ...(provider === 'hotelbeds' ? { taxes: { status: 'provided', allIncluded: true, items: [] } } : {}),
        booking: { opaqueToken: `private-${provider}-${providerHotelId}` }
    };
}

function supplier(provider, { search, normalize } = {}) {
    return {
        provider,
        search: search || (async () => ({})),
        normalize: normalize || (() => [])
    };
}

function cacheOffers() {
    const calls = [];
    return {
        calls,
        async cache(offers) {
            calls.push(offers);
            return offers.map((_, index) => ({ publicOfferId: String(index + 1).padStart(64, '0') }));
        }
    };
}

function priceFixture(offer) {
    return {
        ...offer,
        price: { ...offer.price, display: { amount: offer.price.supplierAmount.amount, currency: 'AED' } }
    };
}

test('aggregate search starts both suppliers concurrently and groups only explicitly mapped hotel identities', async () => {
    const env = approvedEnv();
    const cache = cacheOffers();
    let active = 0;
    let maxActive = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const makeSupplier = (provider, result) => supplier(provider, {
        search: async criteria => {
            if (provider === 'hotelbeds') {
                assert.deepEqual(criteria.occupancies, [{ rooms: 1, adults: 2, children: 0 }]);
                assert.deepEqual(criteria.hotelCodes, ['74001']);
            } else {
                assert.deepEqual(criteria.guests, [{ adults: 2, children: [] }]);
                assert.deepEqual(criteria.hids, ['rh-991', 'rh-992']);
            }
            active += 1;
            maxActive = Math.max(maxActive, active);
            if (active === 2) release();
            await barrier;
            active -= 1;
            return result;
        },
        normalize: payload => payload
    });
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [
            makeSupplier('hotelbeds', [offer('hotelbeds', '74001', { amount: '120.00' })]),
            makeSupplier('ratehawk', [
                offer('ratehawk', 'rh-991', { amount: '90.00' }),
                offer('ratehawk', 'rh-992', { amount: '80.00' })
            ])
        ],
        env,
        priceOffer: async item => priceFixture(item),
        cacheOffers: cache.cache,
        resolveCanonicalHotelId: async ({ provider, providerHotelId }) =>
            provider === 'hotelbeds' || providerHotelId === 'rh-991' ? 'mapped-hotel-1' : null,
        createHotelGroupId: (() => { let id = 0; return () => `hotel-group-${++id}`; })()
    });

    const result = await orchestrator.performSearch(HOTEL_CRITERIA);

    assert.equal(maxActive, 2);
    assert.equal(result.success, true);
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.partialResults, false);
    assert.equal(result.currency, 'AED');
    assert.equal(result.hotelCount, 2);
    assert.equal(result.offerCount, 3);
    const mappedGroups = new Map();
    for (const hotel of result.hotels) {
        const group = mappedGroups.get(hotel.hotelGroupId) || [];
        group.push(...hotel.offers);
        mappedGroups.set(hotel.hotelGroupId, group);
    }
    const mergedOffers = [...mappedGroups.values()].find(group => group.length === 2);
    assert.ok(mergedOffers);
    assert.deepEqual(mergedOffers.map(item => item.price.amount), ['90.00', '120.00']);
    assert.deepEqual(mergedOffers.map(item => item.paymentFlow), ['PAY_NOW', 'PAY_AT_PROPERTY']);
    assert.ok(result.hotels.every(hotel => !Object.hasOwn(hotel, 'canonicalId')));
    assert.deepEqual(cache.calls[0].map(item => item.provider), ['hotelbeds', 'ratehawk', 'ratehawk']);

    const serialized = JSON.stringify(result);
    for (const privateValue of ['supplierAmount', 'opaqueToken', 'private-hotelbeds-74001', 'private-ratehawk-rh-991', 'providerHotelId', 'lockedNetPrice']) {
        assert.equal(serialized.includes(privateValue), false, `public response leaked ${privateValue}`);
    }
    assert.ok(result.hotels.flatMap(hotel => hotel.offers)
        .every(item => item.price.currency === 'AED' && /^[a-f\d]{64}$/i.test(item.publicOfferId)));
});

test('aggregate gates fail closed before any supplier or cache call', async () => {
    let supplierCalls = 0;
    let cacheCalls = 0;
    const env = approvedEnv();
    delete env.MULTI_SUPPLIER_FX_POLICY_APPROVED;
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [supplier('hotelbeds', { search: async () => { supplierCalls += 1; return []; } })],
        env,
        cacheOffers: async () => { cacheCalls += 1; return []; }
    });

    await assert.rejects(orchestrator.performSearch(CRITERIA), error =>
        error.code === 'multi_supplier_search_not_approved' && error.httpStatus === 503
            && error.missingGates.includes('MULTI_SUPPLIER_FX_POLICY_APPROVED'));
    assert.equal(supplierCalls, 0);
    assert.equal(cacheCalls, 0);

    const missingPricing = createMultiSupplierSearchOrchestrator({
        suppliers: [supplier('ratehawk', {
            search: async () => { supplierCalls += 1; return {}; },
            normalize: () => [offer('ratehawk', 'rh-unpriced')]
        })],
        env: approvedEnv(['ratehawk']),
        cacheOffers: async () => { cacheCalls += 1; return []; }
    });
    await assert.rejects(missingPricing.performSearch(CRITERIA), error =>
        error.code === 'aggregate_supplier_pricing_unapproved' && error.httpStatus === 503);
    assert.equal(supplierCalls, 0);
    assert.equal(cacheCalls, 0);
});

test('a supplier whose own approval gates are closed is skipped while the approved supplier is searched', async () => {
    let hotelbedsCalls = 0;
    let ratehawkCalls = 0;
    const env = approvedEnv(['hotelbeds']);
    const cache = cacheOffers();
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [
            supplier('hotelbeds', { search: async () => { hotelbedsCalls += 1; return {}; }, normalize: () => [offer('hotelbeds', '74001')] }),
            supplier('ratehawk', { search: async () => { ratehawkCalls += 1; return {}; } })
        ],
        env,
        priceOffer: async item => priceFixture(item),
        cacheOffers: cache.cache
    });

    const result = await orchestrator.performSearch(HOTEL_CRITERIA);

    assert.equal(hotelbedsCalls, 1);
    assert.equal(ratehawkCalls, 0);
    assert.equal(cache.calls.length, 1);
    assert.equal(result.partialResults, true);
    assert.equal(result.offerCount, 1);
});

test('public responses preserve pay-now versus pay-at-property without exposing supplier payment codes', async () => {
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [
            supplier('hotelbeds', {
                search: async () => ({}),
                normalize: () => [
                    offer('hotelbeds', '74001', { amount: '125.00' }),
                    { ...offer('hotelbeds', '74001', { amount: '130.00' }), payment: { type: 'AT_WEB' } }
                ]
            })
        ],
        env: approvedEnv(['hotelbeds']),
        priceOffer: async item => priceFixture(item),
        cacheOffers: async offers => offers.map((_, index) => ({ publicOfferId: String(index + 1).padStart(64, '0') }))
    });

    const result = await orchestrator.performSearch(HOTEL_CRITERIA);
    assert.deepEqual(result.hotels[0].offers.map(item => item.paymentFlow), ['PAY_AT_PROPERTY', 'PAY_NOW']);
    assert.equal(JSON.stringify(result).includes('AT_WEB'), false);
    assert.equal(JSON.stringify(result).includes('AT_HOTEL'), false);
});

test('supplier failure is isolated and an all-supplier failure returns a safe gateway error', async () => {
    const cache = cacheOffers();
    const env = approvedEnv();
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [
            supplier('hotelbeds', { search: async () => { throw new Error('private supplier detail'); } }),
            supplier('ratehawk', { search: async () => ({}), normalize: () => [offer('ratehawk', 'rh-1')] })
        ],
        env,
        priceOffer: async item => priceFixture(item),
        cacheOffers: cache.cache
    });

    const result = await orchestrator.performSearch(HOTEL_CRITERIA);
    assert.equal(result.partialResults, true);
    assert.equal(result.offerCount, 1);
    assert.equal(JSON.stringify(result).includes('private supplier detail'), false);

    const allFailing = createMultiSupplierSearchOrchestrator({
        suppliers: [
            supplier('hotelbeds', { search: async () => { throw new Error('private 1'); } }),
            supplier('ratehawk', { search: async () => { throw new Error('private 2'); } })
        ],
        env,
        priceOffer: async item => priceFixture(item),
        cacheOffers: async () => { throw new Error('cache must not be called'); }
    });
    await assert.rejects(allFailing.performSearch(HOTEL_CRITERIA), error =>
        error.code === 'multi_supplier_search_unavailable' && error.httpStatus === 502);
});

test('supplier timeout covers normalization/pricing work and signals cooperative cancellation', async () => {
    let aborted = false;
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [supplier('ratehawk', {
            search: async (_criteria, { signal }) => {
                signal.addEventListener('abort', () => { aborted = true; }, { once: true });
                return {};
            },
            normalize: () => [offer('ratehawk', 'rh-timeout')]
        })],
        env: approvedEnv(['ratehawk']),
        timeoutMs: 10,
        priceOffer: () => new Promise(() => {}),
        cacheOffers: async () => { throw new Error('cache must not be called after timeout'); }
    });

    await assert.rejects(orchestrator.performSearch(CRITERIA), error =>
        error.code === 'multi_supplier_search_unavailable' && error.httpStatus === 502);
    assert.equal(aborted, true);
});

test('unmapped cross-supplier IDs remain separate and invalid searches fail before supplier requests', async () => {
    let calls = 0;
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [
            supplier('hotelbeds', { search: async () => { calls += 1; return {}; }, normalize: () => [offer('hotelbeds', '74001')] }),
            supplier('ratehawk', { search: async () => { calls += 1; return {}; }, normalize: () => [offer('ratehawk', 'rh-74001')] })
        ],
        env: approvedEnv(),
        priceOffer: async item => priceFixture(item),
        cacheOffers: cacheOffers().cache
    });

    await assert.rejects(orchestrator.performSearch({ ...CRITERIA, checkout: CRITERIA.checkin }),
        error => error.code === 'search_stay_invalid');
    assert.equal(calls, 0);

    const result = await orchestrator.performSearch(HOTEL_CRITERIA);
    assert.equal(result.hotels.length, 2);
    assert.notEqual(result.hotels[0].hotelGroupId, result.hotels[1].hotelGroupId);
    assert.ok(result.hotels.every(hotel => !Object.hasOwn(hotel, 'canonicalId')));
});

test('Hotelbeds is not called for region searches or hotel IDs outside its approved pilot list', async () => {
    let hotelbedsCalls = 0;
    const env = { ...approvedEnv(), HOTELBEDS_PILOT_HOTEL_CODES: '74001' };
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [
            supplier('hotelbeds', { search: async () => { hotelbedsCalls += 1; return {}; } }),
            supplier('ratehawk', { search: async () => ({}), normalize: () => [offer('ratehawk', 'rh-1')] })
        ],
        env,
        priceOffer: async item => priceFixture(item),
        cacheOffers: cacheOffers().cache
    });

    const regionResult = await orchestrator.performSearch(CRITERIA);
    assert.equal(hotelbedsCalls, 0);
    assert.equal(regionResult.partialResults, true);

    const nonPilotResult = await orchestrator.performSearch({
        ...HOTEL_CRITERIA,
        destination: {
            type: 'hotel',
            providerHotelIds: { hotelbeds: ['74002'], ratehawk: ['rh-991'] }
        }
    });
    assert.equal(hotelbedsCalls, 0);
    assert.equal(nonPilotResult.partialResults, true);
});

test('malformed pilot IDs fail closed before Hotelbeds supplier calls', async () => {
    let hotelbedsCalls = 0;
    const env = { ...approvedEnv(), HOTELBEDS_PILOT_HOTEL_CODES: '74001,not-a-code' };
    const orchestrator = createMultiSupplierSearchOrchestrator({
        suppliers: [supplier('hotelbeds', { search: async () => { hotelbedsCalls += 1; return {}; } })],
        env,
        priceOffer: async item => priceFixture(item),
        cacheOffers: cacheOffers().cache
    });
    await assert.rejects(orchestrator.performSearch({
        ...CRITERIA,
        destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74001'] } }
    }), error => error.code === 'multi_supplier_search_not_approved');
    assert.equal(hotelbedsCalls, 0);
});

test('invalid provider adapter definitions are rejected at construction', () => {
    assert.throws(() => createMultiSupplierSearchOrchestrator({ suppliers: [] }),
        /multi_supplier_search_dependencies_invalid/);
    assert.throws(() => createMultiSupplierSearchOrchestrator({
        suppliers: [supplier('hotelbeds'), supplier('hotelbeds')]
    }), /multi_supplier_search_adapter_invalid/);
});