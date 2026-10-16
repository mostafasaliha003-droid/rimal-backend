const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const OfferCache = require('../models/OfferCache');
const hotelbedsDatabase = require('../services/hotelbedsMockDatabase');
const {
    OFFER_TTL_MS,
    createOfferCacheService
} = require('../services/offerCacheService');

const NOW = new Date('2026-10-01T12:00:00.000Z');
const TOKENS = [
    'hotelbeds-rate-key-private-fixture',
    'ratehawk-book-hash-private-fixture'
];

function normalizedOffer({ provider = 'hotelbeds', hotelCode = 74, token = TOKENS[0] } = {}) {
    return {
        schemaVersion: 1,
        origin: 'live',
        provider,
        providerHotelId: String(hotelCode),
        providerOfferId: token,
        hotel: {
            canonicalId: null,
            providerHotelId: String(hotelCode),
            code: hotelCode,
            name: 'Fixture property',
            category: { code: '4EST', name: '4 stars', privateSupplierMetadata: 'do-not-copy' },
            destinationCode: 'DXB',
            destinationName: 'Dubai',
            privateSupplierMetadata: 'do-not-copy'
        },
        room: {
            providerCode: 'DBL.ST',
            name: 'Double Standard',
            opaqueToken: 'private-room-token'
        },
        stay: { checkIn: '2026-10-31', checkOut: '2026-11-02', private: 'do-not-copy' },
        occupancy: { rooms: 1, adults: 2, children: 0, private: 'do-not-copy' },
        price: {
            supplierAmount: { amount: '218.50', currency: 'EUR', basis: 'supplier_net' },
            customerDisplay: { amount: '218.50', currency: 'EUR', opaqueToken: 'nested-private-token' },
            privateSupplierMetadata: 'do-not-copy'
        },
        board: {
            supplierCode: 'BB', supplierName: 'BED AND BREAKFAST', normalizedCode: 'BB',
            privateSupplierMetadata: 'do-not-copy'
        },
        availability: { rateType: 'BOOKABLE', rateClass: 'NOR', allotment: 4, packaging: false },
        payment: { type: 'AT_WEB', private: 'do-not-copy' },
        cancellation: {
            refundability: 'conditional',
            freeCancellationBefore: null,
            schedule: [{
                startsAt: { source: '2026-10-28T23:59:00+01:00', utc: '2026-10-28T22:59:00.000Z', timezoneKnown: true },
                endsAt: null,
                penalty: { amount: '218.50', currency: 'EUR', opaqueToken: 'private-policy-token' },
                private: 'do-not-copy'
            }],
            privateSupplierMetadata: 'do-not-copy'
        },
        taxes: {
            status: 'provided', allIncluded: false,
            items: [{ included: false, amount: '13.20', currency: 'EUR', type: 'TAX', subType: 'City Tax', opaqueToken: 'private-tax-token' }],
            opaqueToken: 'private-tax-wrapper-token'
        },
        promotions: [{ code: 'PROMO', name: 'Fixture promo', remark: 'Fixture remark', opaqueToken: 'private-promotion-token' }],
        booking: { referenceVisibility: 'server_only', requiresOpaqueReference: true, opaqueToken: token },
        opaqueToken: 'top-level-private-token',
        rawSupplierPayload: { rateKey: token, book_hash: token, opaqueToken: token }
    };
}

function createMemoryModel() {
    const records = new Map();
    const inserted = [];
    return {
        records,
        inserted,
        async insertMany(documents, options) {
            inserted.push({ documents, options });
            for (const document of documents) {
                if (records.has(document.publicOfferId)) {
                    throw Object.assign(new Error('duplicate public offer ID'), { code: 11000 });
                }
                records.set(document.publicOfferId, { ...document });
            }
            return documents.map(document => ({ ...document }));
        },
        findOne(filter) {
            const query = {
                selected: '',
                select(selection) {
                    this.selected = selection;
                    return this;
                },
                lean() { return this; },
                exec: async function exec() {
                    const record = records.get(filter.publicOfferId);
                    if (!record || !(new Date(record.expiresAt) > filter.expiresAt.$gt)) return null;
                    const result = { ...record };
                    for (const field of ['opaqueToken', 'lockedNetPrice', 'currency']) {
                        if (!this.selected.includes(`+${field}`)) delete result[field];
                    }
                    return result;
                }
            };
            return query;
        }
    };
}

function createTestOfferCacheService(Model, options = {}) {
    return createOfferCacheService({
        Model,
        providerScope: 'test',
        testOnly: true,
        ensureDatabaseReady: async () => {},
        ...options
    });
}

test('RateHawk OfferCache remains on the default connection and Hotelbeds gets its own model', () => {
    const HotelbedsOfferCache = require('../models/HotelbedsOfferCache');
    assert.equal(OfferCache.db, mongoose.connection);
    assert.equal(HotelbedsOfferCache.db, hotelbedsDatabase.connection);
    assert.notEqual(HotelbedsOfferCache.db, OfferCache.db);
});

test('default OfferCache fails closed while RateHawk Mongo is disconnected', async () => {
    const { retrieveOffer } = require('../services/offerCacheService');
    await assert.rejects(retrieveOffer('a'.repeat(64)), error =>
        error.code === 'offer_cache_database_unavailable' && error.httpStatus === 503);
});

test('shared RateHawk cache rejects Hotelbeds writes before touching its model', async () => {
    let touched = false;
    const original = OfferCache.insertMany;
    OfferCache.insertMany = async () => { touched = true; return []; };
    try {
        await assert.rejects(require('../services/offerCacheService').storeOffers([normalizedOffer()]),
            error => error.code === 'offer_cache_provider_scope_mismatch');
        assert.equal(touched, false);
    } finally {
        OfferCache.insertMany = original;
    }
});

test('OfferCache Mongoose document validates cache-record fields without a database connection', () => {
    const valid = new OfferCache({
        schemaVersion: 1,
        origin: 'live',
        publicOfferId: 'd'.repeat(64),
        provider: 'hotelbeds',
        providerHotelCode: '74',
        opaqueToken: TOKENS[0],
        lockedNetPrice: '218.50',
        currency: 'EUR',
        expiresAt: new Date(NOW.getTime() + OFFER_TTL_MS)
    });
    assert.equal(valid.validateSync(), undefined);
    assert.equal(valid.toObject().opaqueToken, TOKENS[0]);

    const invalid = new OfferCache({
        publicOfferId: 'bad-id',
        origin: 'legacy',
        provider: 'unknown',
        providerHotelCode: '',
        opaqueToken: '',
        lockedNetPrice: '-10',
        currency: 'EURO',
        expiresAt: 'not-a-date'
    });
    const validation = invalid.validateSync();
    for (const field of ['publicOfferId', 'origin', 'provider', 'providerHotelCode', 'opaqueToken', 'lockedNetPrice', 'currency', 'expiresAt']) {
        assert.ok(validation.errors[field], `${field} should fail validation`);
    }
});

test('OfferCache model has required private fields and unique/public plus TTL indexes', () => {
    assert.equal(OfferCache.modelName, 'OfferCache');
    assert.deepEqual(OfferCache.schema.path('schemaVersion').options.enum, [1, 2]);
    assert.equal(OfferCache.collection.name, 'offercaches');
    assert.ok(OfferCache.schema.path('publicOfferId'));
    assert.ok(OfferCache.schema.path('provider'));
    assert.ok(OfferCache.schema.path('providerHotelCode'));
    assert.ok(OfferCache.schema.path('opaqueToken'));
    assert.equal(OfferCache.schema.path('opaqueToken').options.select, false);
    assert.ok(OfferCache.schema.path('lockedNetPrice'));
    assert.ok(OfferCache.schema.path('currency'));
    assert.ok(OfferCache.schema.path('expiresAt'));
    const indexes = OfferCache.schema.indexes();
    assert.ok(indexes.some(([keys, options]) => keys.publicOfferId === 1 && options.unique === true));
    assert.ok(indexes.some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
});

test('storeOffers saves opaque tokens privately and returns strictly allowlisted client offers', async () => {
    const Model = createMemoryModel();
    let id = 0;
    const service = createTestOfferCacheService(Model, {
        now: () => NOW,
        createPublicOfferId: () => (++id).toString(16).padStart(64, '0')
    });
    const offers = [normalizedOffer(), normalizedOffer({
        provider: 'ratehawk', hotelCode: 'rh-hotel-42', token: TOKENS[1]
    })];

    const publicOffers = await service.storeOffers(offers);
    assert.equal(Model.inserted.length, 1);
    assert.equal(Model.inserted[0].options.ordered, true);
    assert.equal(Model.inserted[0].documents.length, 2);
    assert.equal(Model.inserted[0].documents[0].expiresAt.getTime(), NOW.getTime() + OFFER_TTL_MS);
    assert.equal(Model.inserted[0].documents[0].opaqueToken, TOKENS[0]);
    assert.equal(Model.inserted[0].documents[0].lockedNetPrice, '218.50');
    assert.equal(Model.inserted[0].documents[0].currency, 'EUR');
    assert.match(Model.inserted[0].documents[0].termsVersion, /^[a-f\d]{64}$/i);
    assert.equal(publicOffers[0].publicOfferId, '0'.repeat(63) + '1');
    assert.equal(publicOffers[1].publicOfferId, '0'.repeat(63) + '2');
    assert.equal(publicOffers[0].termsVersion, Model.inserted[0].documents[0].termsVersion);
    assert.equal(Object.hasOwn(publicOffers[1], 'termsVersion'), false,
        'terms versions are created only for Hotelbeds offer snapshots');

    const serialized = JSON.stringify(publicOffers);
    for (const secret of [
        ...TOKENS,
        'top-level-private-token',
        'private-room-token',
        'nested-private-token',
        'private-policy-token',
        'private-tax-token',
        'private-tax-wrapper-token',
        'private-promotion-token',
        'do-not-copy',
        'supplierAmount',
        'providerHotelId',
        'providerOfferId',
        'opaqueToken',
        'booking'
    ]) assert.equal(serialized.includes(secret), false, `client response leaked ${secret}`);
    assert.deepEqual(Object.keys(publicOffers[0].price), ['customerDisplay']);
    assert.equal(publicOffers[0].price.customerDisplay.amount, '218.50');
    assert.equal(publicOffers[0].hotel.name, 'Fixture property');
    assert.equal(publicOffers[0].hotel.canonicalId, null);
});

test('retrieveOffer returns the exact server-side checkout fields and rejects expired or malformed IDs', async () => {
    const Model = createMemoryModel();
    let now = new Date(NOW);
    const service = createTestOfferCacheService(Model, {
        now: () => now,
        createPublicOfferId: () => 'a'.repeat(64)
    });
    const [publicOffer] = await service.storeOffers([normalizedOffer()]);

    const retrieved = await service.retrieveOffer(publicOffer.publicOfferId);
    assert.deepEqual(retrieved, {
        publicOfferId: publicOffer.publicOfferId,
        provider: 'hotelbeds',
        providerHotelCode: '74',
        opaqueToken: TOKENS[0],
        lockedNetPrice: '218.50',
        currency: 'EUR',
        expiresAt: new Date(NOW.getTime() + OFFER_TTL_MS)
    });
    assert.equal(await service.retrieveOffer('b'.repeat(64)), null);
    await assert.rejects(service.retrieveOffer('../not-an-id'), error => error.code === 'offer_cache_public_id_invalid');

    now = new Date(NOW.getTime() + OFFER_TTL_MS);
    assert.equal(await service.retrieveOffer(publicOffer.publicOfferId), null);
});

test('storeOffers validates all records before writing and uses cryptographically random IDs by default', async () => {
    const Model = createMemoryModel();
    const service = createTestOfferCacheService(Model, { now: () => NOW });
    const [first, second] = await service.storeOffers([
        normalizedOffer(),
        normalizedOffer({ provider: 'ratehawk', hotelCode: 'rh-hotel-42', token: TOKENS[1] })
    ]);
    assert.match(first.publicOfferId, /^[a-f\d]{64}$/);
    assert.match(second.publicOfferId, /^[a-f\d]{64}$/);
    assert.notEqual(first.publicOfferId, second.publicOfferId);

    const invalidModel = createMemoryModel();
    const invalidService = createTestOfferCacheService(invalidModel, {
        now: () => NOW,
        createPublicOfferId: () => 'c'.repeat(64)
    });
    await assert.rejects(invalidService.storeOffers([
        normalizedOffer(),
        normalizedOffer({ provider: 'unknown-provider' })
    ]), error => error.code === 'offer_cache_provider_invalid');
    assert.equal(invalidModel.inserted.length, 0);
});

test('storeOffers fails closed when token, hotel ID, price, or currency is missing', async () => {
    const badOffers = [
        { ...normalizedOffer(), booking: { opaqueToken: '' } },
        { ...normalizedOffer(), providerHotelId: null, hotel: {} },
        { ...normalizedOffer(), price: { supplierAmount: { amount: '1e2', currency: 'EUR' } } },
        { ...normalizedOffer(), price: { supplierAmount: { amount: '10.00', currency: null } } }
    ];
    const expectedCodes = [
        'offer_cache_opaque_token_missing',
        'offer_cache_provider_hotel_code_invalid',
        'offer_cache_locked_price_invalid',
        'offer_cache_currency_invalid'
    ];
    for (let index = 0; index < badOffers.length; index += 1) {
        const Model = createMemoryModel();
        const service = createTestOfferCacheService(Model, {
            now: () => NOW,
            createPublicOfferId: () => `${index + 10}`.padStart(64, '0')
        });
        await assert.rejects(service.storeOffers([badOffers[index]]), error => error.code === expectedCodes[index]);
        assert.equal(Model.inserted.length, 0);
    }
});