const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const CheckoutSession = require('../models/CheckoutSession');
const OfferCache = require('../models/OfferCache');
const HotelbedsOfferCache = require('../models/HotelbedsOfferCache');
const Hotel = require('../models/Hotel');
const hotelbedsDatabase = require('../services/hotelbedsMockDatabase');
const {
    LIVE_SEARCH_GATES,
    requiredGates,
    hotelbedsSearchCriteriaFrom,
    createHotelbedsLiveAggregateSearchService
} = require('../services/hotelbedsLiveAggregateSearchService');
const createAggregateSearchController = require('../controllers/aggregateSearchController');
const createAggregateSearchRouter = require('../services/aggregateSearchRoutes');
const { createInternalApiKeyMiddleware } = require('../services/internalApiKeyMiddleware');
const express = require('express');

const MOCK_URI = 'mongodb://mock.example:27017/rimal_hotelbeds_mock';
const DEFAULT_URI = 'mongodb://default.example:27017/rimal';

function enabledEnv() {
    return {
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_MOCK_MONGO_URI: MOCK_URI,
        MONGO_URI: DEFAULT_URI,
        RIMAL_AUTH_REALM: 'hotelbeds-live-aggregate-test',
        HOTELBEDS_ACCOUNT_CONFIG: 'hotelbeds-live-aggregate-fixture-account',
        HOTELBEDS_LIVE_AGGREGATE_SEARCH_ENABLED: 'true',
        MULTI_SUPPLIER_SEARCH_ENABLED: 'true',
        MULTI_SUPPLIER_PRICE_POLICY_APPROVED: 'true',
        MULTI_SUPPLIER_FX_POLICY_APPROVED: 'true',
        MULTI_SUPPLIER_CONTENT_APPROVED: 'true',
        HOTELBEDS_PUBLIC_SEARCH_ENABLED: 'true',
        HOTELBEDS_PUBLIC_PRICING_APPROVED: 'true',
        HOTELBEDS_PUBLIC_PRICE_POLICY_APPROVED: 'true',
        HOTELBEDS_PUBLIC_CONTENT_APPROVED: 'true',
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
        HOTELBEDS_PILOT_APPROVED: 'true',
        HOTELBEDS_ENV: 'test',
        HOTELBEDS_PILOT_HOTEL_CODES: '74001',
        B2C_MARKUP_PERCENT: '10',
        HOTELBEDS_COMMISSION_NET_CONTRACT_APPROVED: 'true'
    };
}

function fakeConnection() {
    const conn = new mongoose.Mongoose().createConnection();
    conn.openedUri = null;
    conn.openUri = async uri => {
        conn.openedUri = uri;
        return conn;
    };
    Object.defineProperty(conn, 'readyState', { configurable: true, get: () => conn.openedUri ? 1 : 0 });
    Object.defineProperty(conn, 'name', {
        configurable: true,
        get: () => conn.openedUri ? new URL(conn.openedUri).pathname.replace(/^\//, '') : ''
    });
    return conn;
}

function fakeDatabase(connection = fakeConnection()) {
    const models = new Map();
    const database = {
        connection,
        models,
        async ensureConnected({ env }) {
            assert.equal(env.HOTELBEDS_MOCK_DATABASE_ENABLED, 'true');
            if (connection.openedUri === null) await connection.openUri(env.HOTELBEDS_MOCK_MONGO_URI);
            return connection;
        },
        async ensureModelConnected(Model, { env }) {
            await database.ensureConnected({ env });
            assert.equal(Model.db, connection);
            assert.equal(connection.readyState, 1);
            return connection;
        },
        model(name, schema) {
            if (!models.has(name)) {
                const created = [];
                models.set(name, {
                    modelName: name,
                    schema,
                    db: connection,
                    created,
                    async insertMany(documents, options) {
                        created.push({ documents: structuredClone(documents), options });
                        return documents;
                    }
                });
            }
            return models.get(name);
        }
    };
    return database;
}

function memoryOfferCacheModel(connection) {
    const created = [];
    const Model = {
        schema: OfferCache.schema,
        db: connection,
        created,
        async insertMany(documents, options) {
            created.push({ documents: structuredClone(documents), options });
            return documents;
        },
        findOne() {
            throw new Error('unexpected_offer_cache_read');
        }
    };
    return Model;
}

function availabilityFixture(env, contentSyncedAt) {
    const searchAvailabilityCalls = [];
    return {
        searchAvailabilityCalls,
        service: {
            async searchAvailability(criteria) {
                searchAvailabilityCalls.push(criteria);
                assert.equal(env.HOTELBEDS_PILOT_HOTEL_CODES, '74001');
                return {
                    pricePolicy: 'supplier-raw-internal-only',
                    contentLanguage: 'EN',
                    hotels: [{
                        code: 74001,
                        contentHotelCode: 74001,
                        contentLanguage: 'EN',
                        contentSource: 'hotelbeds_content_api',
                        contentSyncedAt,
                        currency: 'EUR',
                        name: 'Supplier name',
                        rooms: [{
                            code: 'DBL.ST',
                            name: 'Double Standard',
                            rates: [{
                                rateKey: 'private-rate-key-fixture',
                                rateType: 'BOOKABLE',
                                rateClass: 'NOR',
                                packaging: false,
                                hotelMandatory: false,
                                paymentType: 'AT_WEB',
                                boardCode: 'BB',
                                boardName: 'Breakfast',
                                net: '100.00',
                                rooms: 1,
                                adults: 2,
                                children: 0,
                                taxes: { allIncluded: true, taxes: [] },
                                cancellationPolicies: []
                            }]
                        }],
                        content: {
                            contentStatus: 'complete',
                            name: 'Verified Pilot Hotel',
                            category: { code: '4EST', name: '4 stars' },
                            description: 'Verified fixture property description.',
                            images: [{ path: 'hotel/verified.jpg', visualOrder: 0, type: { code: 'GEN' } }]
                        }
                    }]
                };
            }
        }
    };
}

test('RateHawk OfferCache stays on the default connection; Hotelbeds models use the isolated connection', () => {
    assert.equal(CheckoutSession.db, hotelbedsDatabase.connection);
    assert.equal(OfferCache.db, mongoose.connection);
    assert.equal(HotelbedsOfferCache.db, hotelbedsDatabase.connection);
    assert.notEqual(CheckoutSession.db.readyState, 1, 'model import must not dial Atlas');
    assert.notEqual(HotelbedsOfferCache.db, mongoose.connection);
    assert.equal(Hotel.db, mongoose.connection);
});

test('mock database URI must select a different database from the legacy application URI', () => {
    assert.equal(hotelbedsDatabase.assertDedicatedUri(
        'mongodb://user:secret@cluster.example/rimal_hotelbeds_mock?retryWrites=true',
        'mongodb://user:secret@cluster.example/rimal'
    ).database, 'rimal_hotelbeds_mock');
    assert.throws(() => hotelbedsDatabase.assertDedicatedUri(
        'mongodb://user:secret@cluster.example/rimal_hotelbeds_mock',
        'mongodb://different-user:different-secret@cluster.example/rimal_hotelbeds_mock'
    ), error => error.code === 'hotelbeds_mock_database_not_isolated');
    assert.throws(() => hotelbedsDatabase.assertDedicatedUri(
        'not-a-uri', DEFAULT_URI
    ), error => error.code === 'hotelbeds_mock_database_uri_invalid');
});

test('live aggregate remains disabled unless all supplier, pricing, FX, content, pilot and isolated-DB gates are true', async () => {
    const env = enabledEnv();
    assert.equal(requiredGates(env), true);
    for (const gate of [...LIVE_SEARCH_GATES, 'HOTELBEDS_ENABLED', 'HOTELBEDS_AVAILABILITY_PILOT_ENABLED', 'HOTELBEDS_PILOT_APPROVED']) {
        const disabledEnv = { ...env, [gate]: 'false' };
        assert.equal(requiredGates(disabledEnv), false, `${gate} must independently close the route`);
    }

    const db = fakeDatabase();
    const { service } = createService({ env: { ...env, MULTI_SUPPLIER_FX_POLICY_APPROVED: 'false' }, database: db });
    await assert.rejects(service.performSearch(searchCriteria()), error =>
        error.code === 'hotelbeds_live_aggregate_search_disabled' && error.httpStatus === 503);
    assert.equal(db.connection.openedUri, null, 'closed gate must not initialize the Atlas connection');
});

function searchCriteria() {
    return {
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        guests: [{ adults: 2, children: [] }],
        destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74001'] } }
    };
}

test('Hotelbeds criteria require an explicit approved provider ID and discard all legacy RateHawk identifiers', async () => {
    const env = enabledEnv();
    const legacyOnlyRequests = [
        { destination: { type: 'region', region_id: 42, label: 'Legacy region' } },
        { destination: { type: 'hotel', hid: 'rh-91' } },
        { hids: ['rh-91'], destination: { type: 'hotel', hotel_id: 'rh-92' } },
        { providerHotelIds: { ratehawk: ['rh-93'] }, destination: { type: 'hotel' } },
        { destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74001', '74002'] } } }
    ];
    for (const legacy of legacyOnlyRequests) {
        assert.throws(() => hotelbedsSearchCriteriaFrom({ ...searchCriteria(), ...legacy }, env), error =>
            error.code === 'hotelbeds_pilot_hotel_required' || error.code === 'hotelbeds_pilot_hotel_not_allowed');
    }

    const mixed = hotelbedsSearchCriteriaFrom({
        ...searchCriteria(),
        region_id: 42,
        hids: ['rh-old-hid'],
        destination: {
            type: 'hotel',
            regionId: 99,
            hid: 'rh-old-destination-hid',
            hotel_id: 'rh-old-hotel-id',
            providerHotelIds: { hotelbeds: ['74001'], ratehawk: ['rh-old-provider-id'] }
        }
    }, env);
    assert.deepEqual(mixed.destination, {
        type: 'hotel',
        providerHotelIds: { hotelbeds: ['74001'] }
    });
    assert.equal(Object.hasOwn(mixed, 'hids'), false);
    assert.equal(Object.hasOwn(mixed, 'region_id'), false);

    const topLevelContract = hotelbedsSearchCriteriaFrom({
        ...searchCriteria(),
        destination: { type: 'region', region_id: 42, hid: 'rh-legacy' },
        providerHotelIds: { hotelbeds: ['74001'], ratehawk: ['rh-legacy'] },
        hids: ['rh-legacy']
    }, env);
    assert.deepEqual(topLevelContract.destination, {
        type: 'hotel', providerHotelIds: { hotelbeds: ['74001'] }
    });
});

test('legacy IDs, missing IDs, and mixed unapproved Hotelbeds IDs fail before DB or Availability initialization', async () => {
    const env = enabledEnv();
    const database = fakeDatabase();
    const { service, availability } = createService({ env, database });
    const invalidCriteria = [
        { ...searchCriteria(), destination: { type: 'region', region_id: 42 } },
        { ...searchCriteria(), destination: { type: 'hotel', hid: 'rh-1' } },
        { ...searchCriteria(), hids: ['rh-1'], destination: { type: 'hotel', hotel_id: 'rh-2' } },
        { ...searchCriteria(), destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74001', '74002'] } } }
    ];

    for (const criteria of invalidCriteria) {
        await assert.rejects(service.performSearch(criteria), error =>
            ['hotelbeds_pilot_hotel_required', 'hotelbeds_pilot_hotel_not_allowed'].includes(error.code));
    }
    assert.equal(database.connection.openedUri, null);
    assert.equal(availability.searchAvailabilityCalls.length, 0);
});

function createService({ env = enabledEnv(), database = fakeDatabase(), CacheModel, FxService } = {}) {
    const cache = CacheModel || memoryOfferCacheModel(database.connection);
    const now = new Date();
    const availability = availabilityFixture(env, now);
    const fxCalls = [];
    const fx = FxService || {
        async getRate(from, to) {
            fxCalls.push([from, to]);
            const rates = { EUR: '4.05', AED: '1' };
            return {
                baseCurrency: from,
                quoteCurrency: to,
                rate: rates[from],
                date: '2026-10-02',
                provider: 'frankfurter-fixture',
                stale: false
            };
        }
    };
    let supplierAdapters = [];
    const service = createHotelbedsLiveAggregateSearchService({
        env,
        database,
        testOnly: true,
        AvailabilityService: class {
            constructor() { return availability.service; }
        },
        FxService: fx,
        CacheModel: cache,
        now: () => now
    });
    return { service, env, database, cache, availability, fx, fxCalls, get supplierAdapters() { return supplierAdapters; } };
}

test('live route composition injects only Hotelbeds, live FX, and isolated schema-v2 OfferCache writes', async () => {
    const database = fakeDatabase();
    const { service, availability, fxCalls } = createService({ database });
    const result = await service.performSearch(searchCriteria());
    const cache = database.models.get('HotelbedsOfferCache');

    assert.equal(database.connection.openedUri, MOCK_URI);
    assert.notEqual(database.connection, mongoose.connection);
    assert.equal(cache.created.length, 1);
    assert.equal(cache.created[0].options.ordered, true);
    assert.equal(cache.created[0].documents.length, 1);
    assert.equal(cache.created[0].documents[0].schemaVersion, 2);
    assert.equal(cache.created[0].documents[0].provider, 'hotelbeds');
    assert.equal(cache.created[0].documents[0].opaqueToken, 'private-rate-key-fixture');
    assert.deepEqual(availability.searchAvailabilityCalls, [{
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        occupancies: [{ rooms: 1, adults: 2, children: 0 }],
        hotelCodes: ['74001']
    }]);
    assert.ok(fxCalls.length > 0);
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.currency, 'AED');
    assert.equal(result.offerCount, 1);
    assert.equal(result.hotels[0].offers[0].price.currency, 'AED');
    assert.match(result.hotels[0].offers[0].termsVersion, /^[a-f\d]{64}$/i);
    assert.equal(JSON.stringify(result).includes('private-rate-key-fixture'), false);
    assert.equal(JSON.stringify(result).includes('supplierAmount'), false);
});

test('live Availability receives only the selected approved Hotelbeds ID even when legacy IDs are present', async () => {
    const { service, availability } = createService();
    const criteria = searchCriteria();
    criteria.region_id = 42;
    criteria.hids = ['rh-legacy-top-level'];
    criteria.destination = {
        type: 'hotel',
        regionId: 123,
        hid: 'rh-legacy-hid',
        hotel_id: 'rh-legacy-hotel-id',
        providerHotelIds: { hotelbeds: ['74001'], ratehawk: ['rh-legacy-provider'] }
    };

    await service.performSearch(criteria);
    assert.deepEqual(availability.searchAvailabilityCalls, [{
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        occupancies: [{ rooms: 1, adults: 2, children: 0 }],
        hotelCodes: ['74001']
    }]);
});

test('real Hotelbeds OfferCache schema persists schemaVersion 2 with explicit test readiness', async () => {
    const documents = [];
    const connection = fakeConnection();
    const BoundOfferCache = {
        modelName: 'TestSchemaVersion2OfferCache',
        schema: HotelbedsOfferCache.schema,
        db: connection,
        async insertMany(records, options) {
            documents.push({ records: structuredClone(records), options });
            return records;
        }
    };
    const { createOfferCacheService } = require('../services/offerCacheService');
    let readinessChecks = 0;
    const sandboxEnv = enabledEnv();
    const cache = createOfferCacheService({
        Model: BoundOfferCache,
        providerScope: 'hotelbeds',
        sandboxConnection: connection,
        env: sandboxEnv,
        now: () => new Date('2026-10-02T12:00:00.000Z'),
        createPublicOfferId: () => 'a'.repeat(64),
        ensureModelConnected: async (model, { env, expectedConnection }) => {
            readinessChecks += 1;
            assert.equal(model, BoundOfferCache);
            assert.equal(expectedConnection, connection);
            assert.equal(env.HOTELBEDS_MOCK_MONGO_URI, MOCK_URI);
            assert.notEqual(env.HOTELBEDS_MOCK_MONGO_URI, env.MONGO_URI);
        }
    });
    const stored = await cache.storeOffers([{
        schemaVersion: 2,
        provider: 'hotelbeds',
        origin: 'live',
        providerHotelId: '74001',
        hotel: { name: 'Fixture hotel' },
        room: { name: 'Double' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        price: {
            supplierAmount: { amount: '100.00', currency: 'EUR', basis: 'supplier_net' },
            customerDisplay: { amount: '445.50', currency: 'AED' }
        },
        payment: { type: 'AT_WEB' },
        availability: { rateType: 'BOOKABLE' },
        booking: { opaqueToken: 'private-token-fixture' }
    }], { schemaVersion: 2 });
    assert.equal(documents.length, 1);
    assert.equal(readinessChecks, 1);
    assert.equal(documents[0].records[0].schemaVersion, 2);
    assert.equal(stored[0].schemaVersion, 2);
    assert.equal(BoundOfferCache.db, connection);
    assert.notEqual(BoundOfferCache.db, mongoose.connection);
});

test('isolated mock connection refuses same-host same-database configuration before dialing', async () => {
    const env = {
        ...enabledEnv(),
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb://sandbox.example/rimal_hotelbeds_mock',
        MONGO_URI: 'mongodb+srv://user:secret@sandbox.example/rimal_hotelbeds_mock?retryWrites=true'
    };
    const connection = fakeConnection();
    const database = require('../services/hotelbedsMockDatabase').createHotelbedsMockDatabase({
        mongooseInstance: new mongoose.Mongoose(),
        isolatedConnection: connection
    });
    await assert.rejects(database.ensureConnected({ env }), error =>
        error.code === 'hotelbeds_mock_database_not_isolated');
    assert.equal(connection.openedUri, null);
});

function withServer(app, run) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', async () => {
            try { await run(`http://127.0.0.1:${server.address().port}`); resolve(); }
            catch (error) { reject(error); }
            finally { server.close(); }
        });
        server.once('error', reject);
    });
}

test('live aggregate HTTP route enforces server-side internal auth, rollout gate, no-cache, and schema v2', async () => {
    const app = express();
    app.use(express.json());
    const searchCalls = [];
    const service = { async performSearch(criteria) {
        searchCalls.push(criteria);
        return { success: true, schemaVersion: 2, currency: 'AED', hotels: [], hotelCount: 0, offerCount: 0 };
    } };
    const internalAuth = createInternalApiKeyMiddleware({ env: {
        RIMAL_INTERNAL_API_KEY: 'hotelbeds-live-aggregate-internal-key-fixture'
    } });
    let enabled = false;
    app.use('/api/v1/hotels', createAggregateSearchRouter({
        routePath: '/search/aggregate/live',
        controller: createAggregateSearchController({ service, enabled: () => enabled, requiredSchemaVersion: 2 }),
        access: 'internal',
        internalAuth
    }));

    await withServer(app, async base => {
        const url = `${base}/api/v1/hotels/search/aggregate/live`;
        const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(denied.status, 401);
        assert.equal(searchCalls.length, 0);
        const browserDenied = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key': 'hotelbeds-live-aggregate-internal-key-fixture',
                Origin: 'https://customer.example.test'
            },
            body: '{}'
        });
        assert.equal(browserDenied.status, 403);
        assert.equal(searchCalls.length, 0);
        const disabled = await fetch(url, {
            method: 'POST', headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key': 'hotelbeds-live-aggregate-internal-key-fixture'
            }, body: '{}'
        });
        assert.equal(disabled.status, 404);
        assert.equal(searchCalls.length, 0);
        enabled = true;
        const response = await fetch(url, {
            method: 'POST', headers: {
                'Content-Type': 'application/json',
                'x-internal-api-key': 'hotelbeds-live-aggregate-internal-key-fixture'
            }, body: '{}'
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
        assert.equal((await response.json()).schemaVersion, 2);
        assert.equal(searchCalls.length, 1);
    });
});

test('live aggregate controller rejects a non-v2 response', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/hotels', createAggregateSearchRouter({
        routePath: '/search/aggregate/live',
        controller: createAggregateSearchController({
            service: { async performSearch() { return { success: true, schemaVersion: 1, currency: 'AED', hotels: [] }; } },
            enabled: () => true,
            requiredSchemaVersion: 2
        }),
        access: 'internal',
        internalAuth: (_req, _res, next) => next()
    }));
    await withServer(app, async base => {
        const response = await fetch(`${base}/api/v1/hotels/search/aggregate/live`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { success: false, error: 'hotel_search_unavailable' });
    });
});