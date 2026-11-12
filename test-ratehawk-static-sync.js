const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');

function restoreEnvironment(context, updates) {
    const previous = new Map(Object.keys(updates).map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    context.after(() => {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

function reload(context, path) {
    const modulePath = require.resolve(path);
    const previous = require.cache[modulePath];
    delete require.cache[modulePath];
    context.after(() => {
        if (previous) require.cache[modulePath] = previous;
        else delete require.cache[modulePath];
    });
    return require(path);
}

test('offline incremental Content sync passes updated_since to IDs then imports returned hotel content', async context => {
    context.mock.method(require('dotenv'), 'config', () => ({}));
    restoreEnvironment(context, {
        MONGO_URI: 'mongodb://localhost/fixture-never-connected',
        RATEHAWK_FILTERS_JSON: JSON.stringify({ country: [201] }),
        RATEHAWK_UPDATED_SINCE: '2026-10-28 16:43:25',
        RATEHAWK_FILTER_COUNTRY: undefined, RATEHAWK_FILTER_STAR_RATING: undefined,
        RATEHAWK_FILTER_KIND: undefined, RATEHAWK_FILTER_SERP_FILTER: undefined
    });
    const client = require('./services/ratehawkClient');
    const service = require('./services/ratehawkService');
    const mongoose = require('mongoose');
    const Hotel = require('./models/Hotel');
    const order = [];
    context.mock.method(service, 'getFilterValues', async options => {
        assert.equal(options.forceRefresh, true);
        order.push('filter values');
        return { filters: { country: [{ value: '201' }] } };
    });
    context.mock.method(client, 'fetchHotelIdsByFilter', async filters => {
        order.push('updated hotel IDs');
        assert.deepEqual(filters, { country: [201], updated_since: '2026-10-28 16:43:25' });
        return [1234567801];
    });
    const hotel = {
        hid: 1234567801, id: 'fixture-hotel', name: 'Fixture Hotel',
        metapolicy_extra_info: 'Passport required at check-in.',
        metapolicy_struct: { deposit: [{ amount: '50', currency: 'USD' }] },
        room_groups: [{ rg_ext: { capacity: 2, quality: 2 }, name: 'Fixture room' }]
    };
    context.mock.method(client, 'hotelContent', async body => {
        order.push('content by IDs');
        assert.deepEqual(body, { hids: [1234567801] });
        return { ok: true, data: [hotel] };
    });
    context.mock.method(mongoose, 'connect', async uri => {
        assert.equal(uri, 'mongodb://localhost/fixture-never-connected');
    });
    context.mock.method(mongoose.connection, 'close', async () => {});
    context.mock.method(Hotel, 'bulkWrite', async (operations, options) => {
        order.push('database import');
        assert.equal(options.ordered, false);
        assert.equal(operations[0].updateOne.filter.hid, '1234567801');
        assert.deepEqual(operations[0].updateOne.update.$set.staticData, hotel);
        return { upsertedCount: 1, modifiedCount: 0 };
    });
    const stats = await reload(context, './syncFilteredHotels').syncFilteredHotels();
    assert.deepEqual(order, ['filter values', 'updated hotel IDs', 'content by IDs', 'database import']);
    assert.equal(stats.upserted, 1);
    assert.equal(stats.chunks, 1);
});

test('region dump job downloads a compressed fixture and imports it instead of only retrieving its URL', {
    skip: typeof zlib.zstdCompressSync !== 'function' ? 'Native Zstandard fixture requires a current Node runtime' : false
}, async context => {
    context.mock.method(require('dotenv'), 'config', () => ({}));
    restoreEnvironment(context, { MONGO_URI: 'mongodb://localhost/fixture-never-connected' });
    const axios = require('axios');
    const mongoose = require('mongoose');
    const client = require('./services/ratehawkClient');
    const Region = require('./models/Region');
    const dump = require('./services/hotelDumpSyncService');
    const realSyncDump = dump.syncDump;
    const order = [];
    // Unique fixture paths keep this test independent of operator dump files.
    context.mock.method(dump, 'syncDump', options => realSyncDump({
        ...options, name: `region-fixture-${randomUUID()}`
    }));
    context.mock.method(client, 'getRegionDumpUrl', async () => {
        order.push('dump URL');
        return 'https://supplier.invalid/fixture-regions.jsonl.zst';
    });
    const region = { id: 999, name: { en: 'Fixture City' }, type: 'City',
        country_code: 'AE', center: { latitude: 25.2, longitude: 55.3 }, hids: [1234567801] };
    const compressed = zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(region)}\n`));
    context.mock.method(axios, 'get', async (url, options) => {
        order.push('download');
        assert.equal(url, 'https://supplier.invalid/fixture-regions.jsonl.zst');
        assert.equal(options.responseType, 'stream');
        return { data: Readable.from([compressed]) };
    });
    context.mock.method(mongoose, 'connect', async uri => {
        assert.equal(uri, 'mongodb://localhost/fixture-never-connected');
    });
    context.mock.method(mongoose.connection, 'close', async () => {});
    context.mock.method(Region, 'bulkWrite', async operations => {
        order.push('database import');
        assert.equal(operations[0].updateOne.filter.id, region.id);
        assert.deepEqual(operations[0].updateOne.update.$set.name, region.name);
        assert.deepEqual(operations[0].updateOne.update.$set.hids, region.hids);
        return { upsertedCount: 1, modifiedCount: 0 };
    });
    const stats = await reload(context, './syncRegionDump').syncRegionDump();
    assert.deepEqual(order, ['dump URL', 'download', 'database import']);
    assert.equal(stats.read, 1);
    assert.equal(stats.upserted, 1);
});
