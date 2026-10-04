const { test } = require('node:test');
const assert = require('node:assert/strict');
const HotelbedsHotel = require('./models/HotelbedsHotel');
const {
    PILOT_HOTEL_CODES,
    LANGUAGE,
    MOCK_HOTELS,
    DEFAULT_MOCK_MONGO_URI,
    mongoTargetFrom,
    mockMongoUriFrom,
    recordsAt,
    contentForAvailability,
    seedMockHotelbedsContent
} = require('./scripts/seed-mock-hotelbeds-content');

test('mock content fixtures cover only the four pilot codes and validate against HotelbedsHotel', () => {
    const records = recordsAt(new Date('2026-10-01T12:00:00.000Z'));
    assert.deepEqual(records.map(record => record.hotelCode), [...PILOT_HOTEL_CODES]);
    assert.deepEqual(MOCK_HOTELS.map(record => record.hotelCode), [...PILOT_HOTEL_CODES]);
    for (const record of records) {
        const document = new HotelbedsHotel(record);
        assert.equal(document.validateSync(), undefined);
        assert.equal(record.language, LANGUAGE);
        assert.equal(record.contentStatus, 'complete');
        assert.ok(record.images.length >= 2);
        assert.ok(record.images.every(image => image.path.startsWith('mock/')));
        assert.ok(record.images.some(image => image.roomCode));
        assert.ok(record.images.some(image => image.visualOrder === 0));
        assert.ok(record.facilities.length >= 2);
        assert.ok(record.facilities.every(facility => Number.isInteger(facility.facilityCode)
            && Number.isInteger(facility.facilityGroupCode)
            && typeof facility.description === 'string'));
        assert.ok(record.facilities.some(facility => typeof facility.indFee === 'boolean'));
    }
});

test('mock content seeder clears only pilot hotel codes and bulk-upserts both collections offline', async () => {
    const calls = { deletes: [], hotelWrites: [], contentWrites: [] };
    function FixtureHotel(record) {
        const document = new HotelbedsHotel(record);
        return {
            _id: document._id,
            hotelCode: document.hotelCode,
            language: document.language,
            validateSync: () => document.validateSync(),
            toObject: () => document.toObject()
        };
    }
    FixtureHotel.deleteMany = async filter => { calls.deletes.push(filter); };
    FixtureHotel.bulkWrite = async (operations, options) => {
        calls.hotelWrites.push({ operations, options });
        return { upsertedCount: operations.length };
    };
    const FixtureContent = {
        bulkWrite: async (operations, options) => {
            calls.contentWrites.push({ operations, options });
            return { upsertedCount: operations.length };
        }
    };

    const result = await seedMockHotelbedsContent({
        HotelModel: FixtureHotel,
        ContentModel: FixtureContent,
        testOnly: true,
        ensureModelsConnected: async () => {},
        now: () => new Date('2026-10-01T12:00:00.000Z')
    });

    assert.deepEqual(calls.deletes, [{
        hotelCode: { $in: [...PILOT_HOTEL_CODES] },
        language: LANGUAGE,
        contentSource: 'mock_fixture'
    }]);
    assert.equal(calls.hotelWrites.length, 1);
    assert.equal(calls.hotelWrites[0].operations.length, 4);
    assert.ok(calls.hotelWrites[0].operations.every(operation => operation.replaceOne.upsert));
    assert.equal(calls.contentWrites.length, 1);
    assert.equal(calls.contentWrites[0].operations.length, 4);
    assert.ok(calls.contentWrites[0].operations.every(operation => operation.updateOne.upsert));
    assert.deepEqual(result.hotelIds.map(item => item.hotelCode), [...PILOT_HOTEL_CODES]);
    assert.ok(result.hotelIds.every(item => item.id));

    const cachedContent = calls.contentWrites[0].operations[0].updateOne.update.$set.content;
    assert.equal(cachedContent.contentStatus, 'complete');
    assert.ok(cachedContent.images[0].path.startsWith('mock/'));
    assert.ok(Array.isArray(cachedContent.facilities));
});

test('mock seeder accepts isolated local/cloud mock DBs and rejects the application database', () => {
    assert.equal(mockMongoUriFrom({}), DEFAULT_MOCK_MONGO_URI);
    assert.equal(mockMongoUriFrom({
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb://localhost:27017/rimal_hotelbeds_mock'
    }), 'mongodb://localhost:27017/rimal_hotelbeds_mock');
    assert.equal(mockMongoUriFrom({
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb+srv://user:secret@cluster.example/rimal_hotelbeds_mock',
        MONGO_URI: 'mongodb+srv://user:secret@cluster.example/rimal_db'
    }), 'mongodb+srv://user:secret@cluster.example/rimal_hotelbeds_mock');

    assert.throws(() => mockMongoUriFrom({
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb+srv://user:secret@cluster.example/rimal_db',
        MONGO_URI: 'mongodb+srv://user:secret@cluster.example/rimal_db'
    }), error => error.code === 'mock_mongo_database_name_required');
    assert.throws(() => mockMongoUriFrom({
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb+srv://user:secret@cluster.example/rimal_hotelbeds_mock',
        MONGO_URI: 'mongodb+srv://user:secret@cluster.example/rimal_hotelbeds_mock'
    }), error => error.code === 'mock_mongo_must_not_target_application_database');
    assert.throws(() => mockMongoUriFrom({
        HOTELBEDS_MOCK_MONGO_URI: 'not-a-mongo-uri'
    }), error => error.code === 'mock_mongo_uri_invalid');
    assert.throws(() => mongoTargetFrom('mongodb://localhost/', 'application_mongo_uri_invalid'),
        error => error.code === 'application_mongo_uri_invalid');
});

test('availability cache projection retains mock hotel details needed by in-memory merge', () => {
    const record = recordsAt()[0];
    const content = contentForAvailability(record);
    assert.equal(content.name, record.name);
    assert.deepEqual(content.category, record.category);
    assert.equal(content.contentStatus, 'complete');
    assert.ok(content.images.some(image => image.roomCode));
    assert.ok(content.facilities.some(facility => facility.indYesOrNo === true));
});