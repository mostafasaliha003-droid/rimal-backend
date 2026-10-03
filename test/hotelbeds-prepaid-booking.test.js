const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const CheckoutSession = require('../models/CheckoutSession');
const HotelbedsBookingAttempt = require('../models/HotelbedsBookingAttempt');
const { createHotelbedsBookingAttemptStore } = require('../services/hotelbedsBookingAttemptStore');
const { identityFromNormalizedOffer, termsFromNormalizedOffer } = require('../services/hotelbedsRateCheckService');
const { PREPAID_BOOKING_GATES, createHotelbedsPrepaidBookingService } = require('../services/hotelbedsPrepaidBookingService');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const INTENT_ID = 'pi_fixture_1234567890';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-02T12:00:00.000Z');
const CLIENT_REFERENCE = 'RMLTEST00000000001';

function normalizedBookingOffer() {
    return {
        provider: 'hotelbeds',
        providerHotelId: '74001',
        room: { providerCode: 'DBL.ST' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        availability: {
            rateType: 'RECHECK', rateClass: 'NOR', packaging: false,
            rateCommentsResolved: true
        },
        payment: { type: 'AT_WEB' },
        board: { supplierCode: 'BB' },
        price: { supplierAmount: { amount: '200.00', currency: 'EUR' } },
        cancellation: {
            schedule: [{
                startsAt: { utc: '2026-11-09T23:59:00.000Z' },
                penalty: { amount: '200.00', currency: 'EUR' }
            }]
        },
        promotions: [],
        rateComments: [],
        contractTerms: { rateCommentsResolved: true }
    };
}

const BOOKING_IDENTITY = identityFromNormalizedOffer(normalizedBookingOffer());
const BOOKING_TERMS = termsFromNormalizedOffer(normalizedBookingOffer());

function checkRateFixture({ net = '200.00', rateKey = 'opaque-hotelbeds-rate-key' } = {}) {
    return { ok: true, data: { hotel: {
        code: 74001,
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        currency: 'EUR',
        rooms: [{ code: 'DBL.ST', rates: [{
            rateKey,
            rateClass: 'NOR',
            rateType: 'BOOKABLE',
            paymentType: 'AT_WEB',
            net,
            packaging: false,
            boardCode: 'BB',
            rooms: 1,
            adults: 2,
            children: 0,
            cancellationPolicies: [{ amount: '200.00', from: '2026-11-10T00:59:00+01:00' }],
            promotions: [],
            rateComments: []
        }] }]
    } } };
}

function memoryAttemptStore() {
    const bySessionId = new Map();
    const byClientReference = new Map();
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
        bySessionId,
        async claim(input) {
            if (bySessionId.has(input.sessionId) || byClientReference.has(input.clientReference)) return null;
            const attempt = structuredClone(input);
            bySessionId.set(attempt.sessionId, attempt);
            byClientReference.set(attempt.clientReference, attempt);
            return attempt;
        },
        async getBySessionId(id) { return bySessionId.get(id) || null; },
        async getByClientReference(id) { return byClientReference.get(id) || null; },
        async transition({ attemptId, expectedState, nextState, fields = {} }) {
            const attempt = [...bySessionId.values()].find(item => item.attemptId === attemptId);
            if (!attempt || attempt.state !== expectedState || !nextStates[expectedState]?.has(nextState)) {
                throw Object.assign(new Error('hotelbeds_booking_attempt_state_conflict'), {
                    code: 'hotelbeds_booking_attempt_state_conflict', httpStatus: 409
                });
            }
            Object.assign(attempt, structuredClone(fields), { state: nextState });
            return attempt;
        }
    };
}

function sessionFixture(overrides = {}) {
    return {
        sessionId: SESSION_ID,
        publicOfferId: 'a'.repeat(64),
        provider: 'hotelbeds',
        offerOrigin: 'live',
        paymentProvider: 'ziina',
        paymentType: 'AT_WEB',
        paymentIntentId: INTENT_ID,
        paymentVerifiedAt: new Date(NOW),
        providerOfferRef: 'opaque-hotelbeds-rate-key',
        providerHotelCode: '74001',
        lockedNetPrice: '200.00',
        lockedNetCurrency: 'EUR',
        rateType: 'RECHECK',
        bookingIdentity: BOOKING_IDENTITY,
        bookingTerms: BOOKING_TERMS,
        offerExpiresAt: new Date(NOW.getTime() + 60_000),
        occupancy: { rooms: 1, adults: 2, children: 0 },
        guestDetailsEncrypted: { iv: 'a'.repeat(24), tag: 'b'.repeat(32), ciphertext: 'YQ==' },
        status: 'payment_verified',
        ...overrides
    };
}

function memoryModel(initial) {
    const record = structuredClone(initial);
    let claims = 0;
    function matches(filter) {
        return Object.entries(filter).every(([key, value]) => record[key] === value);
    }
    function query(execute) {
        const result = {
            select() { return this; },
            lean() { return this; },
            exec() { return Promise.resolve().then(execute); },
            then(resolve, reject) { return this.exec().then(resolve, reject); }
        };
        return result;
    }
    return {
        record,
        get claims() { return claims; },
        findOne(filter) {
            return query(() => matches(filter) ? structuredClone(record) : null);
        },
        findOneAndUpdate(filter, update) {
            return query(() => {
                if (!matches(filter)) return null;
                if (filter.status === 'payment_verified') claims += 1;
                Object.assign(record, structuredClone(update.$set || {}));
                return structuredClone(record);
            });
        }
    };
}

function approvedEnv() {
    return {
        ...Object.fromEntries(PREPAID_BOOKING_GATES.map(gate => [gate, 'true'])),
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test'
    };
}

function createService({
    Model = memoryModel(sessionFixture()),
    attemptStore = memoryAttemptStore(),
    env = approvedEnv(),
    client,
    now = () => new Date(NOW)
} = {}) {
    const bookingClient = client || {
        async checkRates() {
            return checkRateFixture();
        },
        async createBooking() {
            return { ok: true, httpStatus: 200, data: { booking: {
                reference: 'HBX-BOOKING-FIXTURE', status: 'CONFIRMED'
            } } };
        }
    };
    return {
        Model,
        attemptStore,
        client: bookingClient,
        service: createHotelbedsPrepaidBookingService({
            Model,
            attemptStore,
            env,
            client: bookingClient,
            now,
            createAttemptId: () => ATTEMPT_ID,
            createClientReference: () => CLIENT_REFERENCE,
            decryptGuests: () => ({
                firstName: 'Ada',
                lastName: 'Lovelace',
                rooms: [{ guests: [
                    { firstName: 'Ada', lastName: 'Lovelace', is_child: false },
                    { firstName: 'Charles', lastName: 'Babbage', is_child: false }
                ] }]
            }),
            testOnly: true,
            ensureDatabaseReady: async () => {}
        })
    };
}

test('CheckoutSession declares isolated prepaid-booking state and private correlation fields', () => {
    const statuses = CheckoutSession.schema.path('status').enumValues;
    assert.deepEqual(statuses, [
        'awaiting_payment', 'payment_verified', 'booking_preflight', 'booking_processing',
        'booking_pending', 'confirmed', 'outcome_unknown', 'refund_review'
    ]);
    assert.equal(CheckoutSession.schema.path('paymentProvider').options.select, undefined);
    assert.deepEqual(CheckoutSession.schema.path('paymentProvider').enumValues, ['mock', 'ziina']);
    assert.deepEqual(CheckoutSession.schema.path('paymentType').enumValues, ['AT_WEB']);
    for (const field of ['bookingClientReference', 'bookingRateKey', 'hotelbedsBookingStatus']) {
        assert.equal(CheckoutSession.schema.path(field).options.select, false);
    }
    assert.equal(CheckoutSession.schema.path('bookingIdentity').options.select, false);
    assert.equal(CheckoutSession.schema.path('bookingTerms').options.select, false);
    assert.ok(CheckoutSession.schema.indexes().some(([keys, options]) =>
        keys.bookingClientReference === 1 && options.unique === true && options.sparse === true));
});

test('HotelbedsBookingAttempt scopes durable uniqueness to direct offers and prepaid sessions', () => {
    const indexes = HotelbedsBookingAttempt.schema.indexes();
    assert.ok(indexes.some(([keys, options]) => keys.scope === 1 && keys.publicOfferId === 1
        && options.unique === true && options.partialFilterExpression?.scope === 'direct'));
    assert.ok(indexes.some(([keys, options]) => keys.scope === 1 && keys.sessionId === 1
        && options.unique === true && options.partialFilterExpression?.scope === 'prepaid'));
    for (const field of ['scope', 'sessionId', 'attemptId', 'clientReference', 'rateKey', 'rateIdentity', 'rateTerms']) {
        if (HotelbedsBookingAttempt.schema.path(field).options.select !== undefined) {
            assert.equal(HotelbedsBookingAttempt.schema.path(field).options.select, false);
        }
    }
});

test('attempt store persists a validated Mongoose document with majority write concern', async () => {
    const collection = HotelbedsBookingAttempt.collection;
    const previousInsertOne = collection.insertOne;
    const writes = [];
    collection.insertOne = async (document, options) => {
        writes.push({ document, options });
        return { acknowledged: true, insertedId: document._id };
    };
    try {
        const store = createHotelbedsBookingAttemptStore({
            Model: HotelbedsBookingAttempt,
            database: {},
            testOnly: true,
            ensureDatabaseReady: async () => {}
        });
        const attempt = await store.claim({
            scope: 'direct',
            publicOfferId: 'c'.repeat(64),
            attemptId: ATTEMPT_ID,
            clientReference: CLIENT_REFERENCE,
            rateKey: 'private-rate-key-mongoose-fixture',
            rateType: 'RECHECK',
            rateIdentity: BOOKING_IDENTITY,
            rateTerms: BOOKING_TERMS,
            state: 'claimed',
            claimedAt: new Date(NOW)
        });
        assert.ok(attempt instanceof HotelbedsBookingAttempt);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].document.scope, 'direct');
        assert.equal(writes[0].document.publicOfferId, 'c'.repeat(64));
        assert.equal(writes[0].options.writeConcern.w, 'majority');
        assert.equal(writes[0].options.writeConcern.j, true);
        assert.equal(writes[0].options.writeConcern.wtimeout, 10000);
    } finally {
        collection.insertOne = previousInsertOne;
    }
});

test('prepaid booking fails closed until every independent credit-line gate is approved', async () => {
    let supplierCalls = 0;
    const Model = memoryModel(sessionFixture());
    const env = approvedEnv();
    delete env.HOTELBEDS_CREDIT_LINE_APPROVED;
    const { service } = createService({
        Model,
        env,
        client: {
            async checkRates() { supplierCalls += 1; throw new Error('must_not_call'); },
            async createBooking() { supplierCalls += 1; throw new Error('must_not_call'); }
        }
    });
    await assert.rejects(service.confirmBooking({ sessionId: SESSION_ID }), error =>
        error.code === 'hotelbeds_prepaid_credit_line_booking_disabled' && error.httpStatus === 503);
    assert.equal(supplierCalls, 0);
    assert.equal(Model.record.status, 'payment_verified');
});

test('prepaid connector requires persisted Ziina payment verification and AT_WEB identity', async () => {
    for (const overrides of [
        { status: 'awaiting_payment' },
        { paymentProvider: 'mock' },
        { paymentType: 'AT_HOTEL' },
        { paymentVerifiedAt: null }
    ]) {
        let supplierCalls = 0;
        const Model = memoryModel(sessionFixture(overrides));
        const { service, client } = createService({
            Model,
            client: {
                async checkRates() { supplierCalls += 1; throw new Error('must_not_call'); },
                async createBooking() { supplierCalls += 1; throw new Error('must_not_call'); }
            }
        });
        await assert.rejects(service.confirmBooking({ sessionId: SESSION_ID }), error =>
            error.code === 'hotelbeds_prepaid_booking_session_invalid');
        assert.equal(supplierCalls, 0);
        assert.equal(Model.record.status, overrides.status || 'payment_verified');
    }
});

test('prepaid Booking uses the Hotelbeds B2B no-card allowlist and durably claims once', async () => {
    const Model = memoryModel(sessionFixture());
    const attemptStore = memoryAttemptStore();
    const requests = [];
    const checks = [];
    const { service } = createService({
        Model,
        attemptStore,
        client: {
            async checkRates(payload) {
                checks.push(payload);
                return checkRateFixture();
            },
            async createBooking(payload) {
                requests.push(payload);
                assert.equal(Model.record.status, 'booking_processing');
                assert.equal(Model.record.bookingClientReference, CLIENT_REFERENCE);
                return { ok: true, httpStatus: 200, data: { booking: {
                    reference: 'HBX-BOOKING-FIXTURE', status: 'CONFIRMED'
                } } };
            }
        }
    });

    const result = await service.confirmBooking({ sessionId: SESSION_ID });
    assert.deepEqual(checks, [{ rooms: [{ rateKey: 'opaque-hotelbeds-rate-key' }], upselling: false }]);
    assert.deepEqual(requests, [{
        holder: { name: 'Ada', surname: 'Lovelace' },
        rooms: [{
            rateKey: 'opaque-hotelbeds-rate-key',
            paxes: [
                { roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' },
                { roomId: 1, type: 'AD', name: 'Charles', surname: 'Babbage' }
            ]
        }],
        tolerance: '0',
        clientReference: CLIENT_REFERENCE
    }]);
    assert.equal(Object.hasOwn(requests[0], 'paymentType'), false);
    assert.equal(Object.hasOwn(requests[0], 'paymentData'), false);
    assert.equal(JSON.stringify(requests[0]).toLowerCase().includes('card'), false);
    assert.equal(result.status, 'confirmed');
    assert.equal(Model.record.bookingReference, 'HBX-BOOKING-FIXTURE');
    assert.equal(Model.record.bookingClientReference, CLIENT_REFERENCE);
    assert.equal(Model.record.hotelbedsBookingStatus, 'CONFIRMED');
    const duplicate = await service.confirmBooking({ sessionId: SESSION_ID });
    assert.deepEqual(duplicate, { sessionId: SESSION_ID, status: 'confirmed', duplicate: true });
    assert.equal(requests.length, 1);
    assert.equal(Model.claims, 1);
    assert.equal(attemptStore.bySessionId.get(SESSION_ID).state, 'confirmed');
});

test('concurrent prepaid-booking deliveries result in exactly one Hotelbeds POST', async () => {
    const Model = memoryModel(sessionFixture());
    const attemptStore = memoryAttemptStore();
    let bookingCalls = 0;
    const { service } = createService({
        Model,
        attemptStore,
        client: {
            async checkRates() {
                return checkRateFixture();
            },
            async createBooking() {
                bookingCalls += 1;
                await new Promise(resolve => setImmediate(resolve));
                return { ok: true, httpStatus: 200, data: { booking: {
                    reference: 'HBX-BOOKING-FIXTURE', status: 'CONFIRMED'
                } } };
            }
        }
    });
    const results = await Promise.all([
        service.confirmBooking({ sessionId: SESSION_ID }),
        service.confirmBooking({ sessionId: SESSION_ID })
    ]);
    assert.equal(bookingCalls, 1);
    assert.equal(Model.claims, 1);
    assert.deepEqual(results.map(item => item.status).sort(), ['confirmed', 'outcome_unknown'].sort());
    assert.equal(attemptStore.bySessionId.get(SESSION_ID).state, 'confirmed');
});

test('rate change after Ziina payment enters refund review without creating a reservation', async () => {
    const Model = memoryModel(sessionFixture());
    const attemptStore = memoryAttemptStore();
    let bookingCalls = 0;
    const { service } = createService({
        Model,
        attemptStore,
        client: {
            async checkRates() {
                return checkRateFixture({ net: '201.00' });
            },
            async createBooking() { bookingCalls += 1; }
        }
    });
    const result = await service.confirmBooking({ sessionId: SESSION_ID });
    assert.deepEqual(result, { sessionId: SESSION_ID, status: 'refund_review', duplicate: false });
    assert.equal(Model.record.status, 'refund_review');
    assert.equal(Model.record.lastError, 'booking_preflight_failed');
    assert.equal(bookingCalls, 0);
    assert.equal(attemptStore.bySessionId.get(SESSION_ID).state, 'preflight_failed');
});

test('transport timeout and ambiguous Hotelbeds outcomes are quarantined and never retried', async () => {
    for (const outcome of [
        { error: Object.assign(new Error('timeout'), { code: 'hotelbeds_request_timeout', outcomeUnknown: true }) },
        { response: { ok: false, httpStatus: 500, data: { error: 'supplier_error' } } }
    ]) {
        const Model = memoryModel(sessionFixture());
        const attemptStore = memoryAttemptStore();
        let bookingCalls = 0;
        const { service, client } = createService({
            Model,
            attemptStore,
            client: {
                async checkRates() {
                    return checkRateFixture();
                },
                async createBooking() {
                    bookingCalls += 1;
                    if (outcome.error) throw outcome.error;
                    return outcome.response;
                }
            }
        });
        const first = await service.confirmBooking({ sessionId: SESSION_ID });
        assert.equal(first.status, 'outcome_unknown');
        const restarted = createService({ Model, attemptStore, client, now: () => new Date(NOW) }).service;
        const duplicate = await restarted.confirmBooking({ sessionId: SESSION_ID });
        assert.equal(duplicate.status, 'outcome_unknown');
        assert.equal(duplicate.duplicate, true);
        assert.equal(bookingCalls, 1);
        assert.equal(attemptStore.bySessionId.get(SESSION_ID).state, 'outcome_unknown');
    }
});

test('Hotelbeds ON_REQUEST and PENDING references stay pending and are not customer confirmations', async () => {
    for (const status of ['ON_REQUEST', 'PENDING']) {
        const Model = memoryModel(sessionFixture({ rateType: 'BOOKABLE' }));
        const attemptStore = memoryAttemptStore();
        const { service } = createService({
            Model,
            attemptStore,
            client: {
                async checkRates() { throw new Error('BOOKABLE must not recheck'); },
                async createBooking() {
                    return { ok: true, httpStatus: 200, data: { booking: {
                        reference: 'HBX-PENDING-FIXTURE', status
                    } } };
                }
            }
        });
        const result = await service.confirmBooking({ sessionId: SESSION_ID });
        assert.equal(result.status, 'booking_pending');
        assert.equal(Model.record.hotelbedsBookingStatus, status);
        assert.equal(Model.record.confirmedAt, undefined);
        const duplicate = await service.confirmBooking({ sessionId: SESSION_ID });
        assert.equal(duplicate.status, 'booking_pending');
        assert.equal(duplicate.duplicate, true);
        assert.equal(attemptStore.bySessionId.get(SESSION_ID).state, 'booking_pending');
    }
});

test('a database error while persisting the one-shot claim never calls Hotelbeds', async () => {
    const Model = memoryModel(sessionFixture());
    const attemptStore = memoryAttemptStore();
    const originalFindOneAndUpdate = Model.findOneAndUpdate;
    Model.findOneAndUpdate = (filter, update) => {
        if (filter.status === 'payment_verified') {
            return {
                select() { return this; },
                lean() { return this; },
                then(_resolve, reject) { return Promise.reject(new Error('database unavailable')).then(_resolve, reject); }
            };
        }
        return originalFindOneAndUpdate.call(Model, filter, update);
    };
    let supplierCalls = 0;
    const { service } = createService({
        Model,
        attemptStore,
        client: {
            async checkRates() { supplierCalls += 1; throw new Error('must_not_call'); },
            async createBooking() { supplierCalls += 1; throw new Error('must_not_call'); }
        }
    });
    await assert.rejects(service.confirmBooking({ sessionId: SESSION_ID }), error =>
        error.code === 'checkout_database_unavailable' && error.httpStatus === 503);
    assert.equal(supplierCalls, 0);
    assert.equal(attemptStore.bySessionId.get(SESSION_ID).state, 'preflight_failed');
});