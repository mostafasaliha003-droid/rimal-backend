const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hydrateHotelContent } = require('./services/hotelContentCacheService');

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
