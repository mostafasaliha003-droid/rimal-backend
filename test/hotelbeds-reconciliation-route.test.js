const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const createHotelbedsReconciliationController = require('../controllers/hotelbedsReconciliationController');
const createHotelbedsReconciliationRouter = require('../services/hotelbedsReconciliationRoutes');
const { createHotelbedsBookingReconciliationService } = require('../services/hotelbedsBookingReconciliationService');

const env = {
    RIMAL_AUTH_REALM: 'test:reconciliation-fixture',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_ACCOUNT_CONFIG: 'fixture-account'
};
const scope = {
    realm: env.RIMAL_AUTH_REALM,
    environment: 'test',
    accountId: crypto.createHash('sha256')
        .update('hotelbeds-account-v1:fixture-account', 'utf8').digest('hex')
};

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
        server.once('error', reject);
    });
}

function buildApp({ client, attemptStore }) {
    const service = createHotelbedsBookingReconciliationService({
        env,
        now: () => new Date('2026-10-03T10:00:00.000Z'),
        client,
        attemptStore
    });
    const app = express();
    let limiterCalls = 0;
    const requireAdmin = (req, res, next) => req.get('x-admin') === 'fixture-admin'
        ? next() : res.status(401).json({ success: false, error: 'unauthorized' });
    app.use('/api/v1/admin/hotelbeds', createHotelbedsReconciliationRouter({
        controller: createHotelbedsReconciliationController({ service }),
        requireAdmin,
        searchLimiter: (_req, _res, next) => { limiterCalls += 1; next(); }
    }));
    return { app, limiterCalls: () => limiterCalls };
}

function attemptFor(clientReference) {
    return {
        ...scope,
        ownerSubject: 'fixture-operator',
        provider: 'hotelbeds',
        origin: 'live',
        clientReference,
        claimedAt: new Date('2026-10-02T10:00:00.000Z'),
        state: 'outcome_unknown'
    };
}

test('reconciliation route requires admin before the limiter or any store/supplier access', async context => {
    let storeCalls = 0;
    const { app, limiterCalls } = buildApp({
        client: { async getBookingList() { assert.fail('supplier must not be called'); } },
        attemptStore: { async getByClientReference() { storeCalls += 1; return null; } }
    });
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/hotelbeds/reconciliations/RMLRECONCILE000010`;

    const denied = await fetch(base);
    assert.equal(denied.status, 401);
    assert.equal(limiterCalls(), 0);
    assert.equal(storeCalls, 0);
});

test('reconciliation route returns a read-only found result without mutating the attempt', async context => {
    const clientReference = 'RMLRECONCILE000010';
    const attempt = attemptFor(clientReference);
    const queries = [];
    const { app, limiterCalls } = buildApp({
        client: {
            async getBookingList(query) {
                queries.push(query);
                return { ok: true, data: { bookings: [{
                    reference: 'HBX-HTTP-0001', clientReference, status: 'CONFIRMED'
                }] } };
            }
        },
        attemptStore: {
            async getByClientReference(value, options) {
                assert.equal(value, clientReference);
                assert.equal(options.allowAnyOwner, true);
                return attempt;
            }
        }
    });
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/v1/admin/hotelbeds/reconciliations/${clientReference}`,
        { headers: { 'x-admin': 'fixture-admin' } }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.deepEqual(body, {
        success: true, state: 'found', clientReference,
        bookingReference: 'HBX-HTTP-0001', bookingStatus: 'CONFIRMED'
    });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].clientReference, clientReference);
    assert.equal(attempt.state, 'outcome_unknown', 'the route must never resolve or mutate the attempt');
    assert.equal(limiterCalls(), 1);
});

test('reconciliation route maps validation and missing-attempt failures without a supplier request', async context => {
    let supplierCalls = 0;
    const { app } = buildApp({
        client: { async getBookingList() { supplierCalls += 1; return { ok: true, data: { bookings: [] } }; } },
        attemptStore: { async getByClientReference() { return null; } }
    });
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/hotelbeds/reconciliations`;
    const headers = { 'x-admin': 'fixture-admin' };

    const invalid = await fetch(`${base}/not-a-reference`, { headers });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
        success: false, error: 'hotelbeds_reconciliation_reference_invalid'
    });

    const missing = await fetch(`${base}/RMLRECONCILE000011`, { headers });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
        success: false, error: 'hotelbeds_reconciliation_attempt_not_found'
    });
    assert.equal(supplierCalls, 0);
});

test('reconciliation route reports an unavailable supplier as an explicit state, not an error', async context => {
    const clientReference = 'RMLRECONCILE000012';
    const { app } = buildApp({
        client: { async getBookingList() { return { ok: false, httpStatus: 503, data: null }; } },
        attemptStore: { async getByClientReference() { return attemptFor(clientReference); } }
    });
    const server = await listen(app);
    context.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/v1/admin/hotelbeds/reconciliations/${clientReference}`,
        { headers: { 'x-admin': 'fixture-admin' } }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        success: true, state: 'query_unavailable', clientReference
    });
});

test('reconciliation router and controller fail closed on invalid dependencies', () => {
    assert.throws(() => createHotelbedsReconciliationRouter({}),
        error => error instanceof TypeError
            && error.message === 'hotelbeds_reconciliation_routes_dependencies_invalid');
    assert.throws(() => createHotelbedsReconciliationController({ service: {} }),
        error => error instanceof TypeError
            && error.message === 'hotelbeds_reconciliation_controller_dependencies_invalid');
});
