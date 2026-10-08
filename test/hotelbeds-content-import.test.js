const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLanguage, normalizeHotelContent } = require('../services/hotelbedsContentService');
const {
    contentImportPlan,
    normalizeRateCommentRecord,
    createHotelbedsContentImportService
} = require('../services/hotelbedsContentImportService');
const { resolveHotelbedsRateComments } = require('../services/hotelbedsRateCommentResolver');
const { createHotelbedsAvailabilityService } = require('../services/hotelbedsAvailabilityService');
const HotelbedsRateComment = require('../models/HotelbedsRateComment');

const syncedAt = new Date('2026-10-04T12:00:00.000Z');
const importEnv = {
    HOTELBEDS_API_KEY: 'content-import-fixture-key',
    HOTELBEDS_SECRET: 'content-import-fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'content-import-fixture-account',
    HOTELBEDS_RATE_MAX_REQUESTS: '8',
    HOTELBEDS_RATE_WINDOW_MS: '4000',
    HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
    HOTELBEDS_MOCK_MONGO_URI: 'mongodb://content.example/rimal_content_mock',
    MONGO_URI: 'mongodb://app.example/rimal',
    HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
    HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_PILOT_HOTEL_CODES: '14978',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ contentsync: 3 }),
    HOTELBEDS_DAILY_MAX_REQUESTS: '10'
};

const hotelFixture = {
    code: 14978,
    language: 'ENG',
    name: { content: 'Fixture Content Hotel' },
    category: { code: '4EST', description: '4 STARS' },
    address: { content: '1 Fixture Road', city: 'Dubai', countryName: 'UAE' },
    phones: [{ phoneNumber: '+971-4-555-0100' }],
    description: 'Verified static fixture description.',
    lastUpdate: '2026-10-03T12:00:00.000Z',
    images: [{ path: 'hotel/fixture.jpg', visualOrder: 0, type: { code: 'GEN' } }],
    facilities: [{ facilityCode: 1, facilityGroupCode: 1, description: 'Wi-Fi', voucher: true }],
    issues: []
};

const rateCommentsFixture = {
    hotel: 14978,
    language: 'ENG',
    incoming: 102,
    code: 173049,
    commentsByRates: [
        {
            rateCodes: [2, 0],
            comments: [{ dateStart: '2014-10-24', dateEnd: '2022-12-31',
                description: 'First child until 12 years old free; cot free on request.' }]
        },
        {
            rateCodes: [3],
            comments: [
                { dateStart: '2016-05-01', dateEnd: '2016-09-01', description: 'Minimum age of registration 19.' },
                { dateStart: '2016-09-02', dateEnd: '2016-12-01', description: 'Minimum age of registration 21.' }
            ]
        }
    ],
    issues: [],
    facilities: []
};

function mockContentModel(writes) {
    return class ContentModel {
        constructor(record) {
            Object.assign(this, record);
        }

        validateSync() {
            return undefined;
        }

        static async bulkWrite(operations, options) {
            writes.push({ operations, options });
            return { upsertedCount: operations.length };
        }
    };
}

function createImporter({ contentWrites, ensureCalls, now = () => syncedAt }) {
    return createHotelbedsContentImportService({
        ContentModel: mockContentModel(contentWrites),
        env: importEnv,
        now,
        testOnly: true,
        ensureModelConnected: async model => ensureCalls.push(model)
    });
}

function importOptions() {
    return { hotelCodes: [14978], language: 'ENG', from: 1, pageSize: 10, pageLimit: 1 };
}

function queryResult(value) {
    return { lean() { return this; }, exec: async () => value };
}

test('exports language normalization and normalizes documented category descriptions', () => {
    assert.equal(normalizeLanguage(' eng '), 'ENG');

    const fromCategoryDescription = normalizeHotelContent({ ...hotelFixture });
    assert.deepEqual(fromCategoryDescription.category, { code: '4EST', name: '4 STARS' });

    const fromLocalizedCategoryDescription = normalizeHotelContent({
        ...hotelFixture,
        category: undefined,
        categoryName: undefined,
        categoryCode: '4EST',
        categoryDescription: { description: '4 STARS' }
    });
    assert.deepEqual(fromLocalizedCategoryDescription.category, { code: '4EST', name: '4 STARS' });
    assert.deepEqual(normalizeHotelContent({ ...hotelFixture,
        category: { code: '4EST', description: { content: '4 STARS' } }
    }).category, { code: '4EST', name: '4 STARS' });
});

test('normalizes Hotelbeds rateComments groups into separately addressable rate identities', () => {
    const records = normalizeRateCommentRecord(rateCommentsFixture, {
        hotelCode: 14978,
        language: 'ENG',
        source: 'hotelbeds_content_api',
        syncedAt
    });

    assert.equal(records.length, 2);
    assert.deepEqual(records.map(record => record.rateCodes), ['2 0', '3']);
    assert.ok(records.every(record => record.hotelCode === 14978));
    assert.ok(records.every(record => record.commentsByRates.length === 1));
    for (const record of records) {
        const validationError = new HotelbedsRateComment(record).validateSync();
        assert.equal(validationError, undefined);
    }
    const codeZero = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|0', hotelCode: 14978, language: 'ENG',
        checkIn: '2021-06-15', records, now: syncedAt
    });
    const codeTwo = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|2', hotelCode: 14978, language: 'ENG',
        checkIn: '2021-06-15', records, now: syncedAt
    });
    const codeThree = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|3', hotelCode: 14978, language: 'ENG',
        checkIn: '2016-10-13', records, now: syncedAt
    });
    const unrelatedCode = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|4', hotelCode: 14978, language: 'ENG',
        checkIn: '2021-06-15', records, now: syncedAt
    });
    assert.equal(codeZero.resolved, true);
    assert.deepEqual(codeZero.comments.map(comment => comment.description),
        ['First child until 12 years old free; cot free on request.']);
    assert.deepEqual(codeTwo.comments, codeZero.comments);
    assert.equal(codeThree.resolved, true);
    assert.deepEqual(codeThree.comments.map(comment => comment.description), ['Minimum age of registration 21.']);
    assert.equal(unrelatedCode.resolved, false);

    assert.throws(() => normalizeRateCommentRecord({
        ...rateCommentsFixture,
        hotel: 74002
    }, { hotelCode: 14978, language: 'ENG', source: 'hotelbeds_content_api', syncedAt }),
    error => error.code === 'hotelbeds_rate_comment_import_record_invalid');

    assert.throws(() => normalizeRateCommentRecord({
        ...rateCommentsFixture,
        commentsByRates: [{
            rateCodes: '2 0',
            comments: [{ dateStart: '2026-02-30', dateEnd: '2026-12-31', description: 'Invalid calendar date.' }]
        }]
    }, { hotelCode: 14978, language: 'ENG', source: 'hotelbeds_content_api', syncedAt }),
    error => error.code === 'hotelbeds_rate_comment_import_record_invalid');

    assert.throws(() => normalizeRateCommentRecord({
        ...rateCommentsFixture,
        commentsByRates: [{ rateCodes: '2 0', comments: [] }]
    }, { hotelCode: 14978, language: 'ENG', source: 'hotelbeds_content_api', syncedAt }),
    error => error.code === 'hotelbeds_rate_comment_import_record_invalid');

    assert.throws(() => normalizeRateCommentRecord({
        ...rateCommentsFixture,
        commentsByRates: [{ rateCodes: '2 2', comments: rateCommentsFixture.commentsByRates[0].comments }]
    }, { hotelCode: 14978, language: 'ENG', source: 'hotelbeds_content_api', syncedAt }),
    error => error.code === 'hotelbeds_rate_comment_import_record_invalid');

    assert.deepEqual(normalizeRateCommentRecord({
        ...rateCommentsFixture,
        commentsByRates: [{ ...rateCommentsFixture.commentsByRates[0], rateCodes: '2   0' }]
    }, { hotelCode: 14978, language: 'ENG', source: 'hotelbeds_content_api', syncedAt })
        .map(record => record.rateCodes), ['2 0']);
});

test('Availability fetches rate comment records by supplier identity and resolves only the selected rate code', async () => {
    const env = {
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
        HOTELBEDS_PILOT_APPROVED: 'true',
        HOTELBEDS_PILOT_HOTEL_CODES: '14978',
        HOTELBEDS_PILOT_LANGUAGE: 'ENG',
        HOTELBEDS_PILOT_PRICE_POLICY: 'supplier-raw-internal-only',
        HOTELBEDS_PILOT_OPERATOR_KEY: 'fixture-operator-key-0123456789abcdef',
        HOTELBEDS_DAILY_MAX_REQUESTS: '10',
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ availability: 3 })
    };
    const rateCommentRecords = normalizeRateCommentRecord(rateCommentsFixture, {
        hotelCode: 14978,
        language: 'ENG',
        source: 'hotelbeds_content_api',
        syncedAt
    });
    const contentQueries = [];
    const rateCommentQueries = [];
    const ensureCalls = [];
    const contentModel = {
        find(query) {
            contentQueries.push(query);
            return queryResult([]);
        }
    };
    const rateCommentModel = {
        find(query) {
            rateCommentQueries.push(query);
            return queryResult(rateCommentRecords);
        }
    };
    const service = createHotelbedsAvailabilityService({
        env,
        now: () => syncedAt,
        testOnly: true,
        ensureModelConnected: async model => ensureCalls.push(model),
        client: {
            availability: async () => ({
                ok: true,
                data: {
                    hotels: {
                        hotels: [{
                            code: 14978,
                            rooms: [{ rates: [
                                { rateKey: 'fixture-rate-zero', rateCommentsId: '102|173049|0' },
                                { rateKey: 'fixture-rate-four', rateCommentsId: '102|173049|4' }
                            ] }]
                        }]
                    }
                }
            })
        },
        ContentModel: contentModel,
        RateCommentModel: rateCommentModel
    });

    const result = await service.searchAvailability({
        checkIn: '2021-06-15',
        checkOut: '2021-06-16',
        hotelCodes: [14978],
        occupancies: [{ rooms: 1, adults: 2, children: 0 }]
    });

    assert.equal(contentQueries.length, 1);
    assert.deepEqual(contentQueries[0], { hotelCode: { $in: [14978] }, language: 'ENG' });
    assert.equal(rateCommentQueries.length, 1);
    assert.deepEqual(rateCommentQueries[0], {
        $or: [{ hotelCode: 14978, language: 'ENG', incoming: '102', code: '173049' }],
        source: 'hotelbeds_content_api'
    });
    assert.deepEqual(ensureCalls, [contentModel, contentModel, rateCommentModel]);
    assert.equal(result.hotels[0].rooms[0].rates[0].rateCommentsResolved, true);
    assert.deepEqual(result.hotels[0].rooms[0].rates[0].rateComments.map(comment => comment.description), [
        'First child until 12 years old free; cot free on request.'
    ]);
    assert.equal(result.hotels[0].rooms[0].rates[1].rateCommentsResolved, false);
    assert.deepEqual(result.hotels[0].rooms[0].rates[1].rateComments, []);
});

test('content importer requests approved hotel codes and writes normalized content only', async () => {
    const contentWrites = [];
    const ensureCalls = [];
    const importer = createImporter({ contentWrites, ensureCalls });
    const pageCalls = [];

    const result = await importer.importContent(importOptions(), {
        fetchPage: async query => {
            pageCalls.push(query);
            return { hotels: [hotelFixture] };
        }
    });

    assert.deepEqual(pageCalls, [{
        language: 'ENG', from: 1, to: 10, fields: 'all', codes: [14978]
    }]);
    assert.equal(result.importedCount, 1);
    assert.equal(result.supplierRequests, 1);
    assert.equal(result.categoryRequestCount, 0);
    assert.equal(contentWrites.length, 1);
    assert.equal(contentWrites[0].operations.length, 1);
    assert.equal(contentWrites[0].options.ordered, true);
    assert.equal(ensureCalls.length, 1);
});

test('content importer keeps a code-only category and absent phone without fabricating recommended values', async () => {
    const contentWrites = [];
    const importer = createImporter({ contentWrites, ensureCalls: [] });
    const officialHotel = {
        code: 14978,
        language: 'ENG',
        name: { content: 'Hotel without recommended fields' },
        categoryCode: '4EST',
        address: { content: '1 Fixture Road', city: 'Dubai' },
        description: 'Verified static fixture description.',
        images: [{ path: 'hotel/fixture.jpg', visualOrder: 0, type: { code: 'GEN' } }],
        facilities: [{ facilityCode: 1, facilityGroupCode: 1, description: 'Wi-Fi' }],
        issues: []
    };
    const result = await importer.importContent(importOptions(), {
        fetchPage: async () => ({ hotels: [officialHotel] }),
        fetchCategories: async () => ({ categories: [{ code: '4EST' }] })
    });
    const content = contentWrites[0].operations[0].updateOne.update.$set.content;
    assert.equal(result.importedCount, 1);
    assert.deepEqual(content.category, { code: '4EST' });
    assert.equal(Object.hasOwn(content, 'phone'), false);
});

test('imports official Hotels fields and resolves categoryCode through one bounded dictionary request', async () => {
    const contentWrites = [];
    const ensureCalls = [];
    const importer = createImporter({ contentWrites, ensureCalls });
    const officialHotel = {
        code: 14978,
        name: { content: 'Official-shaped hotel' },
        categoryCode: '4EST',
        address: { content: '1 Content API Road' },
        city: { content: 'Dubai' },
        countryCode: 'AE',
        phones: [{ phoneNumber: '+97145550100', phoneType: 'PHONEHOTEL' }],
        description: { content: 'Hotel description from the official response shape.' },
        lastUpdate: '2026-10-03',
        images: [
            { path: '00/000149/000149a_hb_ro_001.jpg', type: { code: 'GEN' } },
            { path: '00/000149/000149a_hb_ro_002.jpg', order: 1, type: { code: 'HAB' } }
        ],
        facilities: [{
            facilityCode: 330, facilityGroupCode: 70,
            description: { content: 'Garage' }, indFee: true, indYesOrNo: true, indLogic: true
        }],
        issues: [{ issueCode: 'POOL', issueType: 'CLOSED', dateFrom: '2026-10-01',
            dateTo: '2026-10-10', description: { content: 'Pool maintenance.' } }]
    };
    const categoryCalls = [];

    const result = await importer.importContent(importOptions(), {
        fetchPage: async () => ({ hotels: [officialHotel] }),
        fetchCategories: async options => {
            categoryCalls.push(options);
            return { categories: [{ code: '4EST', description: { content: '4 STARS' } }] };
        }
    });

    assert.deepEqual(categoryCalls, [{ language: 'ENG', from: 1, to: 1, fields: 'all', codes: ['4EST'] }]);
    assert.equal(result.categoryRequestCount, 1);
    assert.equal(result.supplierRequests, 2);
    const update = contentWrites[0].operations[0].updateOne.update.$set;
    assert.equal(update.content.category.code, '4EST');
    assert.equal(update.content.category.name, '4 STARS');
    assert.equal(update.content.name, 'Official-shaped hotel');
    assert.equal(update.content.address, '1 Content API Road, Dubai, AE');
    assert.equal(update.content.images[0].visualOrder, 0);
    assert.equal(update.content.images[1].visualOrder, 1);
    assert.equal(update.content.facilities[0].indFee, true);
    assert.equal(update.content.facilities[0].indYesOrNo, true);
    assert.equal(update.content.issues[0].description, 'Pool maintenance.');
});

test('preserves only requested-language ApiContent and category descriptions', async () => {
    const contentWrites = [];
    const ensureCalls = [];
    const importer = createImporter({ contentWrites, ensureCalls });
    const localizedHotel = {
        ...hotelFixture,
        name: { content: 'Fixture Content Hotel', languageCode: 'ENG' },
        category: { code: '4EST', description: { content: '4 STARS', languageCode: 'ENG' } },
        address: { content: '1 Fixture Road', languageCode: 'ENG' },
        description: { content: 'Verified static fixture description.', languageCode: 'ENG' },
        facilities: [{ ...hotelFixture.facilities[0], description: { content: 'Wi-Fi', languageCode: 'ENG' } }],
        issues: [{ description: { content: 'Pool maintenance.', languageCode: 'ENG' } }]
    };

    await importer.importContent(importOptions(), {
        fetchPage: async () => ({ hotels: [localizedHotel] })
    });

    assert.equal(contentWrites[0].operations[0].updateOne.update.$set.content.name, 'Fixture Content Hotel');
    assert.equal(contentWrites[0].operations[0].updateOne.update.$set.content.category.name, '4 STARS');

    for (const mismatchedHotel of [
        { ...localizedHotel, name: { content: 'Hotel en español', languageCode: 'CAS' } },
        { ...localizedHotel, address: { content: 'Dirección', languageCode: 'CAS' } },
        { ...localizedHotel, facilities: [{ ...hotelFixture.facilities[0],
            description: { content: 'Wi-Fi', languageCode: 'CAS' } }] }
    ]) {
        await assert.rejects(importer.importContent(importOptions(), {
            fetchPage: async () => ({ hotels: [mismatchedHotel] })
        }), error => error.code === 'hotelbeds_content_import_language_mismatch');
    }

    const categoryWrites = [];
    const categoryImporter = createImporter({ contentWrites: categoryWrites, ensureCalls: [] });
    const hotelWithoutCategoryDescription = {
        ...localizedHotel,
        category: undefined,
        categoryCode: '4EST'
    };
    await assert.rejects(categoryImporter.importContent(importOptions(), {
        fetchPage: async () => ({ hotels: [hotelWithoutCategoryDescription] }),
        fetchCategories: async () => ({ categories: [{
            code: '4EST', description: { content: '4 ESTRELLAS', languageCode: 'CAS' }
        }] })
    }), error => error.code === 'hotelbeds_content_import_language_mismatch');
    assert.equal(categoryWrites.length, 0);
});

test('does not connect before fetching or validating supplier content', async () => {
    const contentWrites = [];
    const ensureCalls = [];
    const importer = createImporter({ contentWrites, ensureCalls });

    await assert.rejects(importer.importContent(importOptions(), {
        fetchPage: async () => ({ hotels: [] })
    }), error => error.code === 'hotelbeds_content_import_approved_hotel_missing');

    assert.equal(ensureCalls.length, 0);
    assert.equal(contentWrites.length, 0);
});

test('incremental no-change response does not overwrite existing content or connect to the database', async () => {
    const contentWrites = [];
    const ensureCalls = [];
    const importer = createImporter({ contentWrites, ensureCalls });
    const pageCalls = [];
    const result = await importer.importContent({ ...importOptions(), lastUpdateTime: '2026-10-01' }, {
        fetchPage: async options => {
            pageCalls.push(options);
            return { hotels: [] };
        }
    });

    assert.equal(pageCalls[0].lastUpdateTime, '2026-10-01');
    assert.deepEqual(pageCalls[0].codes, [14978]);
    assert.equal(result.importedCount, 0);
    assert.equal(contentWrites.length, 0);
    assert.equal(ensureCalls.length, 0);
});

test('content import approval and supplier-operation budgets remain fail-closed', () => {
    assert.throws(() => contentImportPlan(importOptions(), {
        ...importEnv,
        HOTELBEDS_CONTENT_IMPORT_APPROVED: 'false'
    }), error => error.code === 'hotelbeds_content_import_not_approved');

    assert.throws(() => contentImportPlan({
        ...importOptions(),
        pageLimit: 2
    }, importEnv), error => error.code === 'hotelbeds_content_import_page_limit_invalid');

    assert.throws(() => contentImportPlan(importOptions(), {
        ...importEnv,
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ contentsync: 1 })
    }), error => error.code === 'hotelbeds_content_import_operation_budget_exceeded');
});