const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createOfferCacheService, OFFER_TTL_MS } = require('../services/offerCacheService');
const { createHotelbedsClient, TEST_MTLS_BASE_URL } = require('../services/hotelbedsClient');
const { createHotelbedsBookingService } = require('../services/hotelbedsBookingService');
const {
    identityFromNormalizedOffer,
    termsFromNormalizedOffer
} = require('../services/hotelbedsRateCheckService');
const { createHotelbedsBookingReconciliationService } = require('../services/hotelbedsBookingReconciliationService');
const { hotelbedsScopeFrom } = require('../services/hotelbedsScope');
const createBookingController = require('../controllers/bookingController');

const NOW = new Date('2026-10-01T12:00:00.000Z');
const PUBLIC_OFFER_ID = 'd'.repeat(64);
const RATE_KEY = 'private-hotelbeds-rate-key-fixture';
const CHECKED_RATE_KEY = 'private-hotelbeds-checked-rate-key-fixture';
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
    RIMAL_AUTH_REALM: 'booking-flow-fixture',
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
    HOTELBEDS_BOOKING_APPROVED: 'true',
    PAYMENT_BOOKING_ENCRYPTION_KEY: 'cd'.repeat(32)
};

const RECONCILIATION_SCOPE = hotelbedsScopeFrom(SUPPLIER_ENV);

function normalizedOffer({ rateType = 'RECHECK' } = {}) {
    return {
        origin: 'live',
        provider: 'hotelbeds',
        providerHotelId: '74001',
        hotel: { name: 'Fixture Hotel' },
        room: { providerCode: 'DBL.ST', name: 'Double Standard' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        availability: {
            rateType, rateClass: 'NOR', allotment: 2, packaging: false,
            rateCommentsResolved: true
        },
        payment: { type: 'AT_HOTEL' },
        board: { supplierCode: 'BB', supplierName: 'Bed and Breakfast', normalizedCode: 'BB' },
        cancellation: {
            refundability: 'conditional',
            freeCancellationBefore: null,
            schedule: [{
                startsAt: {
                    source: '2026-11-10T00:59:00+01:00',
                    utc: '2026-11-09T23:59:00.000Z',
                    timezoneKnown: true
                },
                endsAt: null,
                penalty: { amount: '100.00', currency: 'EUR' }
            }]
        },
        promotions: [],
        rateComments: [],
        contractTerms: { rateCommentsResolved: true },
        price: {
            supplierAmount: { amount: '100.00', currency: 'EUR', basis: 'supplier_net' },
            customerDisplay: { amount: '495.00', currency: 'AED' },
            lockedSell: { amount: '495.00', currency: 'AED' }
        },
        booking: { opaqueToken: RATE_KEY }
    };
}

function checkRateResponse({ rateKey = RATE_KEY, net = '100.00', rateComments = [] } = {}) {
    return { hotels: {
        code: 74001,
        checkIn: '2026-11-10T00:00:00.000Z',
        checkOut: '2026-11-12T00:00:00.000Z',
        currency: 'EUR',
        rooms: [{ code: 'DBL.ST', rates: [{
            rateKey,
            rateClass: 'NOR',
            rateType: 'BOOKABLE',
            paymentType: 'AT_HOTEL',
            net,
            packaging: false,
            boardCode: 'BB',
            rooms: 1,
            adults: 2,
            children: 0,
            cancellationPolicies: [{ amount: '100.00', from: '2026-11-10T00:59:00+01:00' }],
            promotions: [],
            rateComments
        }] }]
    } };
}

function createMemoryAttemptStore() {
    const recordsByOfferId = new Map();
    const recordsBySessionId = new Map();
    const recordsByClientReference = new Map();
    const nextStates = {
        claimed: new Set(['preflight_failed', 'booking_processing']),
        preflight_failed: new Set(),
        booking_processing: new Set(['confirmed', 'booking_pending', 'outcome_unknown']),
        booking_pending: new Set(['confirmed', 'manual_review']),
        confirmed: new Set(),
        outcome_unknown: new Set(['confirmed', 'booking_pending', 'manual_review']),
        manual_review: new Set()
    };
    return {
        testOnly: true,
        recordsByOfferId,
        recordsBySessionId,
        async claim(input) {
            const duplicate = input.scope === 'prepaid'
                ? recordsBySessionId.has(input.sessionId)
                : recordsByOfferId.has(input.publicOfferId);
            if (duplicate || recordsByClientReference.has(input.clientReference)) return null;
            const record = structuredClone({ ...hotelbedsScopeFrom({}, { testOnly: true }),
                ownerSubject: 'test-fixture-owner', ...input });
            if (record.scope === 'prepaid') recordsBySessionId.set(record.sessionId, record);
            else recordsByOfferId.set(record.publicOfferId, record);
            recordsByClientReference.set(record.clientReference, record);
            return record;
        },
        async getByOfferId(id, ownerSubject) {
            const record = recordsByOfferId.get(id) || null;
            return record && (!ownerSubject || record.ownerSubject === ownerSubject) ? record : null;
        },
        async getBySessionId(id) { return recordsBySessionId.get(id) || null; },
        async getByClientReference(id) { return recordsByClientReference.get(id) || null; },
        async transition({ attemptId, expectedState, nextState, fields = {} }) {
            const record = [...recordsByOfferId.values(), ...recordsBySessionId.values()]
                .find(item => item.attemptId === attemptId);
            if (!record || record.state !== expectedState || !nextStates[expectedState]?.has(nextState)) {
                throw Object.assign(new Error('booking_attempt_state_conflict'), {
                    code: 'hotelbeds_booking_attempt_state_conflict', httpStatus: 409
                });
            }
            Object.assign(record, structuredClone(fields), { state: nextState });
            return record;
        }
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
                    if (!record || !(record.expiresAt > filter.expiresAt.$gt)
                        || ['realm', 'environment', 'accountId'].some(key => filter[key] !== undefined && record[key] !== filter[key])) return null;
                    const result = { ...record };
                    if (!selected.includes('+opaqueToken')) delete result.opaqueToken;
                    if (!selected.includes('+lockedNetPrice')) delete result.lockedNetPrice;
                    if (!selected.includes('+currency')) delete result.currency;
                    if (!selected.includes('+paymentType')) delete result.paymentType;
                    if (!selected.includes('+rateType')) delete result.rateType;
                    if (!selected.includes('+roomCount')) delete result.roomCount;
                    if (!selected.includes('+adultCount')) delete result.adultCount;
                    if (!selected.includes('+childCount')) delete result.childCount;
                    for (const field of ['lockedSellAmount', 'lockedSellCurrency']) {
                        if (!selected.includes(`+${field}`)) delete result[field];
                    }
                    if (!selected.includes('+origin')) delete result.origin;
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
                        || ['realm', 'environment', 'accountId'].some(key => filter[key] !== undefined && record[key] !== filter[key])
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
                || ['realm', 'environment', 'accountId'].some(key => filter[key] !== undefined && record[key] !== filter[key])
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
    bookingEnv = SUPPLIER_ENV,
    persistBooking = async () => ({})
} = {}) {
    const Model = createMemoryModel();
    const attemptStore = createMemoryAttemptStore();
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
        attemptStore,
        env: bookingEnv,
        now: () => new Date(now()),
        createClientReference: () => 'RMLTEST00000000001',
        persistBooking
    });
    return { Model, attemptStore, offerCacheService, hotelbedsClient, hotelbedsBookingService, rateType };
}

async function withBookingServer({ offerCacheService, hotelbedsBookingService, run }) {
    const app = express();
    app.use(express.json());
    app.post('/api/v1/hotels/book', (req, res, next) => {
        if (req.get('x-api-key') !== TEST_API_KEY) {
            return res.status(403).json({ success: false, error: 'api_key_invalid' });
        }
        req.auth = { subject: 'test-fixture-owner' };
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

function bookingBody(services, publicOfferId = PUBLIC_OFFER_ID, overrides = {}, termsAccepted = true) {
    const record = services.Model.records.get(publicOfferId);
    return JSON.stringify({
        publicOfferId,
        guestDetails: GUEST_DETAILS,
        termsAccepted,
        acceptedTermsVersion: record?.termsVersion || '0'.repeat(64),
        ...overrides
    });
}

test('booking flow retrieves cache, rechecks the rate, maps the Hotelbeds payload, and sanitizes confirmation', async () => {
    const calls = [];
    const services = makeServices({ httpRequest: async request => {
        calls.push(request);
        if (request.url.endsWith('/checkrates')) {
            return { status: 200, data: checkRateResponse() };
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
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingIdentity.paymentType, 'AT_HOTEL');
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingTerms.rateCommentsResolved, true);
    assert.match(services.Model.records.get(PUBLIC_OFFER_ID).termsVersion, /^[a-f\d]{64}$/i);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).realm,
        hotelbedsScopeFrom({}, { testOnly: true }).realm);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingMetadata.checkOut, '2026-11-12');

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        const body = await response.json();

        assert.equal(response.status, 200, JSON.stringify(body));
        assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['checkrates', 'bookings']);
        assert.deepEqual(calls[0].data, { rooms: [{ rateKey: RATE_KEY }], upselling: false });
        assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).acceptedTermsVersion,
            services.Model.records.get(PUBLIC_OFFER_ID).termsVersion);
        assert.ok(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).termsAcceptedAt instanceof Date);
        assert.deepEqual(calls[1].data, {
            holder: { name: 'Ada', surname: 'Lovelace' },
            rooms: [{
                rateKey: RATE_KEY,
                paxes: [
                    { roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' },
                    { roomId: 1, type: 'AD', name: 'Charles', surname: 'Babbage' }
                ]
            }],
            tolerance: '0',
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
        assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'confirmed');
        assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).clientReference, 'RMLTEST00000000001');
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
                body: bookingBody(services, id)
            });
            assert.equal(response.status, 404);
        }
        now = new Date(NOW.getTime() + OFFER_TTL_MS);
        const expired = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        assert.equal(expired.status, 404);
    } });
    assert.equal(supplierCalls, 0);
});

test('a CheckRate price change blocks Booking and leaves the durable claim consumed', async () => {
    const calls = [];
    const services = makeServices({ httpRequest: async request => {
        calls.push(request);
        return { status: 200, data: checkRateResponse({ net: '101.00' }) };
    } });
    await seedOffer(services.offerCacheService);

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { success: false, error: 'booking_rate_changed' });
    } });
    assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['checkrates']);
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'preflight_failed');
});

test('a changed opaque CheckRate key is rejected even when the returned rate otherwise matches', async () => {
    const calls = [];
    const services = makeServices({ httpRequest: async request => {
        calls.push(request);
        return { status: 200, data: checkRateResponse({ rateKey: CHECKED_RATE_KEY }) };
    } });
    await seedOffer(services.offerCacheService);

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { success: false, error: 'booking_rate_key_changed' });
    } });
    assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['checkrates']);
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'preflight_failed');
});

test('a CheckRate condition change is checked separately from rate identity and blocks Booking', async () => {
    const calls = [];
    const services = makeServices({ httpRequest: async request => {
        calls.push(request);
        return { status: 200, data: checkRateResponse({
            rateComments: ['A deposit is due at check-in.']
        }) };
    } });
    await seedOffer(services.offerCacheService);

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { success: false, error: 'booking_rate_terms_changed' });
    } });
    assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['checkrates']);
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'preflight_failed');
});

test('an unknown booking outcome is quarantined to prevent duplicate supplier bookings', async () => {
    let bookingCalls = 0;
    let now = new Date(NOW);
    let offerLookups = 0;
    const services = makeServices({
        rateType: 'BOOKABLE',
        now: () => now,
        httpRequest: async () => {
            bookingCalls += 1;
            throw Object.assign(new Error('connection reset after request send'), { code: 'ECONNRESET' });
        }
    });
    await seedOffer(services.offerCacheService, normalizedOffer({ rateType: 'BOOKABLE' }));
    const getBookingOffer = services.offerCacheService.getBookingOffer;
    services.offerCacheService.getBookingOffer = async id => {
        offerLookups += 1;
        return getBookingOffer(id);
    };

    await withBookingServer({ ...services, run: async url => {
        const body = bookingBody(services);
        const first = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY }, body });
        assert.equal(first.status, 502);
        assert.deepEqual(await first.json(), { success: false, error: 'booking_outcome_unknown' });
        now = new Date(NOW.getTime() + OFFER_TTL_MS);
        services.hotelbedsBookingService = createHotelbedsBookingService({
            client: services.hotelbedsClient,
            attemptStore: services.attemptStore,
            env: SUPPLIER_ENV,
            now: () => now,
            persistBooking: async () => ({})
        });
        const second = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY }, body });
        assert.equal(second.status, 502);
        assert.deepEqual(await second.json(), { success: false, error: 'booking_outcome_unknown' });
    } });
    assert.equal(bookingCalls, 1);
    assert.equal(offerLookups, 1, 'a durable attempt must survive expiry of the offer cache');
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'outcome_unknown');
});

test('confirmed supplier result recovers local persistence without a duplicate Booking POST', async () => {
    let bookingCalls = 0;
    let persistenceCalls = 0;
    const persisted = [];
    const services = makeServices({
        rateType: 'BOOKABLE',
        httpRequest: async () => {
            bookingCalls += 1;
            return { status: 200, data: { booking: {
                reference: 'HBX-RECOVER-PERSISTENCE', status: 'CONFIRMED'
            } } };
        },
        persistBooking: async input => {
            persistenceCalls += 1;
            if (persistenceCalls === 1) throw new Error('local database temporarily unavailable');
            persisted.push(input);
            return { bookingReference: input.bookingReference };
        }
    });
    await seedOffer(services.offerCacheService, normalizedOffer({ rateType: 'BOOKABLE' }));

    await withBookingServer({ ...services, run: async url => {
        const send = () => fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        const first = await send();
        assert.equal(first.status, 503);
        assert.deepEqual(await first.json(), {
            success: false, error: 'booking_record_persistence_unknown'
        });
        assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'outcome_unknown');

        const retry = await send();
        assert.equal(retry.status, 200);
        assert.deepEqual(await retry.json(), {
            success: true,
            bookingReference: 'HBX-RECOVER-PERSISTENCE',
            status: 'CONFIRMED'
        });
    } });

    assert.equal(bookingCalls, 1);
    assert.equal(persistenceCalls, 2);
    assert.equal(persisted[0].ownerSubject, 'test-fixture-owner');
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'confirmed');
});

test('concurrent direct-booking deliveries consume one durable offer claim and send one Booking POST', async () => {
    let bookingCalls = 0;
    const services = makeServices({
        rateType: 'BOOKABLE',
        httpRequest: async () => {
            bookingCalls += 1;
            await new Promise(resolve => setImmediate(resolve));
            return { status: 200, data: { booking: {
                reference: 'HBX-CONCURRENT-DIRECT', status: 'CONFIRMED'
            } } };
        }
    });
    await seedOffer(services.offerCacheService, normalizedOffer({ rateType: 'BOOKABLE' }));

    await withBookingServer({ ...services, run: async url => {
        const body = bookingBody(services);
        const send = () => fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body
        });
        const [first, second] = await Promise.all([send(), send()]);
        assert.ok([200, 502].includes(first.status));
        assert.ok([200, 502].includes(second.status));
        for (const response of [first, second]) {
            const body = await response.json();
            if (response.status === 200) {
                assert.deepEqual(body, {
                    success: true, bookingReference: 'HBX-CONCURRENT-DIRECT', status: 'CONFIRMED'
                });
            } else {
                assert.deepEqual(body, { success: false, error: 'booking_outcome_unknown' });
            }
        }
    } });
    assert.equal(bookingCalls, 1);
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'confirmed');
});

test('failure to persist booking_processing prevents the Booking POST', async () => {
    const services = makeServices({
        rateType: 'BOOKABLE',
        httpRequest: async () => ({ status: 200, data: { booking: {
            reference: 'HBX-MUST-NOT-BOOK', status: 'CONFIRMED'
        } } })
    });
    const originalTransition = services.attemptStore.transition;
    let bookingCalls = 0;
    services.attemptStore.transition = async input => {
        if (input.expectedState === 'claimed' && input.nextState === 'booking_processing') {
            throw Object.assign(new Error('persistence unavailable'), {
                code: 'hotelbeds_booking_attempt_persistence_unknown', httpStatus: 503
            });
        }
        return originalTransition(input);
    };
    const originalCreateBooking = services.hotelbedsClient.createBooking;
    services.hotelbedsClient.createBooking = async request => {
        bookingCalls += 1;
        return originalCreateBooking(request);
    };
    await seedOffer(services.offerCacheService, normalizedOffer({ rateType: 'BOOKABLE' }));

    await withBookingServer({ ...services, run: async url => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
            body: bookingBody(services)
        });
        assert.equal(response.status, 503);
    } });
    assert.equal(bookingCalls, 0);
    assert.equal(services.attemptStore.recordsByOfferId.get(PUBLIC_OFFER_ID).state, 'claimed');
});

test('read-only BookingList reconciliation matches clientReference and never mutates an attempt', async () => {
    const clientReference = 'RMLRECONCILE000003';
    const attempt = {
        ...RECONCILIATION_SCOPE,
        ownerSubject: 'fixture-owner',
        provider: 'hotelbeds',
        origin: 'live',
        clientReference,
        claimedAt: new Date('2026-10-02T10:00:00.000Z'),
        state: 'outcome_unknown'
    };
    const queries = [];
    let writes = 0;
    const service = createHotelbedsBookingReconciliationService({
        env: SUPPLIER_ENV,
        now: () => new Date('2026-10-03T10:00:00.000Z'),
        attemptStore: {
            async getByClientReference(value, options) {
                assert.equal(value, clientReference);
                assert.equal(options.allowAnyOwner, true);
                return attempt;
            },
            async transition() { writes += 1; }
        },
        client: {
            async getBookingList(query) {
                queries.push(query);
                return { ok: true, data: { bookings: [{
                    reference: 'HBX-RECONCILED-003', clientReference, status: 'CONFIRMED'
                }] } };
            }
        }
    });

    assert.deepEqual(await service.reconcileByClientReference(clientReference), {
        state: 'found', clientReference,
        bookingReference: 'HBX-RECONCILED-003', bookingStatus: 'CONFIRMED'
    });
    assert.deepEqual(queries, [{
        start: '2026-10-02', end: '2026-10-03', filterType: 'CREATION', status: 'ALL',
        from: 1, to: 25, clientReference
    }]);
    assert.equal(attempt.state, 'outcome_unknown');
    assert.equal(writes, 0);
});

test('BookingList reconciliation reports an empty complete scan as not found yet', async () => {
    const clientReference = 'RMLRECONCILE000004';
    let writes = 0;
    const service = createHotelbedsBookingReconciliationService({
        env: SUPPLIER_ENV,
        now: () => new Date('2026-10-03T10:00:00.000Z'),
        attemptStore: {
            async getByClientReference() {
                return { ...RECONCILIATION_SCOPE, ownerSubject: 'fixture-owner', provider: 'hotelbeds', origin: 'live',
                    clientReference, claimedAt: new Date('2026-10-02T10:00:00.000Z') };
            },
            async transition() { writes += 1; }
        },
        client: {
            async getBookingList() {
                return { ok: true, data: { bookings: [] } };
            }
        }
    });

    assert.deepEqual(await service.reconcileByClientReference(clientReference), {
        state: 'not_found_yet', clientReference
    });
    assert.equal(writes, 0);
});

test('BookingList reconciliation returns ambiguous when bounded pages cannot prove the scan is complete', async () => {
    const clientReference = 'RMLRECONCILE000006';
    const requests = [];
    const service = createHotelbedsBookingReconciliationService({
        env: SUPPLIER_ENV,
        now: () => new Date('2026-10-03T10:00:00.000Z'),
        attemptStore: {
            async getByClientReference() {
                return { ...RECONCILIATION_SCOPE, ownerSubject: 'fixture-owner', provider: 'hotelbeds', origin: 'live',
                    clientReference, claimedAt: new Date('2026-10-02T10:00:00.000Z') };
            }
        },
        client: {
            async getBookingList(query) {
                requests.push(query);
                return { ok: true, data: { bookings: Array.from({ length: 25 }, (_item, index) => ({
                    reference: `HBX-BOUND-${query.from}-${index}`,
                    clientReference: index === 0 && query.from === 1 ? clientReference : 'OTHER',
                    status: 'CONFIRMED'
                })) } };
            }
        }
    });

    assert.deepEqual(await service.reconcileByClientReference(clientReference), {
        state: 'response_ambiguous', clientReference
    });
    assert.deepEqual(requests.map(query => [query.from, query.to]), [
        [1, 25], [26, 50], [51, 75], [76, 100], [101, 125]
    ]);
});

test('BookingList reconciliation refuses attempts outside the bounded lookback without a supplier request', async () => {
    const clientReference = 'RMLRECONCILE000005';
    let requests = 0;
    const service = createHotelbedsBookingReconciliationService({
        env: SUPPLIER_ENV,
        now: () => new Date('2026-10-03T10:00:00.000Z'),
        attemptStore: {
            async getByClientReference() {
                return { ...RECONCILIATION_SCOPE, ownerSubject: 'fixture-owner', provider: 'hotelbeds', origin: 'live',
                    clientReference, claimedAt: new Date('2026-08-01T10:00:00.000Z') };
            }
        },
        client: { async getBookingList() { requests += 1; return { ok: true, data: { bookings: { bookings: [] } } }; } }
    });

    assert.deepEqual(await service.reconcileByClientReference(clientReference), {
        state: 'lookback_exceeded', clientReference
    });
    assert.equal(requests, 0);
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
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS,
                termsAccepted: true, acceptedTermsVersion: '0'.repeat(64) })
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { success: false, error: 'api_key_invalid' });
    } });
    assert.equal(cacheLookups, 0);
});

test('direct booking requires the exact cached terms version before any supplier request or durable claim', async () => {
    let supplierCalls = 0;
    const services = makeServices({ httpRequest: async () => { supplierCalls += 1; return { status: 200, data: {} }; } });
    await seedOffer(services.offerCacheService);
    const termsVersion = services.Model.records.get(PUBLIC_OFFER_ID).termsVersion;
    await withBookingServer({ ...services, run: async url => {
        for (const body of [
            { publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS },
            { publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS,
                termsAccepted: true, acceptedTermsVersion: 'f'.repeat(64) },
            { publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS,
                termsAccepted: false, acceptedTermsVersion: termsVersion }
        ]) {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
                body: JSON.stringify(body)
            });
            assert.equal(response.status, 409);
            assert.deepEqual(await response.json(), { success: false, error: 'booking_terms_acceptance_required' });
        }
    } });
    assert.equal(supplierCalls, 0);
    assert.equal(services.attemptStore.recordsByOfferId.size, 0);
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
            body: bookingBody(services)
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
            body: bookingBody(services)
        });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { success: false, error: 'booking_payment_flow_required' });
    } });
    assert.equal(supplierCalls, 0);
    assert.equal(services.Model.records.get(PUBLIC_OFFER_ID).bookingState, 'available');
});