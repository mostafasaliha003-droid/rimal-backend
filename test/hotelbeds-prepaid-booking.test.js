const { test } = require('node:test');
const assert = require('node:assert/strict');
const CheckoutSession = require('../models/CheckoutSession');
const { PREPAID_BOOKING_GATES, createHotelbedsPrepaidBookingService } = require('../services/hotelbedsPrepaidBookingService');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const INTENT_ID = 'pi_fixture_1234567890';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-02T12:00:00.000Z');
const CLIENT_REFERENCE = 'RMLTEST00000000001';

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

function createService({ Model = memoryModel(sessionFixture()), env = approvedEnv(), client, now = () => new Date(NOW) } = {}) {
    return {
        Model,
        service: createHotelbedsPrepaidBookingService({
            Model,
            env,
            client: client || {
                async checkRates() {
                    return { ok: true, data: { hotel: { rooms: [{ rates: [{
                        rateKey: 'opaque-hotelbeds-rate-key',
                        rateType: 'BOOKABLE',
                        paymentType: 'AT_WEB',
                        net: '200.00',
                        currency: 'EUR'
                    }] }] } } };
                },
                async createBooking() {
                    return { ok: true, httpStatus: 200, data: { booking: {
                        reference: 'HBX-BOOKING-FIXTURE', status: 'CONFIRMED'
                    } } };
                }
            },
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
    assert.ok(CheckoutSession.schema.indexes().some(([keys, options]) =>
        keys.bookingClientReference === 1 && options.unique === true && options.sparse === true));
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
        const { service } = createService({
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
    const requests = [];
    const checks = [];
    const { service } = createService({
        Model,
        client: {
            async checkRates(payload) {
                checks.push(payload);
                return { ok: true, data: { hotel: { rooms: [{ rates: [{
                    rateKey: 'opaque-hotelbeds-rate-key', rateType: 'BOOKABLE',
                    paymentType: 'AT_WEB', net: '200.00', currency: 'EUR'
                }] }] } } };
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
    assert.deepEqual(checks, [{ rooms: [{ rateKey: 'opaque-hotelbeds-rate-key' }] }]);
    assert.deepEqual(requests, [{
        holder: { name: 'Ada', surname: 'Lovelace' },
        rooms: [{
            rateKey: 'opaque-hotelbeds-rate-key',
            paxes: [
                { roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' },
                { roomId: 1, type: 'AD', name: 'Charles', surname: 'Babbage' }
            ]
        }],
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
});

test('concurrent prepaid-booking deliveries result in exactly one Hotelbeds POST', async () => {
    const Model = memoryModel(sessionFixture());
    let bookingCalls = 0;
    const { service } = createService({
        Model,
        client: {
            async checkRates() {
                return { ok: true, data: { hotel: { rooms: [{ rates: [{
                    rateKey: 'opaque-hotelbeds-rate-key', rateType: 'BOOKABLE',
                    paymentType: 'AT_WEB', net: '200.00', currency: 'EUR'
                }] }] } } };
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
    assert.deepEqual(results.map(item => item.status), ['confirmed', 'booking_preflight']);
});

test('rate change after Ziina payment enters refund review without creating a reservation', async () => {
    const Model = memoryModel(sessionFixture());
    let bookingCalls = 0;
    const { service } = createService({
        Model,
        client: {
            async checkRates() {
                return { ok: true, data: { hotel: { rooms: [{ rates: [{
                    rateKey: 'opaque-hotelbeds-rate-key', rateType: 'BOOKABLE',
                    paymentType: 'AT_WEB', net: '201.00', currency: 'EUR'
                }] }] } } };
            },
            async createBooking() { bookingCalls += 1; }
        }
    });
    const result = await service.confirmBooking({ sessionId: SESSION_ID });
    assert.equal(result.status, 'refund_review');
    assert.equal(Model.record.lastError, 'booking_rate_changed_after_payment');
    assert.equal(bookingCalls, 0);
});

test('transport timeout and ambiguous Hotelbeds outcomes are quarantined and never retried', async () => {
    for (const outcome of [
        { error: Object.assign(new Error('timeout'), { code: 'hotelbeds_request_timeout', outcomeUnknown: true }) },
        { response: { ok: false, httpStatus: 500, data: { error: 'supplier_error' } } }
    ]) {
        const Model = memoryModel(sessionFixture());
        let bookingCalls = 0;
        const { service } = createService({
            Model,
            client: {
                async checkRates() {
                    return { ok: true, data: { hotel: { rooms: [{ rates: [{
                        rateKey: 'opaque-hotelbeds-rate-key', rateType: 'BOOKABLE',
                        paymentType: 'AT_WEB', net: '200.00', currency: 'EUR'
                    }] }] } } };
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
        const duplicate = await service.confirmBooking({ sessionId: SESSION_ID });
        assert.equal(duplicate.status, 'outcome_unknown');
        assert.equal(duplicate.duplicate, true);
        assert.equal(bookingCalls, 1);
    }
});

test('Hotelbeds ON_REQUEST and PENDING references stay pending and are not customer confirmations', async () => {
    for (const status of ['ON_REQUEST', 'PENDING']) {
        const Model = memoryModel(sessionFixture({ rateType: 'BOOKABLE' }));
        const { service } = createService({
            Model,
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
    }
});

test('a database error while persisting the one-shot claim never calls Hotelbeds', async () => {
    const Model = memoryModel(sessionFixture());
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
        client: {
            async checkRates() { supplierCalls += 1; throw new Error('must_not_call'); },
            async createBooking() { supplierCalls += 1; throw new Error('must_not_call'); }
        }
    });
    await assert.rejects(service.confirmBooking({ sessionId: SESSION_ID }), error =>
        error.code === 'checkout_database_unavailable' && error.httpStatus === 503);
    assert.equal(supplierCalls, 0);
});