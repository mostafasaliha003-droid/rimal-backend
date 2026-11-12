const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const logger = require('./services/loggerService');

function fixture(context) {
    const modulePath = require.resolve('./services/ratehawkClient');
    const previousModule = require.cache[modulePath];
    const names = ['RATEHAWK_KEY_ID', 'RATEHAWK_API_KEY', 'RATEHAWK_SERP_TIMEOUT_MS', 'RATEHAWK_PREBOOK_TIMEOUT_MS'];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    context.after(() => {
        if (previousModule) require.cache[modulePath] = previousModule;
        else delete require.cache[modulePath];
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
    });
    const requests = [];
    context.mock.method(axios, 'create', () => ({
        request: async config => {
            requests.push(config);
            return { status: 200, headers: {}, data: { status: 'ok', error: null, data: { hotels: [] } } };
        },
        getUri: config => config.url
    }));
    context.mock.method(logger, 'logEtgExchange', () => {});
    return {
        requests,
        load(overrides = {}) {
            process.env.RATEHAWK_KEY_ID = 'fixture-id';
            process.env.RATEHAWK_API_KEY = 'fixture-key';
            for (const name of names.slice(2)) {
                if (overrides[name] === undefined) delete process.env[name];
                else process.env[name] = overrides[name];
            }
            delete require.cache[modulePath];
            return require('./services/ratehawkClient');
        }
    };
}

test('all search transports send a 30-second supplier budget, leave network margin and ignore match_hash', async context => {
    const { load, requests } = fixture(context);
    const client = load();
    const input = { hid: 74, guests: [{ adults: 2, children: [] }], match_hash: 'obsolete-match' };
    for (const method of ['serpRegion', 'serpHotels', 'serpGeo', 'searchHotels',
        'searchHotelsByGeo', 'searchHotelsByRegion', 'getHotelPageRates', 'hotelPage']) {
        await client[method](input);
        const request = requests.at(-1);
        assert.deepEqual(request.data, { hid: 74, guests: input.guests, timeout: 30 }, method);
        assert.equal(request.timeout, 35000, method);
    }
    assert.equal(input.match_hash, 'obsolete-match');
    assert.equal(input.timeout, undefined);
});

test('incoming search timeouts stay between seven and thirty seconds even on alias methods', async context => {
    const { load, requests } = fixture(context);
    const client = load();
    for (const [incoming, expected] of [[0, 7], [6, 7], [7, 7], [20.9, 20], ['25', 25],
        [30, 30], [100, 30], ['invalid', 30], [null, 30], [false, 30], ['', 30]]) {
        await client.hotelPage({ hid: 74, timeout: incoming }, { timeout: 1, retries: 0 });
        assert.equal(requests.at(-1).data.timeout, expected, String(incoming));
        assert.equal(requests.at(-1).timeout, 35000);
    }
});

test('configuration cannot send sub-seven-second searches or exceed sixty-second prebook transport', async context => {
    const { load, requests } = fixture(context);
    for (const [setting, searchSeconds, prebookMs] of [
        ['1', 7, 30000], ['25000', 25, 30000], ['60000', 30, 60000],
        ['120000', 30, 60000], ['invalid', 30, 60000]
    ]) {
        const client = load({ RATEHAWK_SERP_TIMEOUT_MS: setting, RATEHAWK_PREBOOK_TIMEOUT_MS: setting });
        await client.serpHotels({ hids: [74] });
        assert.equal(requests.at(-1).data.timeout, searchSeconds);
        assert.equal(requests.at(-1).timeout, searchSeconds * 1000 + 5000);
        for (const method of ['prebook', 'prebookFromSerp']) {
            await client[method]({ hash: 'h-fixture', price_increase_percent: 10 });
            assert.equal(requests.at(-1).timeout, prebookMs);
            assert.deepEqual(requests.at(-1).data, { hash: 'h-fixture', price_increase_percent: 10 });
        }
        for (const method of ['prebookRate', 'prebookSerpRate']) {
            await client[method]('h-fixture', 10);
            assert.equal(requests.at(-1).timeout, prebookMs);
            assert.deepEqual(requests.at(-1).data, { hash: 'h-fixture', price_increase_percent: 10 });
        }
    }
});
