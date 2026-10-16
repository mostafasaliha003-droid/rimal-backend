const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHotelbedsRateReviewService } = require('../services/hotelbedsRateReviewService');
const { createMemoryHotelbedsRateReviewModel } = require('./helpers/createMemoryHotelbedsRateReviewModel');
const { createOfferCacheService } = require('../services/offerCacheService');
const { createHotelbedsRateReviewController } = require('../controllers/hotelbedsRateReviewController');
const HotelbedsRateReview = require('../models/HotelbedsRateReview');
const {
    identityFromNormalizedOffer,
    termsFromNormalizedOffer,
    checkRateTermsFingerprint
} = require('../services/hotelbedsRateCheckService');
const { offerTermsVersion } = require('../services/offerTermsVersion');

const NOW = new Date('2026-10-05T12:00:00.000Z');
const PUBLIC_OFFER_ID = 'd'.repeat(64);
const RATE_KEY = 'private-rate-review-fixture-rate-key';
const REVIEW_ID = '11111111-2222-4333-8444-555555555555';
const OWNER = 'rate-review-fixture-owner';
const IDEMPOTENCY_KEY = 'rate-review-fixture-idempotency-0001';

const ENV = {
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_RATE_REVIEW_ENABLED: 'true',
    HOTELBEDS_RATE_REVIEW_APPROVED: 'true'
};

function normalizedOffer(overrides = {}) {
    return {
        origin: 'live',
        provider: 'hotelbeds',
        providerHotelId: '74001',
        hotel: { name: 'Review Fixture Hotel' },
        room: { providerCode: 'DBL.ST', name: 'Double Standard' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-12' },
        occupancy: { rooms: 1, adults: 2, children: 0 },
        availability: {
            rateType: 'RECHECK', rateClass: 'NOR', allotment: 1, packaging: false,
            rateCommentsResolved: true
        },
        payment: { type: 'AT_HOTEL' },
        board: { supplierCode: 'BB', supplierName: 'Breakfast', normalizedCode: 'BB' },
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
        taxes: { status: 'provided', allIncluded: true, items: [] },
        promotions: [],
        rateComments: [],
        contractTerms: { rateCommentsResolved: true },
        price: {
            supplierAmount: { amount: '100.00', currency: 'EUR', basis: 'supplier_net' },
            customerDisplay: { amount: '495.00', currency: 'AED' },
            lockedSell: { amount: '495.00', currency: 'AED' }
        },
        booking: { opaqueToken: RATE_KEY },
        ...overrides
    };
}

function checkRateResponse({
    rateKey = RATE_KEY,
    net = '100.00',
    rateComments = [],
    cancellationAmount = '100.00',
    taxes = { allIncluded: true, taxes: [] }
} = {}) {
    return { hotel: {
        code: 74001,
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        currency: 'EUR',
        paymentDataRequired: false,
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
            cancellationPolicies: [{
                amount: cancellationAmount,
                from: '2026-11-10T00:59:00+01:00'
            }],
            promotions: [],
            taxes,
            rateComments
        }] }],
        upselling: null
    } };
}

function makeServices({
    now = () => new Date(NOW),
    responses = [checkRateResponse()],
    checkRate,
    offer = normalizedOffer(),
    publicOfferId = PUBLIC_OFFER_ID,
    env = ENV,
    createReviewId = () => REVIEW_ID
} = {}) {
    const CacheModel = createOfferMemoryModel(publicOfferId);
    const cache = createOfferCacheService({
        Model: CacheModel,
        providerScope: 'test',
        testOnly: true,
        ensureDatabaseReady: async () => {},
        now,
        createPublicOfferId: () => publicOfferId
    });
    const ReviewModel = createMemoryHotelbedsRateReviewModel();
    const calls = [];
    let responseIndex = 0;
    const client = {
        async checkRates(payload) {
            calls.push(structuredClone(payload));
            if (checkRate) return checkRate(payload, calls.length);
            const response = responses[Math.min(responseIndex++, responses.length - 1)];
            return { ok: true, data: structuredClone(response) };
        }
    };
    const service = createHotelbedsRateReviewService({
        Model: ReviewModel,
        database: {},
        client,
        offerCacheService: cache,
        env,
        now,
        createReviewId,
        testOnly: true,
        ensureDatabaseReady: async () => {}
    });
    return { CacheModel, ReviewModel, cache, client, service, calls, now, publicOfferId, offer };
}

function createOfferMemoryModel(publicOfferId) {
    const records = new Map();
    return {
        records,
        async insertMany(documents) {
            for (const document of documents) records.set(publicOfferId, structuredClone(document));
            return documents.map(document => structuredClone(document));
        },
        findOne(filter) {
            let selection = '';
            return {
                select(value) { selection = value; return this; },
                lean() { return this; },
                async exec() {
                    const record = records.get(filter.publicOfferId);
                    if (!record || !(record.expiresAt > filter.expiresAt.$gt)) return null;
                    const result = structuredClone(record);
                    for (const field of [
                        'opaqueToken', 'lockedNetPrice', 'lockedSellAmount', 'lockedSellCurrency',
                        'currency', 'paymentType', 'rateType', 'origin', 'roomCount', 'adultCount',
                        'childCount', 'realm', 'environment', 'accountId', 'bookingIdentity',
                        'bookingTerms', 'publicReviewOffer', 'termsVersion'
                    ]) {
                        if (!selection.includes(`+${field}`)) delete result[field];
                    }
                    return result;
                }
            };
        }
    };
}

async function seed(services) {
    await services.cache.storeOffers([services.offer]);
}

async function createReview(services, overrides = {}) {
    return services.service.createReview({
        publicOfferId: services.publicOfferId,
        ownerSubject: OWNER,
        idempotencyKey: IDEMPOTENCY_KEY,
        ...overrides
    });
}

function consentFor(review, overrides = {}) {
    return {
        reviewId: review.reviewId,
        publicOfferId: review.publicOfferId,
        ownerSubject: OWNER,
        sourceTermsVersion: review.sourceTermsVersion,
        acceptedTermsVersion: review.termsVersion,
        termsAccepted: true,
        ...overrides
    };
}

test('review CheckRate returns complete display terms without exposing the private rate key', async () => {
    const checked = checkRateResponse({
        rateComments: ['Pool maintenance in progress.', {
            description: 'Local fee payable on arrival.', dateStart: '2026-11-10', dateEnd: '2026-11-12'
        }],
        taxes: {
            allIncluded: false,
            taxes: [{
                included: false,
                type: 'TAX',
                subType: 'City tax',
                clientAmount: '12.50',
                clientCurrency: 'AED'
            }]
        }
    });
    const services = makeServices({ responses: [checked] });
    await seed(services);

    const result = await createReview(services);
    const stored = services.ReviewModel.records.get(result.reviewId);

    assert.equal(result.success, true);
    assert.equal(result.checkRateRequests, 1);
    assert.equal(result.offer.termsVersion, result.termsVersion);
    assert.equal(result.offer.rateComments.length, 2);
    assert.equal(result.offer.rateComments[1].description, 'Local fee payable on arrival.');
    assert.equal(result.offer.taxes.allIncluded, false);
    assert.equal(result.offer.taxes.items[0].amount, '12.50');
    assert.equal(stored.checkRateSnapshot.hotel.rooms[0].rates[0].rateKey, RATE_KEY);
    assert.equal(JSON.stringify(result).includes(RATE_KEY), false);
    assert.deepEqual(services.calls, [{ rooms: [{ rateKey: RATE_KEY }], upselling: false }]);
});

test('review rejects RateComments outside the shared voucher and encrypted-snapshot bounds', async t => {
    for (const [label, rateComments] of [
        ['per-comment length', ['x'.repeat(2001)]],
        ['aggregate snapshot size', Array.from({ length: 13 }, (_, index) => `${index}:${'x'.repeat(1990)}`)]
    ]) {
        await t.test(label, async () => {
            const services = makeServices({ responses: [checkRateResponse({ rateComments })] });
            await seed(services);
            await assert.rejects(createReview(services));
            assert.equal(services.calls.length, 1);
        });
    }
});

test('CheckRate fingerprint is stable to object-key order and changes when selected-rate terms change', () => {
    const original = checkRateResponse();
    const reordered = { hotel: {
        upselling: null,
        rooms: [{ rates: [Object.fromEntries(Object.entries(original.hotel.rooms[0].rates[0]).reverse())], code: 'DBL.ST' }],
        paymentDataRequired: false, currency: 'EUR', checkOut: '2026-11-12',
        checkIn: '2026-11-10', code: 74001
    } };
    assert.equal(checkRateTermsFingerprint(original), checkRateTermsFingerprint(reordered));
    assert.notEqual(checkRateTermsFingerprint(original), checkRateTermsFingerprint(
        checkRateResponse({ cancellationAmount: '50.00' })
    ));
});

test('a changed rate key or price at review creation rejects the review', async t => {
    const changes = [
        ['rate key', { rateKey: 'a-different-private-rate-key' }],
        ['price', { net: '101.00' }]
    ];
    for (const [label, change] of changes) {
        await t.test(label, async () => {
            const services = makeServices({ responses: [checkRateResponse(change)] });
            await seed(services);
            await assert.rejects(createReview(services),
                error => error.code === 'hotelbeds_rate_review_rate_changed');
            assert.deepEqual(services.calls.map(() => 'checkrates'), ['checkrates']);
        });
    }
});

test('cancellation, comment and tax differences are captured into one review CheckRate', async () => {
    const services = makeServices({
        responses: [checkRateResponse({
            cancellationAmount: '50.00',
            rateComments: ['A new mandatory local charge applies.'],
            taxes: { allIncluded: false, taxes: [{ included: false, type: 'FEE' }] }
        })]
    });
    await seed(services);
    const review = await createReview(services);
    assert.equal(review.success, true);
    assert.equal(review.checkRateRequests, 1);
    const consumed = await services.service.consumeForBooking(consentFor(review));
    assert.equal(consumed.checkRateRequests, 1);
    assert.equal(services.ReviewModel.records.get(review.reviewId).state, 'consumed');
    assert.deepEqual(services.calls.map(() => 'checkrates'), ['checkrates']);
});

test('a failed single CheckRate fails the review and cannot be consumed', async () => {
    const services = makeServices({
        checkRate: async () => ({ ok: false, httpStatus: 503, data: null })
    });
    await seed(services);
    await assert.rejects(createReview(services),
        error => error.code === 'hotelbeds_rate_review_revalidation_unavailable');
    assert.deepEqual(services.calls.map(() => 'checkrates'), ['checkrates']);
});

test('review requires current owner, exact explicit consent, and one-time use', async () => {
    const services = makeServices({ responses: [checkRateResponse()] });
    await seed(services);
    const review = await createReview(services);
    await assert.rejects(services.service.consumeForBooking(consentFor(review, {
        ownerSubject: 'different-review-owner'
    })), error => error.code === 'hotelbeds_rate_review_acceptance_required');
    await assert.rejects(services.service.consumeForBooking(consentFor(review, {
        termsAccepted: false
    })), error => error.code === 'hotelbeds_rate_review_acceptance_required');
    await assert.rejects(services.service.consumeForBooking(consentFor(review, {
        acceptedTermsVersion: review.sourceTermsVersion
    })), error => error.code === 'hotelbeds_rate_review_acceptance_required');

    const consumed = await services.service.consumeForBooking(consentFor(review));
    assert.equal(consumed.checkRateRequests, 1);
    await assert.rejects(services.service.consumeForBooking(consentFor(review)),
        error => error.code === 'hotelbeds_rate_review_already_consumed');
});

test('concurrent review creation for an idempotency key issues one CheckRate', async () => {
    let releaseCheck;
    const checkBarrier = new Promise(resolve => { releaseCheck = resolve; });
    let checks = 0;
    const services = makeServices({ checkRate: async () => {
        checks += 1;
        await checkBarrier;
        return { ok: true, data: checkRateResponse() };
    } });
    await seed(services);
    const input = { publicOfferId: PUBLIC_OFFER_ID, ownerSubject: OWNER, idempotencyKey: IDEMPOTENCY_KEY };
    const firstPromise = services.service.createReview(input);
    while (checks === 0) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(services.service.createReview(input),
        error => error.code === 'hotelbeds_rate_review_in_progress');
    releaseCheck();
    const first = await firstPromise;
    assert.equal(first.success, true);
    assert.equal(checks, 1);
    assert.equal(services.ReviewModel.records.size, 1);
});

test('consumption after the review window expires is rejected without consuming', async () => {
    let now = new Date(NOW);
    const services = makeServices({ now: () => now });
    await seed(services);
    const review = await createReview(services);
    const record = services.ReviewModel.records.get(review.reviewId);
    record.reviewExpiresAt = new Date(NOW.getTime() + 1000);
    now = new Date(NOW.getTime() + 1001);
    await assert.rejects(services.service.consumeForBooking(consentFor(review)),
        error => error.httpStatus === 409);
    assert.equal(record.checkRateRequests, 1);
    assert.deepEqual(services.calls.map(() => 'checkrates'), ['checkrates']);
});

test('Mongoose review model stores review lease and a one-time snapshot without needing MongoDB', async () => {
    assert.equal(HotelbedsRateReview.schema.path('checkRateSnapshot').options.immutable, undefined);
    assert.equal(HotelbedsRateReview.schema.path('verificationLeaseExpiresAt'), undefined);
    assert.equal(HotelbedsRateReview.schema.path('checkRateRequests').options.max, 1);
    assert.equal(HotelbedsRateReview.schema.path('idempotencyKeyHash').options.immutable, true);
    assert.ok(HotelbedsRateReview.schema.indexes().some(([keys, options]) =>
        keys.ownerSubject === 1 && keys.idempotencyKeyHash === 1 && options.unique === true));

    const validated = new HotelbedsRateReview({
        reviewId: REVIEW_ID,
        realm: 'review-schema-fixture',
        environment: 'test',
        accountId: 'a'.repeat(64),
        ownerSubject: OWNER,
        publicOfferId: PUBLIC_OFFER_ID,
        idempotencyKeyHash: 'b'.repeat(64),
        state: 'pending',
        sourceTermsVersion: 'c'.repeat(64),
        rateType: 'RECHECK',
        rateKeyFingerprint: 'e'.repeat(64),
        providerRateKey: RATE_KEY,
        checkRateRequests: 1,
        termsVersion: 'f'.repeat(64),
        rateIdentity: identityFromNormalizedOffer(normalizedOffer()),
        rateTerms: termsFromNormalizedOffer(normalizedOffer()),
        offer: { publicOfferId: PUBLIC_OFFER_ID, termsVersion: 'f'.repeat(64) },
        checkRateSnapshot: checkRateResponse(),
        checkRateTermsFingerprint: '1'.repeat(64),
        reviewExpiresAt: new Date(NOW.getTime() + 60_000),
        expiresAt: new Date(NOW.getTime() + 3_600_000)
    });
    await validated.validate();
    assert.deepEqual(validated.checkRateSnapshot, checkRateResponse());
});

test('production rate review fails closed unless both independent approval flags are true', async () => {
    let databaseTouches = 0;
    const services = makeServices({
        env: { ...ENV, HOTELBEDS_RATE_REVIEW_ENABLED: 'false' }
    });
    const reviewService = createHotelbedsRateReviewService({
        Model: services.ReviewModel,
        database: {},
        client: services.client,
        offerCacheService: services.cache,
        env: { ...ENV, HOTELBEDS_RATE_REVIEW_ENABLED: 'false' }
    });
    await assert.rejects(reviewService.createReview({
        publicOfferId: PUBLIC_OFFER_ID,
        ownerSubject: OWNER,
        idempotencyKey: IDEMPOTENCY_KEY
    }), error => error.code === 'hotelbeds_rate_review_disabled');
    assert.equal(databaseTouches, 0);
    assert.equal(services.calls.length, 0);
});