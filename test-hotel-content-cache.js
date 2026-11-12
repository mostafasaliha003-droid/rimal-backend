const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hydrateHotelContent, hotelContentNeedsRefresh } = require('./services/hotelContentCacheService');

test('cached hotels with names but missing photos qualify for local enrichment', () => {
    assert.equal(hotelContentNeedsRefresh({ name: 'Sapphire Plaza Hotel', image: '', staticData: { images: [] } }), true);
    assert.equal(hotelContentNeedsRefresh({ name: 'Official Hotel', staticData: { images_ext: [{ url: 'https://example.test/real.jpg' }] } }), false);
    assert.equal(hotelContentNeedsRefresh({ name: 'Official Hotel' }, { images: ['https://example.test/live.jpg'] }), false);
    assert.equal(hotelContentNeedsRefresh({ name: 'Hotel', image: 'https://example.test/real.jpg' }), true);
});

test('image collection handles nested supplier records and insecure or protocol-relative CDN links', async () => {
    const backend = require('./services/supplierImages');
    const frontend = await import('./frontend/src/services/hotelImages.js');
    const records = [{url:{source:'http://images.worldota.net/t/{size}/real.jpg'}}, '//images.ratehawk.net/t/640x480/second.jpg'];
    const expected = ['https://cdn.worldota.net/t/1920x1080/real.jpg', 'https://cdn.worldota.net/t/640x480/second.jpg'];
    assert.deepEqual(backend.collectSupplierImages(records), expected);
    assert.deepEqual(frontend.collectImages(records), expected);
});

test('interactive enrichment reads only synchronized content for the requested RateHawk identities', async () => {
    const cached = { hid: '1234567801', provider: 'ratehawk', name: 'Canonical Hotel', staticData: { images: ['https://example.test/photo.jpg'] } };
    let reads = 0;
    const HotelModel = { find: criteria => {
        reads++;
        assert.deepEqual(criteria, { provider: 'ratehawk', hid: { $in: ['1234567801'] } });
        return { lean: async () => [cached,
            { ...cached, hid: '1234567802' }, { ...cached, provider: 'other' }] };
    } };
    const client = { hotelContentByIds: () => { throw new Error('interactive supplier request'); } };
    assert.deepEqual(await hydrateHotelContent(['1234567801', '1234567801', 'legacy-id'], { client, HotelModel }), [cached]);
    assert.equal(reads, 1);
});

test('a cache miss never fetches supplier content or schedules a background repair', async () => {
    let supplierReads = 0, writes = 0;
    const client = { hotelContentByIds: async () => { supplierReads++; return { ok: true, data: [] }; } };
    const HotelModel = { find: () => ({ lean: async () => [] }), bulkWrite: async () => { writes++; } };
    assert.deepEqual(await hydrateHotelContent(['1234567803'], { client, HotelModel }), []);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(supplierReads, 0);
    assert.equal(writes, 0);
});

test('closed or deleted hotel records are excluded from local enrichment', async () => {
    const HotelModel = { find: () => ({ lean: async () => [
        { hid: '1234567804', provider: 'ratehawk', staticData: { deleted: true } },
        { hid: '1234567805', provider: 'ratehawk', staticData: { is_closed: true } }
    ] }) };
    assert.deepEqual(await hydrateHotelContent(['1234567804', '1234567805'], { HotelModel }), []);
});

test('invalid IDs do not query the database and local enrichment is bounded to five hundred identities', async () => {
    let reads = 0;
    const HotelModel = { find: criteria => {
        reads++;
        assert.equal(criteria.hid.$in.length, 500);
        return { lean: async () => [] };
    } };
    assert.deepEqual(await hydrateHotelContent(['legacy-id', '-1', null], { HotelModel }), []);
    assert.equal(reads, 0);
    assert.deepEqual(await hydrateHotelContent(Array.from({ length: 501 }, (_, index) => String(1234568000 + index)), { HotelModel }), []);
    assert.equal(reads, 1);
});
