const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createSearchController = require('../controllers/searchController');
const createSearchRouter = require('../services/searchRoutes');
const { createSearchOrchestrator, REQUIRED_PUBLIC_GATES } = require('../services/searchOrchestrator');
const { createOfferCacheService } = require('../services/offerCacheService');
const { calculateDisplayPrice, createLivePricingService } = require('../services/pricingService');

const CRITERIA = Object.freeze({
    checkIn: '2026-11-10',
    checkOut: '2026-11-12',
    rooms: 1,
    adults: 2,
    children: 0
});

const PRIVATE_TOKEN = 'fixture-private-hotelbeds-rate-key';
const SUPPLIER_NET = '218.50';

function approvedEnv() {
    return Object.fromEntries(REQUIRED_PUBLIC_GATES.map(key => [key, 'true']));
}

function availabilityResponse() {
    return {
        pricePolicy: 'supplier-raw-internal-only',
        hotels: [{
            code: 74001,
            currency: 'EUR',
            name: 'Supplier property name',
            categoryCode: '4EST',
            categoryName: '4 stars',
            content: {
                contentStatus: 'complete',
                name: 'Verified Fixture Hotel',
                category: { code: '4EST', name: '4 stars' },
                images: [{ path: 'verified/property.jpg' }]
            },
            rooms: [{
                code: 'DBL.ST',
                name: 'Double Standard',
                rates: [{
                    rateKey: PRIVATE_TOKEN,
                    net: SUPPLIER_NET,
                    rooms: 1,
                    adults: 2,
                    children: 0,
                    rateType: 'BOOKABLE',
                    rateClass: 'NOR',
                    boardCode: 'BB',
                    boardName: 'Bed and Breakfast',
                    cancellationPolicies: []
                }]
            }]
        }]
    };
}

function createMemoryCacheModel() {
    const records = [];
    return {
        records,
        async insertMany(documents) {
            records.push(...documents.map(document => ({ ...document })));
            return documents.map(document => ({ ...document }));
        }
    };
}

async function withSearchServer(orchestrator, run) {
    const app = express();
    app.use(express.json());
    let routeLimiterCalls = 0;
    const verifyAPIKey = (req, res, next) => {
        if (req.get('x-api-key') !== 'search-orchestrator-test-key') {
            return res.status(403).json({ success: false, error: 'api_key_invalid' });
        }
        return next();
    };
    const router = createSearchRouter({
        controller: createSearchController({ orchestrator }),
        verifyAPIKey,
        searchLimiter: (req, res, next) => {
            routeLimiterCalls += 1;
            return next();
        }
    });
    app.use('/api/v1/hotels', router);
    app.post('/api/v1/hotels/search', verifyAPIKey, (req, res) =>
        res.status(200).json({ success: true, legacySearch: true }));
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    try {
        const address = server.address();
        return await run(`http://127.0.0.1:${address.port}/api/v1/hotels/search`, () => routeLimiterCalls);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test('Hotelbeds search route returns only the safe, priced customer DTO after the full pipeline', async () => {
    const availabilityCalls = [];
    const Model = createMemoryCacheModel();
    const cache = createOfferCacheService({
        Model,
        providerScope: 'test',
        testOnly: true,
        ensureDatabaseReady: async () => {},
        now: () => new Date('2026-10-01T12:00:00.000Z'),
        createPublicOfferId: () => 'a'.repeat(64)
    });
    const orchestrator = createSearchOrchestrator({
        env: approvedEnv(),
        // The integration exercises the live-pricing adapter with a deterministic
        // FX fixture; it never calls the public FX provider.
        priceOffer: createLivePricingService({
            fxService: {
                async getRate(from, to) {
                    const rates = { 'EUR:AED': '4.05', 'AED:AED': '1' };
                    return {
                        baseCurrency: from,
                        quoteCurrency: to,
                        rate: rates[`${from}:${to}`],
                        stale: false
                    };
                }
            }
        }),
        availabilityService: {
            async searchAvailability(criteria) {
                availabilityCalls.push(criteria);
                return availabilityResponse();
            }
        },
        cacheOffers: cache.storeOffers
    });

    await withSearchServer(orchestrator, async (url, getRouteLimiterCalls) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'search-orchestrator-test-key'
            },
            body: JSON.stringify({ ...CRITERIA, provider: 'hotelbeds' })
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
        assert.equal(getRouteLimiterCalls(), 1);
        assert.deepEqual(availabilityCalls, [{
            checkIn: CRITERIA.checkIn,
            checkOut: CRITERIA.checkOut,
            occupancies: [{ rooms: 1, adults: 2, children: 0 }]
        }]);
        assert.equal(Model.records.length, 1);
        assert.equal(Model.records[0].opaqueToken, PRIVATE_TOKEN);
        assert.equal(Model.records[0].lockedNetPrice, SUPPLIER_NET);

        assert.equal(body.success, true);
        assert.equal(body.currency, 'AED');
        assert.equal(body.offerCount, 1);
        assert.equal(body.offers[0].publicOfferId, 'a'.repeat(64));
        assert.equal(body.offers[0].hotel.name, 'Verified Fixture Hotel');
        assert.deepEqual(body.offers[0].price, { amount: '973.42', currency: 'AED' });

        const serialized = JSON.stringify(body);
        for (const forbidden of [
            PRIVATE_TOKEN,
            SUPPLIER_NET,
            'EUR',
            'supplierAmount',
            'opaqueToken',
            'rateKey',
            'lockedNetPrice',
            'booking',
            'providerHotelId'
        ]) {
            assert.equal(serialized.includes(forbidden), false, `customer response leaked ${forbidden}`);
        }
        assert.ok(body.offers.every(offer => offer.price.currency === 'AED'));
    });
});

test('unapproved public pricing gates fail closed before Availability or cache access', async () => {
    let availabilityCalls = 0;
    let cacheCalls = 0;
    const env = approvedEnv();
    delete env.HOTELBEDS_PUBLIC_PRICING_APPROVED;
    const orchestrator = createSearchOrchestrator({
        env,
        availabilityService: { async searchAvailability() { availabilityCalls += 1; return availabilityResponse(); } },
        cacheOffers: async () => { cacheCalls += 1; return []; }
    });

    await withSearchServer(orchestrator, async (url, getRouteLimiterCalls) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'search-orchestrator-test-key'
            },
            body: JSON.stringify({ ...CRITERIA, provider: 'hotelbeds' })
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            success: false,
            error: 'hotelbeds_public_search_not_approved'
        });
    });

    assert.equal(availabilityCalls, 0);
    assert.equal(cacheCalls, 0);
});

test('live FX provider failures stop search before offers are cached', async () => {
    let availabilityCalls = 0;
    let cacheCalls = 0;
    const orchestrator = createSearchOrchestrator({
        env: approvedEnv(),
        priceOffer: async () => {
            throw Object.assign(new Error('fx_provider_unavailable'), {
                code: 'fx_provider_unavailable',
                httpStatus: 503
            });
        },
        availabilityService: { async searchAvailability() { availabilityCalls += 1; return availabilityResponse(); } },
        cacheOffers: async () => { cacheCalls += 1; return []; }
    });

    await withSearchServer(orchestrator, async (url, getRouteLimiterCalls) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'search-orchestrator-test-key'
            },
            body: JSON.stringify({ ...CRITERIA, provider: 'hotelbeds' })
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            success: false,
            error: 'fx_provider_unavailable'
        });
    });

    assert.equal(availabilityCalls, 1);
    assert.equal(cacheCalls, 0);
});

test('unsupported children are rejected before Availability is called', async () => {
    let availabilityCalls = 0;
    const orchestrator = createSearchOrchestrator({
        env: approvedEnv(),
        availabilityService: { async searchAvailability() { availabilityCalls += 1; return availabilityResponse(); } },
        cacheOffers: async () => []
    });

    await withSearchServer(orchestrator, async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'search-orchestrator-test-key'
            },
            body: JSON.stringify({ ...CRITERIA, children: 1, provider: 'hotelbeds' })
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            success: false,
            error: 'hotelbeds_pilot_children_not_enabled'
        });
    });

    assert.equal(availabilityCalls, 0);
});

test('requests without explicit Hotelbeds provider selection stay outside the orchestrator', async () => {
    let availabilityCalls = 0;
    const orchestrator = createSearchOrchestrator({
        env: approvedEnv(),
        availabilityService: { async searchAvailability() { availabilityCalls += 1; return availabilityResponse(); } },
        cacheOffers: async () => []
    });

    await withSearchServer(orchestrator, async (url, getRouteLimiterCalls) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'search-orchestrator-test-key'
            },
            body: JSON.stringify(CRITERIA)
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, legacySearch: true });
        assert.equal(getRouteLimiterCalls(), 0);
    });

    assert.equal(availabilityCalls, 0);
});

test('incomplete and synthetic Hotelbeds content is excluded before caching', async () => {
    const Model = createMemoryCacheModel();
    const cache = createOfferCacheService({
        Model,
        providerScope: 'test',
        testOnly: true,
        ensureDatabaseReady: async () => {},
        createPublicOfferId: () => 'b'.repeat(64)
    });
    const orchestrator = createSearchOrchestrator({
        env: approvedEnv(),
        priceOffer: calculateDisplayPrice,
        availabilityService: {
            async searchAvailability() {
                const response = availabilityResponse();
                response.hotels[0].content.name = 'Mock fixture hotel';
                response.hotels[0].content.images[0].path = 'mock/hotel-74001.jpg';
                response.hotels.push({
                    code: 74002,
                    currency: 'EUR',
                    content: { contentStatus: 'partial', name: 'Partial property' },
                    rooms: [{ rates: [{ net: '10.00', rateKey: 'must-not-cache' }] }]
                });
                return response;
            }
        },
        cacheOffers: cache.storeOffers
    });

    const result = await orchestrator.performSearch(CRITERIA);
    assert.deepEqual(result.offers, []);
    assert.equal(result.offerCount, 0);
    assert.equal(Model.records.length, 0);
});