const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const CheckoutSession = require('../models/CheckoutSession');
const { OFFER_TTL_MS } = require('../services/offerCacheService');
const {
    CHECKOUT_GATES,
    createCheckoutSessionService,
    decryptGuestDetails
} = require('../services/checkoutSessionService');
const createCheckoutSessionController = require('../controllers/checkoutSessionController');
const createCheckoutSessionRouter = require('../services/checkoutSessionRoutes');
const { createHotelbedsMockCheckoutBookingService } = require('../services/hotelbedsMockCheckoutBookingService');
const { createMockHotelCheckoutPaymentController } = require('../controllers/mockHotelCheckoutPaymentController');
const { hotelbedsScopeFrom } = require('../services/hotelbedsScope');
const {
    createMockWebhookSignature,
    createZiinaWebhookHandler
} = require('../services/ziinaWebhookHandler');

const NOW = new Date('2026-10-01T12:00:00.000Z');
const PUBLIC_OFFER_ID = 'a'.repeat(64);
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const PAYMENT_INTENT_ID = 'mock_11111111222243338444555555555555';
const ENCRYPTION_KEY = 'ab'.repeat(32);
const WEBHOOK_SECRET = 'checkout-mock-webhook-secret-'.padEnd(40, 'x');
const TERMS_VERSION = 'e'.repeat(64);
const FIXTURE_SCOPE = hotelbedsScopeFrom({}, { testOnly: true });
const GUEST_DETAILS = Object.freeze({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    phone: '+971501234567',
    rooms: [{ guests: [
        { firstName: 'Ada', lastName: 'Lovelace', is_child: false },
        { firstName: 'Charles', lastName: 'Babbage', is_child: false }
    ] }]
});

function approvedEnv() {
    return {
        ...Object.fromEntries(CHECKOUT_GATES.map(gate => [gate, 'true'])),
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        PAYMENT_BOOKING_ENCRYPTION_KEY: ENCRYPTION_KEY,
        ZIINA_MOCK_WEBHOOK_SECRET: WEBHOOK_SECRET
    };
}

function activeOffer({ paymentType = 'AT_WEB', rateType = 'RECHECK', expiresAt = new Date(NOW.getTime() + OFFER_TTL_MS) } = {}) {
    return {
        publicOfferId: PUBLIC_OFFER_ID,
        provider: 'hotelbeds',
        origin: 'mock_fixture',
        ...FIXTURE_SCOPE,
        providerHotelCode: '74001',
        opaqueToken: 'private-rate-key-fixture',
        lockedNetPrice: '200.00',
        currency: 'EUR',
        lockedSellAmount: '495.25',
        lockedSellCurrency: 'AED',
        termsVersion: TERMS_VERSION,
        paymentType,
        rateType,
        roomCount: 1,
        adultCount: 2,
        childCount: 0,
        expiresAt
    };
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function matches(record, filter) {
    return Boolean(record && Object.entries(filter).every(([key, expected]) => {
        if (expected && typeof expected === 'object' && '$gt' in expected) {
            return new Date(record[key]).getTime() > new Date(expected.$gt).getTime();
        }
        return record[key] === expected;
    }));
}

class MemoryQuery {
    constructor(execute) {
        this.executeQuery = execute;
    }
    select() { return this; }
    lean() { return this; }
    exec() { return Promise.resolve().then(this.executeQuery); }
    then(resolve, reject) { return this.exec().then(resolve, reject); }
}

class MemoryCheckoutSessionModel {
    static records = new Map();
    static reset() { this.records.clear(); }

    static async create(document) {
        if ([...this.records.values()].some(record =>
            record.sessionId === document.sessionId
            || record.idempotencyKeyHash === document.idempotencyKeyHash)) {
            throw Object.assign(new Error('duplicate key'), { code: 11000 });
        }
        const record = { ...clone(document), _id: document.sessionId, createdAt: document.createdAt || new Date(NOW), updatedAt: new Date(NOW) };
        this.records.set(record.sessionId, record);
        return clone(record);
    }

    static findOne(filter) {
        return new MemoryQuery(() => clone([...this.records.values()].find(record => matches(record, filter)) || null));
    }

    static findOneAndUpdate(filter, update) {
        return new MemoryQuery(() => {
            const record = [...this.records.values()].find(value => matches(value, filter));
            if (!record) return null;
            Object.assign(record, clone(update.$set || {}));
            for (const key of Object.keys(update.$unset || {})) delete record[key];
            record.updatedAt = new Date(NOW);
            return clone(record);
        });
    }

    static async updateOne(filter, update) {
        const record = [...this.records.values()].find(value => matches(value, filter));
        if (!record) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(record, clone(update.$set || {}));
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return { matchedCount: 1, modifiedCount: 1 };
    }
}

function makeCheckoutService({
    env = approvedEnv(),
    Model = MemoryCheckoutSessionModel,
    now = () => NOW,
    offer = activeOffer(),
    createPaymentIntent = ({ sessionId }) => ({
        id: PAYMENT_INTENT_ID,
        paymentUrl: `https://pay.example.test/mock/${sessionId}`
    })
} = {}) {
    const calls = { lookups: 0, intents: 0 };
    const service = createCheckoutSessionService({
        Model,
        env,
        now,
        createSessionId: () => SESSION_ID,
        createPaymentIntent: async input => {
            calls.intents += 1;
            return createPaymentIntent(input);
        },
        testOnly: true,
        ensureDatabaseReady: async () => {},
        offerCacheService: {
            async getCheckoutOffer(id) {
                calls.lookups += 1;
                assert.equal(id, PUBLIC_OFFER_ID);
                return offer;
            }
        }
    });
    return { service, calls, env, Model };
}

function createTestWebhookHandler(options) {
    return createZiinaWebhookHandler({
        ...options,
        testOnly: true,
        ensureDatabaseReady: async () => {}
    });
}

function paymentEvent({ sessionId = SESSION_ID, intentId = PAYMENT_INTENT_ID, amount = 49525, currency = 'AED' } = {}) {
    return {
        event: 'payment_intent.status.updated',
        data: { id: intentId, sessionId, status: 'completed', amount, currency }
    };
}

function bookingFixture(context, { result, error } = {}) {
    let calls = 0;
    const bookingService = {
        async confirmBooking(input) {
            calls += 1;
            assert.equal(input.session.publicOfferId, PUBLIC_OFFER_ID);
            assert.equal(input.guestDetails.email, GUEST_DETAILS.email);
            assert.equal(input.session.providerOfferRef, 'private-rate-key-fixture');
            assert.equal(input.session.totalAmount, 49525);
            assert.equal(input.session.rateType, 'RECHECK');
            if (error) throw error;
            return result || input.createBookingReference(input.session);
        }
    };
    return { bookingService, get calls() { return calls; } };
}

async function withCheckoutHttpServer(app, run, context) {
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.once('error', reject);
    });
    context.after(() => new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())));
    return run(`http://127.0.0.1:${server.address().port}`);
}

test('CheckoutSession is durable, strict, and has no TTL index', () => {
    assert.equal(CheckoutSession.modelName, 'CheckoutSession');
    assert.ok(CheckoutSession.schema.path('sessionId'));
    assert.ok(CheckoutSession.schema.path('publicOfferId'));
    assert.ok(CheckoutSession.schema.path('providerOfferRef'));
    assert.equal(CheckoutSession.schema.path('providerOfferRef').options.select, false);
    assert.equal(CheckoutSession.schema.path('acceptedTermsVersion').options.select, false);
    assert.equal(CheckoutSession.schema.path('termsAcceptedAt').options.select, false);
    assert.ok(CheckoutSession.schema.path('totalAmount'));
    assert.ok(CheckoutSession.schema.path('guestDetailsEncrypted'));
    assert.ok(CheckoutSession.schema.path('status'));
    const statuses = CheckoutSession.schema.path('status').enumValues;
    assert.deepEqual(statuses, [
        'awaiting_payment', 'payment_verified', 'booking_preflight', 'booking_processing',
        'booking_pending', 'confirmed', 'outcome_unknown', 'refund_review'
    ]);
    assert.deepEqual(CheckoutSession.schema.path('paymentProvider').enumValues, ['mock', 'ziina']);
    assert.deepEqual(CheckoutSession.schema.path('paymentType').enumValues, ['AT_WEB']);
    for (const field of ['bookingClientReference', 'bookingRateKey', 'hotelbedsBookingStatus']) {
        assert.equal(CheckoutSession.schema.path(field).options.select, false);
    }
    assert.ok(CheckoutSession.schema.indexes().some(([keys, options]) =>
        keys.bookingClientReference === 1 && options.unique === true && options.sparse === true));
    assert.equal(CheckoutSession.schema.options.strict, 'throw');
    assert.equal(CheckoutSession.schema.indexes().some(([, options]) =>
        Object.hasOwn(options || {}, 'expireAfterSeconds')), false);
    const valid = new CheckoutSession({
        ...FIXTURE_SCOPE,
        ownerSubject: 'test-fixture-owner',
        sessionId: SESSION_ID,
        publicOfferId: PUBLIC_OFFER_ID,
        provider: 'hotelbeds',
        offerOrigin: 'mock_fixture',
        providerOfferRef: 'private-rate-key',
        providerHotelCode: '74001',
        totalAmount: 49525,
        currency: 'AED',
        offerExpiresAt: new Date(NOW.getTime() + OFFER_TTL_MS),
        paymentProvider: 'mock',
        paymentType: 'AT_WEB',
        acceptedTermsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(NOW),
        guestDetailsEncrypted: { iv: 'a'.repeat(24), tag: 'b'.repeat(32), ciphertext: 'YQ==' },
        rateType: 'RECHECK',
        lockedNetPrice: '200.00',
        lockedNetCurrency: 'EUR',
        occupancy: { rooms: 1, adults: 2, children: 0 },
        idempotencyKeyHash: 'c'.repeat(64),
        requestFingerprint: 'd'.repeat(64),
        status: 'awaiting_payment'
    });
    assert.equal(valid.validateSync(), undefined);
    const withoutTermsAcceptance = new CheckoutSession({
        ...FIXTURE_SCOPE,
        ownerSubject: 'test-fixture-owner',
        sessionId: '22222222-3333-4333-8333-222222222222',
        publicOfferId: PUBLIC_OFFER_ID,
        provider: 'hotelbeds',
        offerOrigin: 'mock_fixture',
        providerOfferRef: 'private-rate-key',
        providerHotelCode: '74001',
        totalAmount: 49525,
        currency: 'AED',
        offerExpiresAt: new Date(NOW.getTime() + OFFER_TTL_MS),
        paymentProvider: 'mock',
        paymentType: 'AT_WEB',
        guestDetailsEncrypted: { iv: 'a'.repeat(24), tag: 'b'.repeat(32), ciphertext: 'YQ==' },
        rateType: 'RECHECK',
        lockedNetPrice: '200.00',
        lockedNetCurrency: 'EUR',
        occupancy: { rooms: 1, adults: 2, children: 0 },
        idempotencyKeyHash: 'c'.repeat(64),
        requestFingerprint: 'd'.repeat(64),
        status: 'awaiting_payment'
    });
    assert.equal(withoutTermsAcceptance.validateSync().errors.acceptedTermsVersion.kind, 'required');
    assert.throws(() => new CheckoutSession({ unexpected: true }), /not in schema/);
});

test('checkout creates a server-priced mock intent, encrypts guests, and is idempotent', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, calls } = makeCheckoutService();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/hotels', createCheckoutSessionRouter({
        controller: createCheckoutSessionController({ service }),
        statusController: createCheckoutSessionController.createStatusController({ service }),
        requireUser: (req, _res, next) => { req.auth = { subject: 'test-fixture-owner' }; next(); },
        bookingLimiter: (_req, _res, next) => next()
    }));

    await withCheckoutHttpServer(app, async baseUrl => {
        const request = (acceptedTermsVersion = activeOffer().termsVersion) => fetch(`${baseUrl}/api/v1/hotels/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': 'checkout-test-idempotency-0001'
            },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS,
                termsAccepted: true, acceptedTermsVersion })
        });
        const first = await request();
        const body = await first.json();
        assert.equal(first.status, 201);
        assert.equal(first.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
        assert.equal(body.success, true);
        assert.equal(body.sessionId, SESSION_ID);
        assert.equal(body.status, 'awaiting_payment');
        assert.equal(body.totalAmount, 49525);
        assert.equal(body.currency, 'AED');

        const staleReplay = await request('f'.repeat(64));
        assert.equal(staleReplay.status, 409);
        assert.equal((await staleReplay.json()).error, 'checkout_terms_acceptance_required');
        assert.equal(calls.intents, 1, 'stale terms replay must not create another payment intent');
        assert.equal(body.payment_url, `https://pay.example.test/mock/${SESSION_ID}`);
        assert.equal(JSON.stringify(body).includes('private-rate-key-fixture'), false);
        assert.equal(JSON.stringify(body).includes(GUEST_DETAILS.email), false);

        const statusResponse = await fetch(`${baseUrl}/api/v1/hotels/checkout/${body.sessionId}`, {
            headers: { Authorization: `Bearer ${body.access_token}` }
        });
        assert.equal(statusResponse.status, 200);
        const statusBody = await statusResponse.json();
        assert.deepEqual({
            success: statusBody.success,
            sessionId: statusBody.sessionId,
            status: statusBody.status,
            totalAmount: statusBody.totalAmount,
            currency: statusBody.currency,
            payment_url: statusBody.payment_url
        }, {
            success: true,
            sessionId: body.sessionId,
            status: 'awaiting_payment',
            totalAmount: 49525,
            currency: 'AED',
            payment_url: body.payment_url
        });

        const session = MemoryCheckoutSessionModel.records.get(SESSION_ID);
        assert.equal(session.totalAmount, 49525);
        assert.equal(session.lockedNetPrice, '200.00');
        assert.equal(session.lockedNetCurrency, 'EUR');
        assert.equal(session.acceptedTermsVersion, TERMS_VERSION);
        assert.ok(session.termsAcceptedAt instanceof Date);
        assert.equal(session.providerOfferRef, 'private-rate-key-fixture');
        assert.equal(Object.hasOwn(session.guestDetailsEncrypted, 'email'), false);
        assert.deepEqual(decryptGuestDetails(session.guestDetailsEncrypted, approvedEnv()), GUEST_DETAILS);

        const replay = await request();
        const replayBody = await replay.json();
        assert.equal(replay.status, 201);
        assert.equal(replayBody.sessionId, body.sessionId);
        assert.equal(calls.intents, 1);
    }, context);
});

test('checkout rejects pay-at-hotel rates, missing final AED sell price, and unapproved gates', async context => {
    MemoryCheckoutSessionModel.reset();
    const atHotelOffer = activeOffer({ paymentType: 'AT_HOTEL' });
    const atHotel = makeCheckoutService({ offer: atHotelOffer });
    await assert.rejects(atHotel.service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: atHotelOffer.termsVersion, idempotencyKey: 'checkout-test-idempotency-0002'
    }), error => error.code === 'checkout_payment_flow_unsupported');

    const noSellPriceOffer = { ...activeOffer(), lockedSellAmount: null };
    const noSellPrice = makeCheckoutService({ offer: noSellPriceOffer });
    await assert.rejects(noSellPrice.service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: noSellPriceOffer.termsVersion, idempotencyKey: 'checkout-test-idempotency-0003'
    }), error => error.code === 'checkout_offer_price_unavailable');

    const env = { ...approvedEnv(), HOTELBEDS_PREPAID_CHECKOUT_ENABLED: 'false' };
    const disabled = makeCheckoutService({ env });
    await assert.rejects(disabled.service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: activeOffer().termsVersion, idempotencyKey: 'checkout-test-idempotency-0004'
    }), error => error.code === 'hotelbeds_prepaid_checkout_disabled');
});

test('checkout rejects missing or stale terms consent before creating a payment intent', async () => {
    for (const consent of [
        {},
        { termsAccepted: false, acceptedTermsVersion: activeOffer().termsVersion },
        { termsAccepted: true, acceptedTermsVersion: 'f'.repeat(64) }
    ]) {
        MemoryCheckoutSessionModel.reset();
        const { service, calls } = makeCheckoutService();
        await assert.rejects(service.createSession({
            publicOfferId: PUBLIC_OFFER_ID,
            guestDetails: GUEST_DETAILS,
            idempotencyKey: 'checkout-test-terms-rejection-0001',
            ...consent
        }), error => error.code === 'checkout_terms_acceptance_required' && error.httpStatus === 409);
        assert.equal(calls.intents, 0);
        assert.equal(MemoryCheckoutSessionModel.records.size, 0);
    }
});

test('checkout session survives OfferCache expiry while returning status is independently protected', async context => {
    MemoryCheckoutSessionModel.reset();
    let currentTime = new Date(NOW);
    const offer = activeOffer({ expiresAt: new Date(NOW.getTime() + OFFER_TTL_MS) });
    const { service, calls } = makeCheckoutService({ now: () => currentTime, offer });
    const first = await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: offer.termsVersion, idempotencyKey: 'checkout-test-idempotency-0005'
    });
    currentTime = new Date(NOW.getTime() + OFFER_TTL_MS + 1);
    await assert.rejects(service.getSession(first.sessionId, '0'.repeat(64)), error => error.code === 'checkout_session_not_found');
    const resumed = await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID,
        guestDetails: GUEST_DETAILS,
        termsAccepted: true,
        acceptedTermsVersion: TERMS_VERSION,
        idempotencyKey: 'checkout-test-idempotency-0005'
    });
    assert.equal(resumed.sessionId, first.sessionId);
    assert.equal(await service.getSession(first.sessionId, resumed.access_token).then(result => result.status), 'awaiting_payment');
    assert.equal(MemoryCheckoutSessionModel.records.has(first.sessionId), true);
    assert.equal(calls.intents, 1);
});

test('valid signed mock payment confirms one booking and duplicate webhooks never double-book', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, env } = makeCheckoutService();
    const checkout = await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: TERMS_VERSION, idempotencyKey: 'checkout-test-idempotency-0006'
    });
    const booking = bookingFixture(context);
    const bookingService = createHotelbedsMockCheckoutBookingService({
        env,
        recheckRate: async session => ({
            rateType: 'BOOKABLE', net: session.lockedNetPrice, currency: session.lockedNetCurrency
        }),
        createBookingReference: () => 'HBX-CONFIRMED-FIXTURE'
    });
    const handler = createTestWebhookHandler({
        Model: MemoryCheckoutSessionModel,
        hotelbedsBookingService: {
            async confirmBooking(input) {
                await booking.bookingService.confirmBooking(input);
                return bookingService.confirmBooking(input);
            }
        },
        env,
        now: () => NOW
    });
    const app = express();
    app.post('/mock-webhook', express.raw({ type: 'application/json', limit: '64kb' }), handler.receiveWebhook);
    const event = paymentEvent();
    const body = Buffer.from(JSON.stringify(event));
    const timestamp = String(NOW.getTime());
    const signature = createMockWebhookSignature(body, WEBHOOK_SECRET, timestamp);

    await withCheckoutHttpServer(app, async baseUrl => {
        const deliver = () => fetch(`${baseUrl}/mock-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mock-Timestamp': timestamp,
                'X-Mock-Hmac-Signature': signature
            },
            body
        });
        const [first, duplicate] = await Promise.all([deliver(), deliver()]);
        assert.equal(first.status, 200);
        assert.equal(duplicate.status, 200);
        const record = MemoryCheckoutSessionModel.records.get(checkout.sessionId);
        assert.equal(record.status, 'confirmed');
        assert.equal(record.acceptedTermsVersion, TERMS_VERSION);
        assert.ok(record.termsAcceptedAt instanceof Date);
        assert.equal(record.bookingReference, 'HBX-CONFIRMED-FIXTURE');
        assert.equal(booking.calls, 1);
    }, context);
});

test('session-authorized mock payment endpoint signs server-owned amount and never trusts browser status', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, env } = makeCheckoutService();
    const checkout = await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID,
        guestDetails: GUEST_DETAILS,
        termsAccepted: true,
        acceptedTermsVersion: TERMS_VERSION,
        idempotencyKey: 'checkout-test-idempotency-ui-mock-001'
    });
    let bookingCalls = 0;
    const webhookHandler = createTestWebhookHandler({
        Model: MemoryCheckoutSessionModel,
        env,
        now: () => NOW,
        hotelbedsBookingService: {
            async confirmBooking({ session }) {
                bookingCalls += 1;
                assert.equal(session.totalAmount, 49525);
                assert.equal(session.currency, 'AED');
                return { status: 'CONFIRMED', bookingReference: 'HBMOCK-UI-FLOW' };
            }
        }
    });
    const mockPaymentController = createMockHotelCheckoutPaymentController({
        service,
        webhookHandler,
        env,
        now: () => NOW.getTime(),
        enabled: () => true
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/hotels', createCheckoutSessionRouter({
        controller: (_req, res) => res.sendStatus(200),
        statusController: createCheckoutSessionController.createStatusController({ service }),
        mockPaymentController,
        requireUser: (req, _res, next) => { req.auth = { subject: 'test-fixture-owner' }; next(); }
    }));

    await withCheckoutHttpServer(app, async baseUrl => {
        const url = `${baseUrl}/api/v1/hotels/checkout/${checkout.sessionId}/mock-payment`;
        const invalidToken = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${'0'.repeat(64)}`
            },
            body: JSON.stringify({ action: 'complete' })
        });
        assert.equal(invalidToken.status, 404);
        assert.equal(bookingCalls, 0);

        const complete = () => fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${checkout.access_token}`
            },
            // These untrusted fields must have no effect; only action is accepted.
            body: JSON.stringify({ action: 'complete', amount: 1, currency: 'USD', status: 'failed' })
        });
        const firstResponse = await complete();
        const first = await firstResponse.json();
        assert.equal(firstResponse.status, 200);
        assert.equal(first.success, true);
        assert.equal(first.status, 'confirmed');
        assert.equal(bookingCalls, 1);

        const replayResponse = await complete();
        const replay = await replayResponse.json();
        assert.equal(replayResponse.status, 200);
        assert.equal(replay.status, 'confirmed');
        assert.equal(replay.duplicate, true);
        assert.equal(bookingCalls, 1);
        assert.equal(MemoryCheckoutSessionModel.records.get(checkout.sessionId).totalAmount, 49525);
    }, context);
});

test('mock payment route is absent by default when checkout rollout gates are closed', async context => {
    let sessionLookups = 0;
    let webhookCalls = 0;
    const controller = createMockHotelCheckoutPaymentController({
        service: { async getSession() { sessionLookups += 1; throw new Error('must stay disabled'); } },
        webhookHandler: {
            verifyMockSignature() { return true; },
            async processSignedEvent() { webhookCalls += 1; }
        },
        env: { ...approvedEnv(), HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED: 'false' }
    });
    const app = express();
    app.use(express.json());
    app.post('/mock-payment/:sessionId', controller);

    await withCheckoutHttpServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/mock-payment/${SESSION_ID}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'complete' })
        });
        assert.equal(response.status, 404);
        assert.equal(sessionLookups, 0);
        assert.equal(webhookCalls, 0);
    }, context);
});

test('checkout mock-payment HTTP route authenticates the session then runs the signed webhook state machine once', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, env } = makeCheckoutService();
    let bookingCalls = 0;
    const mockBooking = createHotelbedsMockCheckoutBookingService({
        env,
        recheckRate: async session => ({ rateType: 'BOOKABLE', net: session.lockedNetPrice, currency: session.lockedNetCurrency }),
        createBookingReference: () => 'HBMOCK-E2E-FLOW'
    });
    const webhookHandler = createTestWebhookHandler({
        Model: MemoryCheckoutSessionModel,
        env,
        now: () => NOW,
        hotelbedsBookingService: {
            async confirmBooking(input) {
                bookingCalls += 1;
                return mockBooking.confirmBooking(input);
            }
        }
    });
    const mockPaymentController = createMockHotelCheckoutPaymentController({
        service,
        webhookHandler,
        env,
        now: () => NOW.getTime(),
        enabled: () => true
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/hotels', createCheckoutSessionRouter({
        controller: createCheckoutSessionController({ service }),
        statusController: createCheckoutSessionController.createStatusController({ service }),
        mockPaymentController,
        requireUser: (req, _res, next) => { req.auth = { subject: 'test-fixture-owner' }; next(); }
    }));

    await withCheckoutHttpServer(app, async baseUrl => {
        const createdResponse = await fetch(`${baseUrl}/api/v1/hotels/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': 'checkout-test-ui-mock-payment-0001'
            },
            body: JSON.stringify({ publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS,
                termsAccepted: true, acceptedTermsVersion: TERMS_VERSION })
        });
        const created = await createdResponse.json();
        assert.equal(createdResponse.status, 201);
        assert.equal(created.status, 'awaiting_payment');

        const paymentUrl = `${baseUrl}/api/v1/hotels/checkout/${created.sessionId}/mock-payment`;
        const complete = () => fetch(paymentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${created.access_token}`
            },
            body: JSON.stringify({ action: 'complete', amount: 1, currency: 'USD', status: 'failed' })
        });
        const paymentResponse = await complete();
        const payment = await paymentResponse.json();
        assert.equal(paymentResponse.status, 200);
        assert.equal(payment.status, 'confirmed');
        assert.equal(bookingCalls, 1);

        const replayResponse = await complete();
        const replay = await replayResponse.json();
        assert.equal(replayResponse.status, 200);
        assert.equal(replay.status, 'confirmed');
        assert.equal(replay.duplicate, true);
        assert.equal(bookingCalls, 1);

        const statusResponse = await fetch(`${baseUrl}/api/v1/hotels/checkout/${created.sessionId}`, {
            headers: { Authorization: `Bearer ${created.access_token}` }
        });
        assert.equal((await statusResponse.json()).status, 'confirmed');
    }, context);
});

test('a strictly changed RECHECK price enters refund_review and is never retried', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, env } = makeCheckoutService();
    const checkout = await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: TERMS_VERSION, idempotencyKey: 'checkout-test-idempotency-0007'
    });
    const booking = bookingFixture(context);
    const mockBooking = createHotelbedsMockCheckoutBookingService({
        env,
        recheckRate: async () => ({ rateType: 'BOOKABLE', net: '201.00', currency: 'EUR' })
    });
    const handler = createTestWebhookHandler({
        Model: MemoryCheckoutSessionModel,
        hotelbedsBookingService: {
            async confirmBooking(input) {
                await booking.bookingService.confirmBooking(input);
                return mockBooking.confirmBooking(input);
            }
        },
        env,
        now: () => NOW
    });
    const event = paymentEvent();
    const first = await handler.handleEvent(event);
    const second = await handler.handleEvent(event);
    assert.equal(first.status, 'refund_review');
    assert.equal(second.status, 'refund_review');
    assert.equal(second.duplicate, true);
    assert.equal(MemoryCheckoutSessionModel.records.get(checkout.sessionId).status, 'refund_review');
    assert.equal(booking.calls, 1);
});

test('an awaited payment after offer expiry is refunded for review and never reaches booking', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, env } = makeCheckoutService();
    const checkout = await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: TERMS_VERSION, idempotencyKey: 'checkout-test-idempotency-0009'
    });
    const booking = bookingFixture(context);
    const handler = createTestWebhookHandler({
        Model: MemoryCheckoutSessionModel,
        hotelbedsBookingService: booking.bookingService,
        env,
        now: () => new Date(NOW.getTime() + OFFER_TTL_MS + 1)
    });
    const result = await handler.handleEvent(paymentEvent());
    assert.equal(result.status, 'refund_review');
    assert.equal(MemoryCheckoutSessionModel.records.get(checkout.sessionId).status, 'refund_review');
    assert.equal(booking.calls, 0);
});

test('RECHECK mock booking accepts only an exact net-price and currency match', async () => {
    const env = approvedEnv();
    const samePrice = createHotelbedsMockCheckoutBookingService({
        env,
        recheckRate: async () => ({ rateType: 'BOOKABLE', net: '200.000', currency: 'eur' }),
        createBookingReference: () => 'HBMOCK-PRICE-MATCH'
    });
    const session = {
        sessionId: SESSION_ID,
        provider: 'hotelbeds',
        offerOrigin: 'mock_fixture',
        providerOfferRef: 'private-rate-key-fixture',
        totalAmount: 49525,
        currency: 'AED',
        lockedNetPrice: '200.00',
        lockedNetCurrency: 'EUR',
        rateType: 'RECHECK'
    };
    const confirmed = await samePrice.confirmBooking({ session, guestDetails: GUEST_DETAILS });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.bookingReference, 'HBMOCK-PRICE-MATCH');

    const changedPrice = createHotelbedsMockCheckoutBookingService({
        env,
        recheckRate: async () => ({ rateType: 'BOOKABLE', net: '200.01', currency: 'EUR' })
    });
    await assert.rejects(changedPrice.confirmBooking({ session, guestDetails: GUEST_DETAILS }),
        error => error.code === 'booking_rate_changed');
});

test('invalid HMAC and stale timestamps do not verify or start booking', async context => {
    MemoryCheckoutSessionModel.reset();
    const { service, env } = makeCheckoutService();
    await service.createSession({
        publicOfferId: PUBLIC_OFFER_ID, guestDetails: GUEST_DETAILS, termsAccepted: true,
        acceptedTermsVersion: TERMS_VERSION, idempotencyKey: 'checkout-test-idempotency-0008'
    });
    const booking = bookingFixture(context);
    const handler = createTestWebhookHandler({ Model: MemoryCheckoutSessionModel, hotelbedsBookingService: booking.bookingService, env, now: () => NOW });
    const body = Buffer.from(JSON.stringify(paymentEvent()));
    const staleTimestamp = String(NOW.getTime() - 10 * 60 * 1000);
    assert.equal(handler.verifyMockSignature(body,
        createMockWebhookSignature(body, WEBHOOK_SECRET, staleTimestamp), staleTimestamp), false);
    assert.equal(handler.verifyMockSignature(body, '0'.repeat(64), String(NOW.getTime())), false);
    assert.equal(booking.calls, 0);
});