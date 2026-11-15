const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const images = require('./services/supplierImages');

const classification = { class: 3, quality: 2, sex: 0, bathroom: 2, bedding: 3,
    family: 0, capacity: 2, club: 0, bedrooms: 0, balcony: 0, view: 0, floor: 0 };
function hotel(provider, photo) {
    return { provider, hid: '10004834', hotelId: `${provider}-fixture`, name: `${provider} hotel`,
        image: `https://example.test/${provider}-property.jpg`, staticData: {
            name: `${provider} hotel`, images: [`https://example.test/${provider}-property.jpg`],
            room_groups: [{ name: 'Double room', rg_ext: { ...classification },
                images_ext: [{ url: photo, category_slug: 'bedroom' }], room_amenities: ['private-bathroom'] }]
        } };
}

// Exercise the registered production handler without starting server.js, a
// database, HTTP listeners, background jobs or any supplier client.
function detailsHandler(documents) {
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const start = server.indexOf("app.get('/api/v1/hotels/:hid',");
    const end = server.indexOf("app.get('/api/hotels/:hid/live',", start);
    assert.ok(start >= 0 && end > start);
    let handler;
    const queries = [], hydrationIds = [];
    const localRequire = createRequire(path.join(__dirname, 'server.js'));
    vm.runInNewContext(server.slice(start, end), {
        app: { get(route, guard, callback) { assert.equal(route, '/api/v1/hotels/:hid'); handler = callback; } },
        publicSearchGuard() {},
        Hotel: { findOne(query) {
            queries.push({ ...query });
            return { lean: async () => documents.find(document => Object.entries(query).every(([key, value]) => document[key] === value)) || null };
        } },
        require(module) {
            if (module === './services/hotelContentCacheService') return {
                hotelContentNeedsRefresh: localRequire(module).hotelContentNeedsRefresh,
                hydrateHotelContent: async ids => { hydrationIds.push([...ids]); return []; }
            };
            return localRequire(module);
        },
        formatHotelImage: images.normalizeSupplierImage,
        hotelImageStrings: images.collectSupplierImages,
        logger: { error(...args) { throw new Error(`Unexpected handler failure: ${JSON.stringify(args)}`); } }
    }, { filename: 'hotel-details-route.fixture.js' });
    return { queries, hydrationIds, async request() {
        const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
            json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } };
        await handler({ params: { hid: '10004834' }, query: { language: 'en' } }, response);
        return response;
    } };
}

test('hotel detail content uses the RateHawk record when another supplier has the same hid', async () => {
    const ratehawk = hotel('ratehawk', 'https://example.test/correct-room.jpg');
    const fixture = detailsHandler([hotel('dubailink', 'https://example.test/wrong-room.jpg'), ratehawk]);
    const response = await fixture.request();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(fixture.queries, [{ provider: 'ratehawk', hid: '10004834' }]);
    assert.deepEqual(response.body.hotel.room_groups, ratehawk.staticData.room_groups);
    assert.deepEqual(response.body.hotel.room_groups[0].rg_ext, classification);
    assert.equal(response.body.hotel.room_groups[0].images_ext[0].category_slug, 'bedroom');
    assert.equal(response.body.hotel.image, ratehawk.image);
    assert.equal(fixture.hydrationIds.length, 0);
});

test('an unrelated provider cannot supply hotel or room photos for a missing RateHawk record', async () => {
    const fixture = detailsHandler([hotel('dubailink', 'https://example.test/wrong-room.jpg')]);
    const response = await fixture.request();
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.success, false);
    assert.equal(response.body.hotel, undefined);
    assert.deepEqual(fixture.hydrationIds, [['10004834']]);
});

test('offline content mapping retains complete rg_ext and structured room photos without substituting property photos', context => {
    context.mock.method(require('dotenv'), 'config', () => ({}));
    const { toHotelOperation } = require('./syncFilteredHotels');
    const cached = hotel('ratehawk', 'https://cdn.worldota.net/t/{size}/content/room.jpg');
    const raw = { ...cached.staticData, hid: 10004834, id: 'ratehawk-fixture' };
    const operation = toHotelOperation(raw);
    const stored = operation.updateOne.update.$set;
    assert.equal(stored.provider, 'ratehawk');
    assert.deepEqual(stored.staticData.room_groups, raw.room_groups);
    assert.deepEqual(stored.staticData.room_groups[0].rg_ext, classification);
    assert.equal(stored.staticData.room_groups[0].images_ext[0].url, raw.room_groups[0].images_ext[0].url);
    assert.notEqual(stored.image, stored.staticData.room_groups[0].images_ext[0].url);
});

test('structured room image metadata never becomes a fabricated photograph', () => {
    assert.deepEqual(images.collectSupplierImages([{ category_slug: 'bedroom', caption: 'Room', width: 600, height: 400 }]), []);
    assert.deepEqual(images.collectSupplierImages([{ url: null, category_slug: 'bedroom' }]), []);
    assert.deepEqual(images.collectSupplierImages([{ url: '', category_slug: 'unspecified' }]), []);
    assert.deepEqual(images.collectSupplierImages([{ url: { source: 'https://cdn.ratehawk.net/t/{size}/content/room.jpg' }, category_slug: 'bedroom' }]), [
        'https://cdn.worldota.net/t/1920x1080/content/room.jpg'
    ]);
    assert.deepEqual(images.collectSupplierImages({ first: { url: 'https://example.test/one.jpg', category_slug: 'bedroom' },
        second: ['https://example.test/two.jpg'] }), ['https://example.test/one.jpg', 'https://example.test/two.jpg']);
});

test('hotelpage orchestration preserves dynamic classifications and never copies hotel photos into rates', async context => {
    const ratehawk = require('./services/ratehawkService');
    const raw = { hid: 10004834, id: 'ratehawk-fixture', images: ['https://example.test/property.jpg'],
        rates: [{ book_hash: 'h-room-fixture', room_name: 'Double room', rg_ext: { ...classification },
            payment_options: { payment_types: [{ amount: '100.00', currency_code: 'USD', type: 'deposit' }] } }] };
    context.mock.method(ratehawk.client, 'getHotelPageRates', async () => ({ hotels: [raw] }));
    context.mock.method(ratehawk.client, 'hotelContentByIds', () => { throw new Error('Interactive content API call'); });
    const result = await ratehawk.getHotelPageRates({ hid: 10004834, checkin: '2027-02-16', checkout: '2027-02-18',
        guests: [{ adults: 2, children: [] }], residency: 'ae', language: 'en', currency: 'USD' }, { now: new Date('2027-02-01T00:00:00Z') });
    const [decorated] = require('./services/paymentService').decorateHotels(result.hotels);
    assert.deepEqual(decorated.rates[0].rg_ext, classification);
    assert.deepEqual(decorated.images, raw.images);
    assert.equal(decorated.rates[0].images, undefined);
    assert.equal(decorated.rates[0].images_ext, undefined);
    assert.equal(raw.rates[0].offer_context, undefined, 'Original supplier payload remains unchanged');
});
