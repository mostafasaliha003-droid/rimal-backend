const { test } = require('node:test');
const assert = require('node:assert/strict');
const residencyCodes = require('./shared/ratehawkResidencies.json');
const {
    MAX_ARRIVAL_DAYS,
    MAX_STAY_DAYS,
    validateRatehawkSearchCriteria
} = require('./services/ratehawkSearchValidation');
const { normalizeSearchParams, validatedSearchParams } = require('./services/ratehawkService');
const createLegacyMixedSearchController = require('./controllers/legacyMixedSearchController');

const NOW = new Date('2026-10-13T12:00:00.000Z');
const TODAY = '2026-10-13';
const valid = {
    checkin: TODAY,
    checkout: '2026-10-14',
    residency: ' AE ',
    guests: [{ adults: 2, children: [] }]
};
const dateAfter = (value, days) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

test('shared residency codes contain unique lower-case ISO alpha-2 values', () => {
    assert.equal(new Set(residencyCodes).size, residencyCodes.length);
    assert(residencyCodes.length >= 249);
    assert(residencyCodes.includes('gb'));
    assert(residencyCodes.includes('ae'));
    assert(residencyCodes.includes('xk'));
    for (const unsupported of ['an', 'bu', 'dd', 'hv', 'zz']) assert.equal(residencyCodes.includes(unsupported), false);
    assert(residencyCodes.every(code => /^[a-z]{2}$/.test(code)));
});

test('validates and normalizes residency, calendar dates, and maximum boundary dates', () => {
    assert.equal(validateRatehawkSearchCriteria(valid, { now: NOW }).residency, 'ae');
    const latestArrival = dateAfter(TODAY, MAX_ARRIVAL_DAYS);
    assert.equal(validateRatehawkSearchCriteria({
        ...valid, checkin: latestArrival, checkout: dateAfter(latestArrival, 1)
    }, { now: NOW }).checkin, latestArrival);
    assert.throws(() => validateRatehawkSearchCriteria({
        ...valid, checkin: dateAfter(latestArrival, 1), checkout: dateAfter(latestArrival, 2)
    }, { now: NOW }), error => error.code === 'checkin_out_of_range');
    assert.throws(() => validateRatehawkSearchCriteria({
        ...valid, checkin: '2026-02-30', checkout: '2026-03-01'
    }, { now: NOW }), error => error.code === 'invalid_checkin');
    assert.throws(() => validateRatehawkSearchCriteria({
        ...valid, residency: 'zz'
    }, { now: NOW }), error => error.code === 'invalid_residency');
    assert.equal(validateRatehawkSearchCriteria({ ...valid, residency: 'xk' }, { now: NOW }).residency, 'xk');
    assert.throws(() => validateRatehawkSearchCriteria({
        ...valid, residency: ''
    }, { now: NOW }), error => error.code === 'invalid_residency');
    assert.throws(() => validateRatehawkSearchCriteria({
        ...valid, residency: 44
    }, { now: NOW }), error => error.code === 'invalid_residency');
});

test('validates stay and occupancy lower/upper limits', () => {
    const latestCheckout = dateAfter(valid.checkin, MAX_STAY_DAYS);
    assert.equal(validateRatehawkSearchCriteria({ ...valid, checkout: latestCheckout }, { now: NOW }).checkout, latestCheckout);
    assert.throws(() => validateRatehawkSearchCriteria({
        ...valid, checkout: dateAfter(latestCheckout, 1)
    }, { now: NOW }), error => error.code === 'checkout_out_of_range');
    assert.throws(() => validateRatehawkSearchCriteria({ ...valid, checkout: valid.checkin }, { now: NOW }),
        error => error.code === 'checkout_out_of_range');
    assert.equal(validateRatehawkSearchCriteria({
        ...valid, guests: Array.from({ length: 9 }, () => ({ adults: 6, children: [0, 5, 12, 17] }))
    }, { now: NOW }).guests.length, 9);
    for (const guests of [[], Array(10).fill({ adults: 1, children: [] }), [{ adults: 0, children: [] }],
        [{ adults: 7, children: [] }], [{ adults: 1, children: [0, 1, 2, 3, 4] }],
        [{ adults: 1, children: [-1] }], [{ adults: 1, children: [18] }]]) {
        assert.throws(() => validateRatehawkSearchCriteria({ ...valid, guests }, { now: NOW }),
            error => error.code === 'invalid_occupancy');
    }
});

test('search criteria normalization preserves fields and rejects incomplete or invalid criteria', () => {
    assert.equal(normalizeSearchParams({}).residency, 'ae');
    assert.throws(() => validatedSearchParams({}, { now: NOW }), error => error.code === 'invalid_checkin');
    assert.throws(() => validatedSearchParams({ checkin: TODAY }, { now: NOW }), error => error.code === 'invalid_checkout');
    assert.throws(() => validatedSearchParams({ ...valid, checkin: '', checkIn: TODAY }, { now: NOW }),
        error => error.code === 'invalid_checkin');
    assert.throws(() => validatedSearchParams({ ...valid, checkout: null, checkOut: '2026-10-14' }, { now: NOW }),
        error => error.code === 'invalid_checkout');
    assert.throws(() => validatedSearchParams({ ...valid, checkin: '2026-10-14', checkIn: TODAY }, { now: NOW }),
        error => error.code === 'invalid_checkin');
    assert.deepEqual(validatedSearchParams({ ...valid, checkin: TODAY, checkIn: TODAY }, { now: NOW }).checkin, TODAY);
    assert.deepEqual(validatedSearchParams({ ...valid, residency: 'GB' }, { now: NOW }).residency, 'gb');
    assert.throws(() => validatedSearchParams({ ...valid, residency: '' }, { now: NOW }), error => error.code === 'invalid_residency');
    assert.throws(() => validatedSearchParams({ ...valid, residency: null }, { now: NOW }), error => error.code === 'invalid_residency');
    assert.throws(() => validatedSearchParams({ ...valid, guests: [null] }, { now: NOW }), error => error.code === 'invalid_occupancy');
    assert.throws(() => validatedSearchParams({ ...valid, guests: [{ adults: 2, children: [''] }] }, { now: NOW }),
        error => error.code === 'invalid_occupancy');
    assert.throws(() => validatedSearchParams({ ...valid, guests: [{}] }, { now: NOW }),
        error => error.code === 'invalid_occupancy');
    for (const adults of [true, false, '', '2x']) {
        assert.throws(() => validatedSearchParams({ ...valid, guests: [{ adults, children: [] }] }, { now: NOW }),
            error => error.code === 'invalid_occupancy');
    }
    for (const age of [true, '', '2x']) {
        assert.throws(() => validatedSearchParams({ ...valid, guests: [{ adults: 2, children: [age] }] }, { now: NOW }),
            error => error.code === 'invalid_occupancy');
    }
    assert.throws(() => validatedSearchParams({ ...valid, guests: undefined, childrenAges: ['not-an-age'] }, { now: NOW }),
        error => error.code === 'invalid_occupancy');
    assert.throws(() => validatedSearchParams({ ...valid, guests: undefined, children: 1 }, { now: NOW }),
        error => error.code === 'invalid_occupancy');
    for (const children of [1, 2, '2', -1, 1.5, true, null]) {
        assert.throws(() => validatedSearchParams({ ...valid, guests: undefined, children }, { now: NOW }),
            error => error.code === 'invalid_occupancy');
    }
    assert.throws(() => validatedSearchParams({ ...valid, guests: undefined, childrenAges: null }, { now: NOW }),
        error => error.code === 'invalid_occupancy');
    assert.deepEqual(validatedSearchParams({ ...valid, guests: undefined, children: 0 }, { now: NOW }).guests,
        [{ adults: 2, children: [] }]);
    assert.deepEqual(validatedSearchParams({ ...valid, guests: undefined, children: '0' }, { now: NOW }).guests,
        [{ adults: 2, children: [] }]);
    assert.deepEqual(validatedSearchParams({ ...valid, guests: undefined, childrenAges: [5], children: 1 }, { now: NOW }).guests,
        [{ adults: 2, children: [5] }]);
    for (const criteria of [
        { childrenAges: [], children: 1 },
        { childrenAges: [5], children: 2 },
        { childrenAges: [5], children: [6] },
        { childrenAges: [5], children: null },
        { childrenAges: null, children: [5] }
    ]) {
        assert.throws(() => validatedSearchParams({ ...valid, guests: undefined, ...criteria }, { now: NOW }),
            error => error.code === 'invalid_occupancy');
    }
    const preserved = validatedSearchParams({
        ...valid, residency: undefined, hids: [73], region_id: 42,
        latitude: 25.2, longitude: 55.3, hid: 74, match_hash: 'fixture-match'
    }, { now: NOW });
    assert.equal(preserved.residency, 'ae');
    assert.deepEqual(preserved.hids, [73]);
    assert.equal(preserved.region_id, 42);
    assert.equal(preserved.latitude, 25.2);
    assert.equal(preserved.longitude, 55.3);
    assert.equal(preserved.hid, 74);
    assert.equal(preserved.match_hash, 'fixture-match');
    for (const [field, value] of Object.entries({
        destinationCode: 'DXB', destination_code: 'DXB', destinationName: 'Dubai',
        destination: 'Dubai', query: 'Dubai', hotel_id: 75, hotelId: 76,
        hotel_ids: [77], hotelIds: [78]
    })) {
        assert.deepEqual(validatedSearchParams({ ...valid, [field]: value }, { now: NOW })[field], value);
    }
    assert.deepEqual(validatedSearchParams({ ...valid, guests: [{ adults: '2', children: ['0', '17'] }] }, { now: NOW }).guests,
        [{ adults: 2, children: [0, 17] }]);
    for (const adults of [0, 7, 'not-a-number']) {
        assert.throws(() => validatedSearchParams({ ...valid, guests: [{ adults, children: [] }] }, { now: NOW }),
            error => error.code === 'invalid_occupancy');
    }
});

test('RateHawk SERP dispatch validates and forwards the selected residency', async context => {
    const service = require('./services/ratehawkService');
    let dispatched;
    context.mock.method(service.client, 'searchHotelsByRegion', async body => {
        dispatched = body;
        return { ok: true, data: { hotels: [] } };
    });

    await service.searchLiveRatesByRegion({ ...valid, residency: 'GB', region_id: 42 }, { now: NOW });
    assert.equal(dispatched.residency, 'gb');
    assert.equal(dispatched.checkin, TODAY);

    assert.throws(() => service.searchLiveRatesByRegion({ ...valid, residency: 'zz', region_id: 42 }, { now: NOW }),
        error => error.code === 'invalid_residency');
});

test('all RateHawk entry points preserve their destination/hotel fields through normalization', async context => {
    const service = require('./services/ratehawkService');
    const cases = [
        ['searchHotels', service.searchLiveRates, { hids: [73], ids: ['fixture-id'] }, { hids: [73], ids: ['fixture-id'] }],
        ['searchHotelsByGeo', service.searchLiveRatesByGeo,
            { latitude: 25.2, longitude: 55.3, radius: 4000 }, { latitude: 25.2, longitude: 55.3, radius: 4000 }],
        ['searchHotelsByRegion', service.searchLiveRatesByRegion, { region_id: 42 }, { region_id: 42 }],
        ['getHotelPageRates', service.getHotelPageRates,
            { hid: 74, match_hash: 'fixture-match' }, { hid: 74, match_hash: 'fixture-match' }]
    ];
    for (const [method, dispatch, criteria, expected] of cases) {
        let requestBody;
        context.mock.method(service.client, method, async body => {
            requestBody = body;
            return { ok: true, data: { hotels: [] } };
        });
        await dispatch({ ...valid, residency: 'gb', ...criteria }, { now: NOW });
        const requestFields = {
            checkin: TODAY,
            checkout: '2026-10-14',
            residency: 'gb',
            language: 'en',
            currency: 'USD',
            upsells: undefined,
            guests: [{ adults: 2, children: [] }],
            ...expected
        };
        assert.deepEqual(requestBody, requestFields, `${method} must forward the complete normalized request body`);
    }
});

test('hotelpage-rate lookup validates hotel IDs before supplier dispatch', async context => {
    const service = require('./services/ratehawkService');
    const bodies = [];
    context.mock.method(service.client, 'getHotelPageRates', async body => {
        bodies.push(body);
        return { hotels: [] };
    });

    for (const criteria of [{ hid: 74 }, { hotel_id: '75' }, { hotelId: '76' }]) {
        await service.getHotelPageRates({ ...valid, ...criteria }, { now: NOW });
        assert.equal(bodies.at(-1).hid, Number(criteria.hid ?? criteria.hotel_id ?? criteria.hotelId));
    }

    const dispatchedBeforeInvalid = bodies.length;
    for (const hotel of [undefined, null, '', -1, '-1', '99999999999', '1e2', 1.5]) {
        assert.throws(() => service.getHotelPageRates({ ...valid, hid: hotel }, { now: NOW }),
            error => error.code === 'invalid_hid' && error.ratehawkError === 'invalid_params');
    }
    assert.equal(bodies.length, dispatchedBeforeInvalid, 'invalid hotel IDs must not reach the supplier');
});

test('hotelpage validates the hotel identifier before dispatch and preserves both supported IDs', async context => {
    const service = require('./services/ratehawkService');
    const bodies = [];
    context.mock.method(service.client, 'hotelPage', async body => {
        bodies.push(body);
        return { ok: true, data: { hotels: [{ hid: body.hid, id: body.id, rates: [] }] } };
    });

    for (const [criteria, expected] of [
        [{ hid: 74 }, { hid: 74 }],
        [{ hid: '75' }, { hid: 75 }],
        [{ id: 'fixture-hotel' }, { id: 'fixture-hotel' }],
        [{ id: '123' }, { id: '123' }]
    ]) {
        await service.getHotelPage({ ...valid, ...criteria }, { now: NOW });
        assert.equal(bodies.at(-1).checkin, TODAY);
        assert.deepEqual(Object.fromEntries(['hid', 'id'].filter(field => Object.hasOwn(bodies.at(-1), field)
            ).map(field => [field, bodies.at(-1)[field]])), expected);
    }

    const dispatchedBeforeInvalid = bodies.length;
    for (const hotelId of [undefined, null, '', -1, '-1', '99999999999']) {
        await assert.rejects(service.getHotelPage({ ...valid, hid: hotelId }, { now: NOW }),
            error => error.code === 'invalid_hid');
    }
    assert.equal(bodies.length, dispatchedBeforeInvalid, 'invalid hotel identifiers must not reach the supplier');
});


test('B2B hotelpage requests use the selected residency', async context => {
    const service = require('./services/ratehawkService');
    const mappingService = require('./services/mappingService');
    const mongoose = require('mongoose');
    const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', new mongoose.Schema({ hotelId: String }));
    let b2bBody;
    context.mock.method(service.client, 'hotelPage', async body => {
        b2bBody = body;
        return { ok: true, data: { hotels: [{ id: 'fixture-hotel', hid: 74, name: 'Fixture Hotel', rates: [] }] } };
    });
    context.mock.method(Hotel, 'findOne', () => ({ lean: async () => null }));
    context.mock.method(mappingService, 'deduplicateHotels', hotels => hotels);
    await service.getHotelPricing(74, { ...valid, residency: 'xk' }, { now: NOW });
    assert.equal(b2bBody.residency, 'xk');
});

test('legacy RateHawk availability rejects missing dates and malformed occupancy before SERP dispatch', async context => {
    const service = require('./services/ratehawkService');
    let dispatched;
    context.mock.method(service.client, 'serpHotels', async body => {
        dispatched = body;
        return { ok: true, data: { hotels: [] } };
    });
    await assert.rejects(service.searchAvailability({ ...valid, checkout: undefined }, { now: NOW }),
        error => error.code === 'invalid_checkout');
    await assert.rejects(service.searchAvailability({ ...valid, guests: [{}] }, { now: NOW }),
        error => error.code === 'invalid_occupancy');
    await assert.rejects(service.searchAvailability({
        ...valid, guests: undefined, childrenAges: [5], children: 2, hids: [73]
    }, { now: NOW }), error => error.code === 'invalid_occupancy');
    assert.equal(dispatched, undefined);
    await service.searchAvailability({ ...valid, residency: 'xk', hids: [73] }, { now: NOW });
    assert.equal(dispatched.residency, 'xk');
    assert.deepEqual(dispatched.hids, [73]);
    assert.deepEqual(dispatched.guests, valid.guests);
});

function legacySearchDependencies({ ratehawkSearch, dubailinkSearch, hotel = null } = {}) {
    const calls = { ratehawk: 0, dubailink: 0, hotel: 0 };
    const ratehawkService = require('./services/ratehawkService');
    const mappingService = require('./services/mappingService');
    const logger = { info() {}, warn() {}, error() {} };
    return {
        calls,
        controller: createLegacyMixedSearchController({
            ratehawkService: {
                validatedSearchParams: criteria => ratehawkService.validatedSearchParams(criteria, { now: NOW }),
                fetchHotelsInChunks: async criteria => {
                    calls.ratehawk += 1;
                    return ratehawkSearch ? ratehawkSearch(criteria) : [];
                }
            },
            dubailinkService: {
                searchAvailability: async criteria => {
                    calls.dubailink += 1;
                    return dubailinkSearch ? dubailinkSearch(criteria) : [];
                }
            },
            Hotel: {
                findOne: async filter => {
                    calls.hotel += 1;
                    assert.equal(filter.hotelId, 'fixture-dubailink-hotel');
                    return hotel;
                }
            },
            mappingService: { deduplicateHotels: mappingService.deduplicateHotels },
            formatHotelImage: value => value,
            logger
        })
    };
}

function mockResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('legacy RateHawk + Dubai Link route rejects invalid criteria before either supplier call', async () => {
    const { controller, calls } = legacySearchDependencies();
    const response = mockResponse();

    await controller({ body: {
        checkIn: TODAY,
        checkOut: '2026-10-14',
        adults: 2,
        children: 2,
        childrenAges: [5]
    } }, response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { success: false, error: 'INVALID_SEARCH_CRITERIA' });
    assert.deepEqual(calls, { ratehawk: 0, dubailink: 0, hotel: 0 });
});

test('legacy mixed route isolates a RateHawk supplier failure and preserves Dubai Link results', async () => {
    const dubailinkHotel = {
        hotel_code: 'fixture-dubailink-hotel', hotel: 'Fixture Dubai Link hotel',
        groupRooms: [{ groupPrice: { amount: 125, currency: 'AED' }, rooms: [{ room_name: 'Fixture room' }] }]
    };
    const { controller, calls } = legacySearchDependencies({
        ratehawkSearch: async () => { throw new Error('private RateHawk transport detail'); },
        dubailinkSearch: async () => ({ hotelList: [dubailinkHotel] })
    });
    const response = mockResponse();

    await controller({ body: { ...valid, adults: 2, children: 0 } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.hotelsData.length, 1);
    assert.equal(response.body.hotelsData[0].provider, 'dubailink');
    assert.equal(response.body.hotelsData[0].name, 'فندق دبي المميز (fixture-dubailink-hotel)');
    assert.equal(response.body.hotelsData[0].rooms[0].price, 125);
    assert.deepEqual(calls, { ratehawk: 1, dubailink: 1, hotel: 1 });
    assert.equal(JSON.stringify(response.body).includes('private RateHawk transport detail'), false);
});

test('legacy mixed route isolates a Dubai Link supplier failure and preserves RateHawk results', async () => {
    const ratehawkHotel = {
        id: 'ratehawk-fixture', name: 'RateHawk fixture hotel',
        rates: [{ book_hash: 'fixture-rate', room_name: 'Fixture room',
            payment_options: { payment_types: [{ amount: '90', currency_code: 'AED' }] } }]
    };
    const { controller, calls } = legacySearchDependencies({
        ratehawkSearch: async () => [ratehawkHotel],
        dubailinkSearch: async () => { throw new Error('private Dubai Link transport detail'); }
    });
    const response = mockResponse();

    await controller({ body: { ...valid, adults: 2, children: 0 } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.hotelsData.length, 1);
    assert.equal(response.body.hotelsData[0].provider, 'ratehawk');
    assert.equal(response.body.hotelsData[0].name, ratehawkHotel.name);
    assert.equal(response.body.hotelsData[0].rooms[0].price, 90);
    assert.deepEqual(calls, { ratehawk: 1, dubailink: 1, hotel: 0 });
});
