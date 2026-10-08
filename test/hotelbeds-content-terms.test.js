const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHotelbedsAvailabilityService } = require('../services/hotelbedsAvailabilityService');
const { resolveHotelbedsRateComments } = require('../services/hotelbedsRateCommentResolver');
const { normalizeHotelbedsHotel } = require('../services/offerNormalizationService');

const now = new Date('2026-10-04T12:00:00.000Z');
const hotelContentSyncedAt = new Date('2026-10-04T11:00:00.000Z');
const hotelCode = 12345;

function queryResult(value) {
    return { lean() { return this; }, exec: async () => value };
}

function contentRecord() {
    return {
        hotelCode,
        language: 'ENG',
        source: 'hotelbeds_content_api',
        syncedAt: hotelContentSyncedAt,
        content: {
            contentStatus: 'complete',
            name: 'Verified Fixture Hotel',
            category: { code: '4EST', name: '4 STARS' },
            description: 'Verified fixture hotel description.',
            images: [{ path: 'hotel/verified.jpg', visualOrder: 0, type: { code: 'GEN' } }],
            issues: [
                { dateFrom: '2030-06-15', dateTo: '2030-06-15', description: 'Pool closure applies.' },
                { dateFrom: '2030-07-01', dateTo: '2030-07-31', description: 'Unrelated dated issue.' }
            ],
            facilities: [
                { description: 'Airport transfer', voucher: true, indFee: true, amount: '25.00', currency: 'EUR' },
                { description: 'Internal housekeeping', voucher: false, indFee: false }
            ]
        }
    };
}

function rateCommentRecord({ syncedAt = hotelContentSyncedAt, rateCodes = '2 0', comments } = {}) {
    return {
        hotelCode,
        language: 'ENG',
        source: 'hotelbeds_content_api',
        incoming: '102',
        code: '173049',
        rateCodes,
        commentsByRates: [{ rateCodes, comments: comments || [
            { dateStart: '2030-01-01', dateEnd: '2030-12-31', description: 'Year-round rate condition.' },
            { dateStart: '2030-06-15', dateEnd: '2030-06-30', description: 'Additional condition for this stay.' }
        ] }],
        syncedAt
    };
}

function availabilityEnv() {
    return {
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
        HOTELBEDS_PILOT_APPROVED: 'true',
        HOTELBEDS_PILOT_HOTEL_CODES: String(hotelCode),
        HOTELBEDS_PILOT_LANGUAGE: 'ENG',
        HOTELBEDS_PILOT_PRICE_POLICY: 'supplier-raw-internal-only',
        HOTELBEDS_PILOT_OPERATOR_KEY: 'fixture-operator-key-0123456789abcdef',
        HOTELBEDS_DAILY_MAX_REQUESTS: '10',
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ availability: 3 })
    };
}

test('rate comment resolution returns all applicable comments and only the latest fresh batch', () => {
    const current = rateCommentRecord();
    const stale = rateCommentRecord({
        syncedAt: new Date(hotelContentSyncedAt.getTime() - 60_000),
        rateCodes: '0',
        comments: [{ dateStart: '2030-01-01', dateEnd: '2030-12-31',
            description: 'Stale condition from the previous batch.' }]
    });
    const records = [current, stale];
    const latestBatch = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|0', hotelCode, language: 'ENG',
        checkIn: '2030-06-15', records, now
    });
    assert.equal(latestBatch.resolved, true);
    assert.deepEqual(latestBatch.comments.map(comment => comment.description), [
        'Year-round rate condition.', 'Additional condition for this stay.'
    ]);

    const withBoundaries = rateCommentRecord({ rateCodes: '3', comments: [
        { dateStart: '2016-05-01', dateEnd: '2016-09-01', description: 'Condition through September 1.' },
        { dateStart: '2016-09-02', dateEnd: '2016-12-01', description: 'Condition from September 2.' }
    ] });
    const firstBoundary = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|3', hotelCode, language: 'ENG',
        checkIn: '2016-09-01', records: [withBoundaries], now
    });
    const secondBoundary = resolveHotelbedsRateComments({
        rateCommentsId: '102|173049|3', hotelCode, language: 'ENG',
        checkIn: '2016-09-02', records: [withBoundaries], now
    });
    assert.deepEqual(firstBoundary.comments.map(comment => comment.description), ['Condition through September 1.']);
    assert.deepEqual(secondBoundary.comments.map(comment => comment.description), ['Condition from September 2.']);
});

test('availability carries verified hotel issues and voucher facilities into normalized offer terms', async () => {
    const currentRateComment = rateCommentRecord();
    const staleRateComment = rateCommentRecord({
        syncedAt: new Date(hotelContentSyncedAt.getTime() - 60_000),
        rateCodes: '0',
        comments: [{ dateStart: '2030-01-01', dateEnd: '2030-12-31',
            description: 'Stale condition from the previous batch.' }]
    });
    const contentQueries = [];
    const rateCommentQueries = [];
    const service = createHotelbedsAvailabilityService({
        env: availabilityEnv(),
        now: () => now,
        testOnly: true,
        ensureModelConnected: async () => {},
        client: {
            availability: async () => ({ ok: true, data: { hotels: { hotels: [{
                code: hotelCode,
                name: 'Supplier Hotel Name',
                currency: 'EUR',
                rooms: [{ code: 'DBL.ST', name: 'Double Standard', rates: [{
                    rateKey: 'fixture-private-rate-key',
                    rateCommentsId: '102|173049|0',
                    rateType: 'BOOKABLE', rateClass: 'NOR', paymentType: 'AT_WEB',
                    net: '100.00', rooms: 1, adults: 2, children: 0,
                    boardCode: 'BB', boardName: 'Bed and Breakfast',
                    cancellationPolicies: [], taxes: { allIncluded: true, taxes: [] }
                }] }]
            }] } } })
        },
        ContentModel: { find(query) {
            contentQueries.push(query);
            return queryResult([contentRecord()]);
        } },
        RateCommentModel: { find(query) {
            rateCommentQueries.push(query);
            return queryResult([currentRateComment, staleRateComment]);
        } }
    });

    const result = await service.searchAvailability({
        checkIn: '2030-06-15', checkOut: '2030-06-16', hotelCodes: [hotelCode],
        occupancies: [{ rooms: 1, adults: 2, children: 0 }]
    });
    const hotel = result.hotels[0];
    const rate = hotel.rooms[0].rates[0];
    const offer = normalizeHotelbedsHotel(hotel, {
        stay: { checkIn: '2030-06-15', checkOut: '2030-06-16' }
    })[0];

    assert.deepEqual(contentQueries[0], { hotelCode: { $in: [hotelCode] }, language: 'ENG' });
    assert.deepEqual(rateCommentQueries[0], {
        $or: [{ hotelCode, language: 'ENG', incoming: '102', code: '173049' }],
        source: 'hotelbeds_content_api'
    });
    assert.equal(rate.rateCommentsResolved, true);
    assert.deepEqual(rate.rateComments.map(comment => comment.description), [
        'Year-round rate condition.', 'Additional condition for this stay.'
    ]);
    assert.deepEqual(offer.contractTerms.issues, ['Pool closure applies.']);
    assert.deepEqual(offer.contractTerms.mandatoryFacilities, [{
        description: 'Airport transfer', fee: true, amount: '25.00', currency: 'EUR', present: null
    }]);
    assert.equal(offer.rateComments.some(comment => comment.description.includes('Stale condition')), false);
    assert.equal(offer.contractTerms.issues.includes('Unrelated dated issue.'), false);
    assert.equal(offer.contractTerms.mandatoryFacilities.some(item =>
        item.description === 'Internal housekeeping'), false);
});