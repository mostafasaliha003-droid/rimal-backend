const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createHotelbedsPilotListController = require('../controllers/hotelbedsPilotListController');
const createHotelbedsPilotListRouter = require('../services/hotelbedsPilotListRoutes');
const { configuredHotelbedsPilotCodes, pilotListFrom } = require('../services/hotelbedsPilotList');

const approvedEnv = {
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
    HOTELBEDS_PILOT_APPROVED: 'true',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_PILOT_PRICE_POLICY: 'supplier-raw-internal-only',
    HOTELBEDS_PILOT_OPERATOR_KEY: 'fixture-hotelbeds-operator-key-0123456789',
    HOTELBEDS_DAILY_BUDGETS: '{"availability":10}',
    HOTELBEDS_PILOT_HOTEL_CODES: '74,1067,295423',
    HOTELBEDS_API_KEY: 'never-return-this-api-key',
    HOTELBEDS_SECRET: 'never-return-this-secret'
};

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
        server.once('error', reject);
    });
}

test('pilot list parses only canonical numeric configured IDs and requires all pilot approvals', () => {
    assert.deepEqual(configuredHotelbedsPilotCodes(approvedEnv), ['74', '1067', '295423']);
    assert.throws(() => configuredHotelbedsPilotCodes({ ...approvedEnv, HOTELBEDS_PILOT_HOTEL_CODES: '74, nope' }),
        error => error.code === 'hotelbeds_pilot_hotel_codes_invalid');
    assert.throws(() => configuredHotelbedsPilotCodes({
        ...approvedEnv, HOTELBEDS_PILOT_HOTEL_CODES: '1,2,3,4,5,6'
    }), error => error.code === 'hotelbeds_pilot_hotel_limit_exceeded');
    assert.deepEqual(pilotListFrom({ ...approvedEnv, HOTELBEDS_PILOT_APPROVED: 'false' }), {
        success: true, environment: 'test', configured: false, hotels: []
    });
});

test('authenticated pilot-list route exposes approved IDs without secrets, DB access, or supplier calls', async context => {
    const app = express();
    let limiterCalls = 0;
    const verifyAPIKey = (req, res, next) => req.get('x-api-key') === 'fixture-api-key'
        ? next() : res.status(403).json({ success: false, error: 'api_key_invalid' });
    app.use('/api/v1/hotels', createHotelbedsPilotListRouter({
        controller: createHotelbedsPilotListController({ env: approvedEnv }),
        verifyAPIKey,
        searchLimiter: (_req, _res, next) => { limiterCalls += 1; next(); }
    }));
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/hotels/pilot-list`;

    const denied = await fetch(base);
    assert.equal(denied.status, 403);
    assert.equal(limiterCalls, 0);

    const response = await fetch(base, { headers: { 'x-api-key': 'fixture-api-key' } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.deepEqual(body, {
        success: true,
        environment: 'test',
        configured: true,
        hotels: [
            { providerHotelId: '74', label: 'Hotelbeds ID 74' },
            { providerHotelId: '1067', label: 'Hotelbeds ID 1067' },
            { providerHotelId: '295423', label: 'Hotelbeds ID 295423' }
        ]
    });
    assert.equal(JSON.stringify(body).includes('never-return-this'), false);
    assert.equal(limiterCalls, 1);
});

test('pilot-list route fails closed on malformed hotel-code configuration', async context => {
    const app = express();
    app.use('/api/v1/hotels', createHotelbedsPilotListRouter({
        controller: createHotelbedsPilotListController({
            env: { ...approvedEnv, HOTELBEDS_PILOT_HOTEL_CODES: '74,invalid' }
        }),
        verifyAPIKey: (_req, _res, next) => next()
    }));
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hotels/pilot-list`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
        success: false,
        error: 'hotelbeds_pilot_list_unavailable',
        hotels: []
    });
});

test('pilot-list route reports unavailable when operational preflight is incomplete', async context => {
    const app = express();
    app.use('/api/v1/hotels', createHotelbedsPilotListRouter({
        controller: createHotelbedsPilotListController({
            env: { ...approvedEnv, HOTELBEDS_PILOT_OPERATOR_KEY: '' }
        }),
        verifyAPIKey: (_req, _res, next) => next()
    }));
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hotels/pilot-list`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
        success: false,
        error: 'hotelbeds_pilot_list_unavailable',
        hotels: []
    });
});