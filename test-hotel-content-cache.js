const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hydrateHotelContent, hotelContentNeedsRefresh } = require('./services/hotelContentCacheService');

test('cached hotels with names but missing photos qualify for supplier repair', () => {
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

test('missing hotel content is fetched once, matched to requested identity and cached without inventing names', async () => {
    let reads = 0, writes = [];
    const client = { hotelContentByIds: async body => {
        reads++; assert.deepEqual(body, { language: 'en', hids: [1234567801] });
        return { ok: true, data: [{ hid: 1234567801, id: 'official-hotel', name: 'Canonical Hotel', images: ['https://example.test/photo.jpg'] },
            { hid: 1234567802, id: 'other-hotel', name: 'Unrelated' }] };
    } };
    const HotelModel = { bulkWrite: async operations => { writes.push(...operations); } };
    const [first, second] = await Promise.all([hydrateHotelContent(['1234567801'], { client, HotelModel }), hydrateHotelContent(['1234567801'], { client, HotelModel })]);
    assert.equal(reads, 1); assert.equal(writes.length, 1);
    assert.equal(first[0].name, 'Canonical Hotel'); assert.equal(second[0].name, 'Canonical Hotel');
    assert.equal(first[0].staticData.images.length, 1);
});
test('interactive content loading has a bounded wait while the cache can complete in the background', async () => {
    let finish, cached = false;
    const client = { hotelContentByIds: () => new Promise(resolve => { finish = resolve; }) };
    const HotelModel = { bulkWrite: async () => { cached = true; } };
    assert.deepEqual(await hydrateHotelContent(['1234567803'], { client, HotelModel, budgetMs: 5 }), []);
    finish({ ok: true, data: [{ hid: 1234567803, id: 'delayed-hotel', name: 'Delayed Hotel' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cached, true);
});

test('a supplier response without photos is cached without inventing imagery or repeatedly fetching it', async () => {
    let reads = 0;
    const client = { hotelContentByIds: async () => {
        reads++;
        return { ok: true, data: [{ hid: 1234567804, id: 'no-photos', name: 'Official Hotel', images_ext: [] }] };
    } };
    const options = { client, HotelModel: { bulkWrite: async () => {} } };
    const rows = await hydrateHotelContent(['1234567804'], options);
    assert.equal(rows[0].image, '');
    assert.deepEqual(await hydrateHotelContent(['1234567804'], options), []);
    assert.equal(reads, 1);
});

test('search hydration batches more than one hundred missing hotels within provider batch limits', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => 1234568000 + index);
    const sizes = [];
    const client = { hotelContentByIds: async body => {
        sizes.push(body.hids.length);
        return { ok: true, data: body.hids.map(hid => ({ hid, id: `hotel-${hid}`, name: `Official ${hid}` })) };
    } };
    const rows = await hydrateHotelContent(ids, { client, HotelModel: { bulkWrite: async () => {} } });
    assert.deepEqual(sizes, [100, 100, 1]); assert.equal(rows.length, 201);
});
