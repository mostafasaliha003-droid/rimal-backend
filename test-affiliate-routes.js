const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createAffiliateBookingRouter = require('./services/affiliateBookingRoutes');

const processId = 'a'.repeat(64);
const accessToken = 'b'.repeat(64);
const apiKey = 'affiliate-route-fixture-key';

async function start(context, service) {
    const app = express();
    app.use(express.json());
    const pass = (req, res, next) => next();
    app.use('/api/affiliate', createAffiliateBookingRouter({
        service,
        securityService: { searchLimiter: pass, bookingLimiter: pass },
        verifyAPIKey(req, res, next) {
            if (req.get('x-api-key') !== apiKey) return res.status(403).json({ success: false, error: 'forbidden' });
            next();
        }
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
    }));
    const base = `http://127.0.0.1:${server.address().port}/api/affiliate`;
    const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    return { base, post, headers: { 'x-api-key': apiKey } };
}

test('Affiliate HTTP routes isolate credentials, prevent caching, auto-finish once and protect status tokens', async context => {
    let finishCalls = 0;
    let processState = 'form_ready';
    const calls = [];
    const service = {
        getAvailability: () => ({ search: true, booking: true }),
        getHotelPageRates: async body => { calls.push(['rates', body]); return { success: true, rates: [] }; },
        createProcess: async (body, key, ip) => {
            calls.push(['create', body, key, ip]);
            return { process_id: processId, access_token: accessToken, status: processState, confirmed: false };
        },
        finishProcess: async (id, token) => {
            finishCalls += 1;
            assert.equal(id, processId);
            assert.equal(token, accessToken);
            processState = 'processing';
            return { process_id: processId, status: 'processing', confirmed: false };
        },
        checkStatus: async (id, token) => {
            assert.equal(id, processId);
            if (token !== accessToken) throw Object.assign(new Error('not found'), { httpStatus: 404 });
            return { process_id: processId, status: 'confirmed', confirmed: true, supplier_reference: 'AFFILIATE-ORDER' };
        }
    };
    const { base, post, headers } = await start(context, service);

    const availability = await fetch(`${base}/availability`);
    assert.equal(availability.status, 200);
    assert.equal(availability.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.deepEqual(await availability.json(), { search: true, booking: true });

    assert.equal((await post('/hotels/7001/rates', {}, {})).status, 403);
    const rates = await post('/hotels/7001/rates', { checkin: '2099-10-15', hid: 999 }, headers);
    assert.equal(rates.status, 200);
    assert.equal(rates.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.equal(calls[0][1].hid, '7001');

    const created = await post('/bookings', { contract_source: 'affiliate' }, {
        ...headers, 'Idempotency-Key': 'route-fixture-idempotency-key'
    });
    assert.equal(created.status, 202);
    assert.equal(calls[1][2], 'route-fixture-idempotency-key');
    assert.equal(finishCalls, 1);
    assert.deepEqual(await created.json(), { process_id: processId, status: 'processing', confirmed: false, access_token: accessToken });

    const replay = await post('/bookings', { contract_source: 'affiliate' }, {
        ...headers, 'Idempotency-Key': 'route-fixture-idempotency-key'
    });
    assert.equal(replay.status, 202);
    assert.equal(finishCalls, 1, 'idempotent replays must not invoke finish again');

    const invalidStatus = await fetch(`${base}/bookings/${processId}/status`, { headers });
    assert.equal(invalidStatus.status, 404);
    assert.equal(invalidStatus.headers.get('vary'), 'Authorization');
    assert.deepEqual(await invalidStatus.json(), { success: false, error: 'affiliate_booking_not_found' });
    const validStatus = await fetch(`${base}/bookings/${processId}/status`, {
        headers: { ...headers, Authorization: `Bearer ${accessToken}` }
    });
    assert.equal(validStatus.status, 200);
});

test('Affiliate create route does not hide finish failures or expose status tokens in an error response', async context => {
    const service = {
        getAvailability: () => ({ search: true, booking: true }),
        createProcess: async () => ({ process_id: processId, access_token: accessToken, status: 'form_ready', confirmed: false }),
        finishProcess: async () => { throw new Error('ambiguous finish transport failure'); }
    };
    const { post, headers } = await start(context, service);
    const response = await post('/bookings', {}, { ...headers, 'Idempotency-Key': 'route-ambiguous-idempotency-key' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, error: 'affiliate_booking_unavailable' });
});

test('Affiliate route failures do not expose supplier or exception details', async context => {
    const service = {
        getAvailability: () => ({ search: false, booking: false }),
        getHotelPageRates: async () => { throw Object.assign(new Error('private supplier response'), { code: 'affiliate_supplier_request_unavailable', httpStatus: 503 }); },
        createProcess: async () => { throw Object.assign(new Error('private data'), { config: { data: 'guest@example.test' } }); }
    };
    const { post, headers } = await start(context, service);
    const rates = await post('/hotels/7001/rates', {}, headers);
    assert.equal(rates.status, 503);
    assert.deepEqual(await rates.json(), { success: false, error: 'affiliate_supplier_request_unavailable' });
    const created = await post('/bookings', {}, { ...headers, 'Idempotency-Key': 'route-fixture-idempotency-key' });
    assert.equal(created.status, 503);
    assert.deepEqual(await created.json(), { success: false, error: 'affiliate_booking_unavailable' });
});