const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createOfferCacheService, OFFER_TTL_MS } = require('../services/offerCacheService');
const { createHotelbedsClient, TEST_MTLS_BASE_URL } = require('../services/hotelbedsClient');
const { createHotelbedsBookingService } = require('../services/hotelbedsBookingService');
const createBookingController = require('../controllers/bookingController');

const NOW = new Date('2026-10-01T12:00:00.000Z');
const PUBLIC_OFFER_ID = 'd'.repeat(64);
const RATE_KEY = 'private-hotelbeds-rate-key-fixture';
const TEST_API_KEY = 'booking-flow-test-key';
const GUEST_DETAILS = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    phone: '+971501234567',
    rooms: [{ guests: [
        { firstName: 'Ada', lastName: 'Lovelace', is_child: false },
        { firstName: 'Charles', lastName: 'Babbage', is_child: false }
    ] }]
};

const SUPPLIER_ENV = {
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_API_KEY: 'fixture-api-key',
    HOTELBEDS_SECRET: 'fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'fixture-booking-account',
    HOTELBEDS_MTLS_BASE_URL: TEST_MTLS_BASE_URL,
    HOTELBEDS_MTLS_CERT_PATH: 'fixture-client.crt',
    HOTELBEDS_MTLS_KEY_PATH: 'fixture-client.key',
    HOTELBEDS_RATE_MAX_REQUESTS: '8',
    HOTELBEDS_RATE_WINDOW_MS: '4000',
    HOTELBEDS_DAILY_MAX_REQUESTS: '50',
    HOTELBEDS_DAILY_WINDOW_MS: String(24 * 60 * 60 * 1000),
    HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ checkrates: 10, booking: 10 }),
    HOTELBEDS_BOOKING_ENABLED: 'true',
    HOTELBEDS_BOOKING_APPROVED: 'true'
};

function normalizedOffer({ rateType = 'RECHECK' } = {}) {
    return {
        origin: 'live',
        provider: 'hotelbeds',
        providerHotelId: '74001',
        hotel: { name: 'Fixture Hotel' },
        room: { providerCode: 'DBL.ST', name: 'Double Standard' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        availability: { rateType, rateClass: 'NOR', allotment: 2, packaging: false },
        payment: { type: 'AT_HOTEL' },
        price: {
            supplierAmount: { amount: '100.00', currency: 'EUR', basis: 'supplier_net' },
            customerDisplay: { amount: '495.00', currency: 'AED' }
        },
        booking: { opaqueToken: RATE_KEY }
    };
}

function createMemoryModel() {
    const records = new Map();
    return {
        records,
        async insertMany(documents) {
            for (const document of documents) records.set(document.publicOfferId, { ...document });
            return documents.map(document => ({ ...document }));
        },
        findOne(filter) {
            let selected = '';
            const query = {
                select(value) {
                    selected = value;
                    return this;
                },
                lean() { return this; },
                async exec() {
                    const record = records.get(filter.publicOfferId);
                    if (!record || !(record.expiresAt > filter.expiresAt.$gt)) return null;
                    const result = { ...record };
                    if (!selected.includes('+opaqueToken')) delete result.opaqueToken;
                    if (!selected.includes('+lockedNetPrice')) delete result.lockedNetPrice;
                    if (!selected.includes('+currency')) delete result.currency;
                    if (!selected.includes('+paymentType')) delete result.paymentType;
                    if (!selected.includes('+rateType')) delete result.rateType;
                    if (!selected.includes('+roomCount')) delete result.roomCount;
                    if (!selected.includes('+adultCount')) delete result.adultCount;
                    if (!selected.includes('+childCount')) delete result.childCount;
                    return result;
                }
            };
            return query;
        },
        findOneAndUpdate(filter, update) {
            let selected = '';
            const query = {
                select(value) {
                    selected = value;
                    return this;
                },
                lean() { return this; },
                async exec() {
                    const record = records.get(filter.publicOfferId);
                    if (!record
                        || filter.provider !== undefined && record.provider !== filter.provider
                        || filter.origin?.$exists === true && record.origin === undefined
                        || filter.expiresAt?.$gt && !(record.expiresAt > filter.expiresAt.$gt)
                        || filter.bookingState !== undefined && record.bookingState !== filter.bookingState) return null;
                    Object.assign(record, update.$set);
                    if (update.$unset) {
                        for (const field of Object.keys(update.$unset)) delete record[field];
                    }
                    const result = { ...record };
                    for (const field of [
                        'opaqueToken', 'lockedNetPrice', 'currency', 'paymentType', 'rateType',
                        'roomCount', 'adultCount', 'childCount', 'bookingAttemptId', 'bookingClientReference'
                    ]) if (!selected.includes(`+${field}`)) delete result[field];
                    return result;
                }
            };
            return query;
        },
        async updateOne(filter, update) {
            const record = records.get(filter.publicOfferId);
            if (!record || filter.provider !== undefined && record.provider !== filter.provider
                || filter.origin?.$exists === true && record.origin === undefined
                || filter.bookingState !== undefined && record.bookingState !== filter.bookingState
                || filter.bookingAttemptId !== undefined && record.bookingAttemptId !== filter.bookingAttemptId) return { modifiedCount: 0 };
            if (update.$set) Object.assign(record, update.$set);
            if (update.$unset) for (const key of Object.keys(update.$unset)) delete record[key];
            return { modifiedCount: 1 };
        }
    };
}

function makeServices({
    rateType = 'RECHECK',
    now = () => new Date(NOW),
    httpRequest,
    bookingEnv = SUPPLIER_ENV
} = {}) {
    const Model = createMemoryModel();
    const offerCacheService = createOfferCacheService({
        Model,
        providerScope: 'test',
        testOnly: true,
        ensureDatabaseReady: async () => {},
        now,
        createPublicOfferId: () => PUBLIC_OFFER_ID
    });
    const hotelbedsClient = createHotelbedsClient({
        env: SUPPLIER_ENV,
        limiter: { async acquire() {} },
        readFileSync: () => Buffer.from('fixture-mtls-certificate'),
        agentFactory: () => ({ destroy() {} }),
        http: { request: httpRequest }
    });
    const hotelbedsBookingService = createHotelbedsBookingService({
        client: hotelbedsClient,
        env: bookingEnv,
        now: () => new Date(now()),
        createClientReference: () => 'RMLTEST00000000001'
    });
    return { Model, offerCacheService, hotelbedsClient, hotelbedsBookingService, rateType };
}

async function withBookingServer({ offerCacheService, hotelbedsBookingService, run }) {
    const app = express();
    app.use(express.json());
    app.post('/api/v1/hotels/book', (req, res, next) => {
        if (req.get('x-api-key') !== TEST_API_KEY) {
            return res.status(403).json({ success: false, error: 'api_key_invalid' });
        }
        return next();
    }, createBookingController({ offerCacheService, hotelbedsBookingService }));
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    try {
        const address = server.address();
        return await run(`http://127.0.0.1:${address.port}/api/v1/hotels/book`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

async function seedOffer(offerCacheService, offer = normalizedOffer()) {
    await offerCacheService.storeOffers([offer]);
}

test('booking flow retrieves cache, rechecks the rate, maps the Hotelbeds payload, and sanitizes confirmation', async () => {
    const calls = [];
    const services = makeServices({ httpRequest: async request => {
        calls.push(request);
        if (request.url.endsWith('/checkrates')) {
            return { status: 200, data: { hotel: { rooms: [{ rates: [{
                rateKey: RATE_KEY, rateType: 'BOOKABLE', net: '100.00', currency: 'EUR'
            }] }] } } };
        }
        return { status: 200, data: { booking: {
            reference: 'HBX-BOOKING-90001',
            status: 'CONFIRMED',
            totalNet: '100.00',
            currency: 'EUR'
        } } };
    } });
    await seedOffer(services.offerCacheService);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).provider, 'hotelbeds');
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).paymentType, 'AT_HOTEL');
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).rateType, 'RECHECK');
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).adultCount, 2);

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS })
        });
        const body = await response.json();

        assert.equal(response.status, 200, JSON.stringify(body));
        assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['checkrates', 'bookings']);
        assert.deepEqual(calls[0].data, { rooms: [{ rateKey: RATE_KEY }] });
        assert.deepEqual(calls[1].data, {
            holder: { name: 'Ada', surname: 'Lovelace' },
            rooms: [{
                rateKey: RATE_KEY,
                paxes: [
                    { roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' },
                    { roomId: 1, type: 'AD', name: 'Charles', surname: 'Babbage' }
                ]
            }],
            clientReference: 'RMLTEST00000000001'
        });
        assert.deepEqual(body, {
            success: true,
            bookingReference: 'HBX-BOOKING-90001',
            status: 'CONFIRMED'
        });
        for (const forbidden of [RATE_KEY, '100.00', 'totalNet', 'EUR', 'opaqueToken', 'net']) {
            assert.equal(JSON.stringify(body).includes(forbidden), false, `booking response leaked ${forbidden}`);
        }
        assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingState, 'confirmed');
        assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingClientReference, 'RMLTEST00000000001');
    } });
});

test('invalid and expired offer IDs fail without calling Hotelbeds', async () => {
    let now = new Date(NOW);
    let supplierCalls = 0;
    const services = makeServices({
        now: () => now,
        httpRequest: async () => { supplierCalls += 1; return { status: 200, data: {} }; }
    });
    await seedOffer(services.offerCacheService);

    await withBookingServer({ ...services, run: async url => {
        for (const id of ['bad-id', 'e'.repeat(64)]) {
            const response = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
                body: JSON.stringify({ publicOfferId: id, guestDetails: GUEST_DETAILS })
            });
            assert.equal(response.status, 404);
        }
        now = new Date(NOW.getTime() + OFFER_TTL_MS);
        const expired = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS })
        });
        assert.equal(expired.status, 404);
    } });
    assert.equal(supplierCalls, 0);
});

test('a CheckRate price change blocks Booking and releases the one-shot offer claim', async () => {
    const calls = [];
    const services = makeServices({ httpRequest: async request => {
        calls.push(request);
        return { status: 200, data: { hotel: { rooms: [{ rates: [{
            rateKey: RATE_KEY, rateType: 'BOOKABLE', net: '101.00', currency: 'EUR'
        }] }] } } };
    } });
    await seedOffer(services.offerCacheService);

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS })
        });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { success: false, error: 'booking_rate_changed' });
    } });
    assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['checkrates']);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingState, 'available');
});

test('an unknown booking outcome is quarantined to prevent duplicate supplier bookings', async () => {
    let bookingCalls = 0;
    const services = makeServices({
        rateType: 'BOOKABLE',
        httpRequest: async () => {
            bookingCalls += 1;
            throw Object.assign(new Error('connection reset after request send'), { code: 'ECONNRESET' });
        }
    });
    await seedOffer(services.offerCacheService, normalizedOffer({ rateType: 'BOOKABLE' }));

    await withBookingServer({ ...services, run: async url => {
        const body = JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS });
        const first = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY }, body });
        assert.equal(first.status, 502);
        assert.deepEqual(await first.json(), { success: false, error: 'booking_outcome_unknown' });
        const second = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY }, body });
        assert.equal(second.status, 409);
    } });
    assert.equal(bookingCalls, 1);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingState, 'outcome_unknown');
});

test('booking route rejects missing API keys without looking up an offer', async () => {
    const services = makeServices({ httpRequest: async () => {
        assert.fail('supplier must not be called without API key');
    } });
    let cacheLookups = 0;
    const originalLookup = services.offerCacheService.getBookingOffer;
    services.offerCacheService.getBookingOffer = async id => {
        cacheLookups += 1;
        return originalLookup(id);
    };

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS })
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { success: false, error: 'api_key_invalid' });
    } });
    assert.equal(cacheLookups, 0);
});

test('booking remains disabled unless both explicit approval flags are true', async () => {
    let supplierCalls = 0;
    let cacheLookups = 0;
    const services = makeServices({
        bookingEnv: { ...SUPPLIER_ENV, HOTELBEDS_BOOKING_APPROVED: 'false' },
        httpRequest: async () => { supplierCalls += 1; return { status: 200, data: {} }; }
    });
    const originalLookup = services.offerCacheService.getBookingOffer;
    services.offerCacheService.getBookingOffer = async id => {
        cacheLookups += 1;
        return originalLookup(id);
    };

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS })
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { success: false, error: 'hotelbeds_booking_disabled' });
    } });
    assert.equal(cacheLookups, 0);
    assert.equal(supplierCalls, 0);
});

test('non-pay-at-hotel offers fail before claim or supplier calls', async () => {
    let supplierCalls = 0;
    const services = makeServices({ httpRequest: async () => {
        supplierCalls += 1;
        return { status: 200, data: {} };
    } });
    await seedOffer(services.offerCacheService, {
        ...normalizedOffer(), payment: { type: 'AT_WEB' }
    });

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS })
        });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { success: false, error: 'booking_payment_flow_required' });
    } });
    assert.equal(supplierCalls, 0);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingState, 'available');
});