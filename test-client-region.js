const test = require('node:test');
const assert = require('node:assert/strict');
const { networkCountry, clientRegion } = require('./services/clientRegion');
const { publicApi, createMembershipAccessGate } = require('./services/membershipAccessGate');
const express = require('express');
const createDisplayCurrencyRouter = require('./services/displayCurrencyRoutes');
const host = 'rimal-api-staging.onrender.com';
const env = { RENDER: 'true', RENDER_EXTERNAL_HOSTNAME: host };
const headers = { host, 'cf-ray': 'abcdef0123456789-DXB', 'cf-ipcountry': 'AE' };

test('country hints require the public Render/Cloudflare context and a known country', () => {
    assert.equal(networkCountry(headers, env), 'AE');
    assert.equal(networkCountry(headers, {}), null);
    assert.equal(networkCountry({ ...headers, host: 'localhost' }, env), null);
    assert.equal(networkCountry({ ...headers, 'cf-ray': undefined }, env), null);
    for (const invalid of ['T1', 'XX', 'ZZ', 'AE,GB', ['FR'], null]) {
        assert.equal(networkCountry({ ...headers, 'cf-ipcountry': invalid }, env), null);
    }
});

test('the country hint needs no membership and never shares coordinates, IPs or a cacheable response', () => {
    assert.equal(publicApi({ path: '/api/client-region', method: 'GET' }), true);
    assert.equal(publicApi({ path: '/api/client-region', method: 'POST' }), false);
    let cache, body;
    clientRegion({ headers: {} }, { set: (field, value) => { if (field === 'Cache-Control') cache = value; }, json: value => { body = value; } });
    assert.equal(cache, 'private, no-store');
    assert.deepEqual(body, { success: true, country: null });
});

test('a visitor to the private site can read only the public world reference rates', async t => {
    const app = express();
    app.use(createMembershipAccessGate({ service: { enabled: () => true }, sessions: {} }));
    app.use('/api', createDisplayCurrencyRouter({
        getRates: async () => { throw Error('should be protected for anonymous visitors'); },
        getWorldRates: async () => ({ rates: { AED: 3.6725 }, stale: false }),
    }));
    const server = await new Promise(resolve => { const handle = app.listen(0, '127.0.0.1', () => resolve(handle)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + '/api/display-rates';
    const response = await fetch(url + '?scope=world');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rates.AED, 3.6725);
    for (const query of ['', '?scope=unknown', '?scope=world&scope=other']) {
        assert.equal((await fetch(url + query)).status, 401);
    }
});
