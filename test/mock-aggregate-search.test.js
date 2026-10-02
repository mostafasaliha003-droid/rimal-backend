const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createAggregateSearchController = require('../controllers/aggregateSearchController');
const createAggregateSearchRouter = require('../services/aggregateSearchRoutes');
const { createMockAggregateSearchService } = require('../services/mockAggregateSearchService');

const CRITERIA = {
    checkIn: '2099-10-15',
    checkOut: '2099-10-17',
    guests: [{ adults: 1, children: [] }],
    destination: { type: 'region', regionId: 42, name: 'Fixture destination' }
};

async function withServer(app, run) {
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.once('error', reject);
    });
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('mock aggregate endpoint returns v2 server-priced AED and never calls a supplier transport', async () => {
    const env = {
        MULTI_SUPPLIER_MOCK_SEARCH_ENABLED: 'true',
        PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
        ZIINA_MOCK_WEBHOOK_SECRET: 'checkout-mock-webhook-secret-fixture'.padEnd(40, 'x')
    };
    const stored = [];
    const service = createMockAggregateSearchService({
        env,
        now: () => new Date('2026-10-02T12:00:00.000Z'),
        createHotelGroupId: () => 'mock-hotel-group',
        cacheOffers: async offers => {
            stored.push(...offers);
            return offers.map(() => ({ publicOfferId: 'a'.repeat(64) }));
        }
    });
    const app = express();
    app.use(express.json());
    const verifyAPIKey = (req, res, next) => req.get('x-api-key') === 'mock-search-key'
        ? next() : res.status(403).json({ success: false, error: 'api_key_invalid' });
    app.use('/api/v1/hotels', createAggregateSearchRouter({
        controller: createAggregateSearchController({
            service,
            enabled: () => env.MULTI_SUPPLIER_MOCK_SEARCH_ENABLED === 'true'
        }),
        verifyAPIKey
    }));

    await withServer(app, async base => {
        const response = await fetch(`${base}/api/v1/hotels/search/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'mock-search-key' },
            body: JSON.stringify(CRITERIA)
        });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
        assert.equal(body.schemaVersion, 2);
        assert.equal(body.mock, true);
        assert.equal(body.environment, 'mock');
        assert.equal(body.currency, 'AED');
        assert.equal(body.partialResults, false);
        assert.equal(body.offerCount, 1);
        const offer = body.hotels[0].offers[0];
        assert.equal(offer.provider, 'hotelbeds');
        assert.equal(offer.price.amount, '403.70');
        assert.equal(offer.price.currency, 'AED');
        assert.equal(offer.paymentFlow, 'UNKNOWN');
        assert.equal(offer.mock, true);
        assert.equal(offer.publicOfferId, null);
        assert.equal(stored.length, 0, 'default mock search must not create executable checkout offers');
        for (const forbidden of ['net', 'supplierAmount', 'opaqueToken', 'rateKey', '900001']) {
            assert.equal(JSON.stringify(body).toLowerCase().includes(forbidden.toLowerCase()), false, `public response leaked ${forbidden}`);
        }
    });
});

test('mock checkout offer caching requires the independent sandbox checkout gates', async () => {
    const stored = [];
    const env = {
        MULTI_SUPPLIER_MOCK_SEARCH_ENABLED: 'true',
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_PREPAID_CHECKOUT_ENABLED: 'true',
        HOTELBEDS_PREPAID_CHECKOUT_APPROVED: 'true',
        HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED: 'true',
        HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED: 'true',
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
        ZIINA_MOCK_WEBHOOK_SECRET: 'checkout-mock-webhook-secret-fixture'.padEnd(40, 'x')
    };
    const service = createMockAggregateSearchService({
        env,
        cacheOffers: async offers => {
            stored.push(...offers);
            return offers.map(() => ({ publicOfferId: 'c'.repeat(64) }));
        }
    });
    const result = await service.performSearch(CRITERIA);
    const offer = result.hotels[0].offers[0];
    assert.equal(result.mock, true);
    assert.equal(offer.paymentFlow, 'PAY_NOW');
    assert.equal(offer.publicOfferId, 'c'.repeat(64));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].booking.opaqueToken, 'MOCK-NEXTGEN-RATE-900001-BOOKABLE');
});

test('mock aggregate endpoint and service fail closed unless their explicit flag is enabled', async () => {
    let serviceCalls = 0;
    const service = { async performSearch() { serviceCalls += 1; return {}; } };
    const app = express();
    app.use(express.json());
    const verifyAPIKey = (_req, _res, next) => next();
    app.use('/api/v1/hotels', createAggregateSearchRouter({
        controller: createAggregateSearchController({ service, enabled: () => false }),
        verifyAPIKey
    }));
    await withServer(app, async base => {
        const response = await fetch(`${base}/api/v1/hotels/search/aggregate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CRITERIA)
        });
        assert.equal(response.status, 404);
        assert.equal(serviceCalls, 0);
    });

    const disabled = createMockAggregateSearchService({ env: { MULTI_SUPPLIER_MOCK_SEARCH_ENABLED: 'false' } });
    await assert.rejects(disabled.performSearch(CRITERIA), error => error.code === 'multi_supplier_mock_search_disabled');
});