const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    createHotelbedsAvailabilityService,
    normalizeOccupancies,
    pilotConfigurationFrom
} = require('./services/hotelbedsAvailabilityService');
const createHotelbedsAvailabilityRouter = require('./services/hotelbedsAvailabilityRoutes');
const { createHotelbedsRateLimiter } = require('./services/hotelbedsRateLimiter');

const operatorKey = 'fixture-operator-key-0123456789abcdef';
const env = {
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
    HOTELBEDS_PILOT_APPROVED: 'true',
    HOTELBEDS_PILOT_HOTEL_CODES: '12345,23456',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_PILOT_PRICE_POLICY: 'supplier-raw-internal-only',
    HOTELBEDS_PILOT_OPERATOR_KEY: operatorKey,
    HOTELBEDS_DAILY_MAX_REQUESTS: '50',
    HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ status: 1, availability: 8, checkrates: 12, booking: 4 })
};

function queryResult(value) {
    return { lean() { return this; }, exec: async () => value };
}

test('pilot config fails closed unless environment, gates, hotels, language, price policy, operator and budget exist', () => {
    assert.throws(() => pilotConfigurationFrom({ ...env, HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'false' }),
        error => error.code === 'hotelbeds_availability_pilot_disabled');
    assert.throws(() => pilotConfigurationFrom({ ...env, HOTELBEDS_ENV: 'production' }),
        error => error.code === 'hotelbeds_test_environment_required');
    assert.throws(() => pilotConfigurationFrom({ ...env, HOTELBEDS_PILOT_HOTEL_CODES: '' }),
        error => error.code === 'hotelbeds_pilot_hotel_codes_unconfigured');
    assert.throws(() => pilotConfigurationFrom({ ...env, HOTELBEDS_PILOT_PRICE_POLICY: '' }),
        error => error.code === 'hotelbeds_pilot_price_policy_unapproved');
    assert.throws(() => pilotConfigurationFrom({ ...env, HOTELBEDS_DAILY_BUDGETS: '' }),
        error => error.code === 'hotelbeds_operation_daily_budget_unconfigured');
    assert.deepEqual(pilotConfigurationFrom(env).codes, [12345, 23456]);
});

test('operation budgets stay within the shared daily cap and reserve atomically in the shared bucket', async () => {
    assert.throws(() => pilotConfigurationFrom({ ...env,
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ availability: 40, checkrates: 20 })
    }), error => error.code === 'hotelbeds_daily_budgets_exceed_global_quota');

    const updates = [];
    const Bucket = {
        updateOne: () => ({ exec: async () => ({ acknowledged: true }) }),
        findOneAndUpdate: (filter, pipeline, options) => {
            updates.push({ filter, pipeline, options });
            return { exec: async () => ({ requests: [new Date(10000)], operationRequests: [{ operation: 'availability', at: new Date(10000) }] }) };
        }
    };
    const limiter = createHotelbedsRateLimiter({
        Bucket, testOnly: true, ensureDatabaseReady: async () => {}, now: () => 10000
    });
    await limiter.acquire({
        account: 'fixture-account', apiKey: 'fixture-key', environment: 'test',
        maxRequests: 8, windowMs: 4000, dailyMaxRequests: 50,
        operation: 'availability', operationDailyMaxRequests: 8
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].filter.$expr.$and.length, 3);
    assert.equal(updates[0].pipeline[0].$set.operationRequests.$concatArrays.length, 2);
    assert.equal(updates[0].options.new, true);
});

test('normalizes adult occupancy and blocks child occupancy until the official Availability age field is verified', () => {
    assert.deepEqual(normalizeOccupancies({ occupancies: [
        { rooms: 1, adults: 2, children: 0 }
    ] }), [{ rooms: 1, adults: 2, children: 0 }]);
    assert.throws(() => normalizeOccupancies({ childrenAges: [7] }), error => error.code === 'hotelbeds_pilot_children_not_enabled');
    assert.throws(() => normalizeOccupancies({ occupancies: [
        { rooms: 1, adults: 1, children: 1 }
    ] }), error => error.code === 'hotelbeds_pilot_children_not_enabled');
    assert.throws(() => normalizeOccupancies({ occupancies: [
        { rooms: 1, adults: 1, paxes: [{ type: 'CH', age: 7 }] }
    ] }), error => error.code === 'hotelbeds_pilot_occupancy_shape_unsupported');
    assert.throws(() => normalizeOccupancies({ occupancies: [
        { rooms: 1, adults: 1, childrenAges: '7' }
    ] }), error => error.code === 'hotelbeds_occupancy_invalid');
});

test('availability makes one supplier request, reads content with one $in query, and preserves supplier prices', async () => {
    const supplierCalls = [];
    const contentQueries = [];
    const supplierHotels = [
        { code: 12345, name: 'Supplier Name One', rooms: [{ rates: [{ net: 101.25, currency: 'USD', rateKey: 'opaque-1' }] }] },
        { code: 23456, name: 'Supplier Name Two', rooms: [{ rates: [{ net: 202.50, currency: 'EUR', rateKey: 'opaque-2' }] }] }
    ];
    const service = createHotelbedsAvailabilityService({
        env,
        testOnly: true,
        ensureModelConnected: async () => {},
        client: { availability: async payload => {
            supplierCalls.push(payload);
            return { ok: true, data: { hotels: { hotels: supplierHotels } } };
        } },
        ContentModel: {
            find(query) {
                contentQueries.push(query);
                return queryResult([
                    { hotelCode: 12345, content: { name: 'Cached One', images: [{ path: 'img/one.jpg' }] } }
                ]);
            }
        }
    });

    const result = await service.searchAvailability({
        checkIn: '2030-06-15',
        checkOut: '2030-06-16',
        occupancies: [{ rooms: 1, adults: 2, children: 0 }]
    });

    assert.equal(supplierCalls.length, 1);
    assert.deepEqual(supplierCalls[0], {
        stay: { checkIn: '2030-06-15', checkOut: '2030-06-16' },
        occupancies: [{ rooms: 1, adults: 2, children: 0 }],
        hotels: { hotel: [12345, 23456] }
    });
    assert.equal(contentQueries.length, 1);
    assert.deepEqual(contentQueries[0], { hotelCode: { $in: [12345, 23456] }, language: 'ENG' });
    assert.equal(result.hotels[0].name, 'Supplier Name One');
    assert.deepEqual(result.hotels[0].content, { name: 'Cached One', images: [{ path: 'img/one.jpg' }] });
    assert.equal(result.hotels[0].rooms[0].rates[0].net, 101.25);
    assert.equal(result.hotels[0].rooms[0].rates[0].currency, 'USD');
    assert.equal(result.hotels[0].contentMissing, false);
    assert.equal(result.hotels[1].contentMissing, true);
    assert.equal(result.contentCacheMissCount, 1);
    assert.equal(result.pricePolicy, 'supplier-raw-internal-only');
    assert.equal(result.supplierRequests, 1);
});

test('availability rejects unapproved hotel codes, invalid dates and unexpected supplier hotel codes before exposing results', async () => {
    let outboundCalls = 0;
    const makeService = response => createHotelbedsAvailabilityService({
        env,
        testOnly: true,
        ensureModelConnected: async () => {},
        client: { availability: async () => { outboundCalls += 1; return response; } },
        ContentModel: { find: () => queryResult([]) }
    });
    const baseInput = { checkIn: '2030-06-15', checkOut: '2030-06-16' };
    await assert.rejects(makeService({ ok: true, data: { hotels: { hotels: [] } } })
        .searchAvailability({ ...baseInput, hotelCodes: [99999] }), /hotelbeds_pilot_hotel_not_allowed/);
    await assert.rejects(makeService({ ok: true, data: { hotels: { hotels: [] } } })
        .searchAvailability({ ...baseInput, checkOut: '2030-02-30' }), /hotelbeds_check_out_invalid/);
    await assert.rejects(makeService({ ok: true, data: { hotels: { hotels: [{ code: 99999 }] } } })
        .searchAvailability(baseInput), /hotelbeds_availability_unexpected_hotel_code/);
    assert.equal(outboundCalls, 1);
});

test('internal route requires both normal API key middleware and the separate operator key', async context => {
    let calls = 0;
    const apiKeyMiddleware = (req, res, next) => {
        if (req.get('x-api-key') !== 'fixture-api-key') return res.status(403).json({ error: 'api_key_invalid' });
        next();
    };
    const app = express();
    app.use(express.json());
    app.use('/api/hotelbeds', createHotelbedsAvailabilityRouter({
        env,
        verifyAPIKey: apiKeyMiddleware,
        service: { searchAvailability: async () => { calls += 1; return { hotels: [], supplierRequests: 1 }; } }
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
    }));
    const url = `http://127.0.0.1:${server.address().port}/api/hotelbeds/availability-pilot`;

    const noApiKey = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(noApiKey.status, 403);
    assert.equal(calls, 0);

    const noOperatorKey = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'fixture-api-key' }, body: '{}'
    });
    assert.equal(noOperatorKey.status, 403);
    assert.equal(calls, 0);

    const allowed = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': 'fixture-api-key',
            'x-hotelbeds-operator-key': operatorKey
        },
        body: '{}'
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.equal((await allowed.json()).success, true);
    assert.equal(calls, 1);
});