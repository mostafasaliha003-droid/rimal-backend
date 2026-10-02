const path = require('node:path');

const PILOT_HOTEL_CODES = Object.freeze([74, 1067, 1070, 295423]);
const LANGUAGE = 'ENG';
const DEFAULT_MOCK_MONGO_URI = 'mongodb://127.0.0.1:27017/rimal_hotelbeds_mock';

// Entirely synthetic fixture content. Image paths are deliberately non-routable
// placeholders and must never be presented as real Hotelbeds property content.
const MOCK_HOTELS = Object.freeze([
    {
        hotelCode: 74,
        language: LANGUAGE,
        name: 'Mock Palm Harbor Hotel',
        category: { code: '4EST', name: '4 Star Mock Hotel' },
        address: '14 Example Palm Avenue, Dubai, United Arab Emirates',
        phone: '+971-4-555-0074',
        images: [
            { path: 'mock/hotel-74/exterior.jpg', visualOrder: 0, order: 1, type: { code: 'GEN', description: 'General view (mock)' }, roomCode: '' },
            { path: 'mock/hotel-74/lobby.jpg', visualOrder: 1, order: 2, type: { code: 'GEN', description: 'Lobby (mock)' }, roomCode: '' },
            { path: 'mock/hotel-74/deluxe-room.jpg', visualOrder: 2, order: 1, type: { code: 'HAB', description: 'Room (mock)' }, roomCode: 'DBT.DX' }
        ],
        facilities: [
            { facilityCode: 320, facilityGroupCode: 70, description: 'Mock parking', order: 1, indFee: true, indYesOrNo: true, amount: 25, currency: 'AED', voucher: true, applicationType: 'UN' },
            { facilityCode: 100, facilityGroupCode: 70, description: 'Mock Wi-Fi', order: 2, indFee: false, indYesOrNo: true, voucher: true },
            { facilityCode: 230, facilityGroupCode: 60, description: 'Mock balcony', order: 1, indFee: false, indLogic: true, voucher: false }
        ]
    },
    {
        hotelCode: 1067,
        language: LANGUAGE,
        name: 'Mock Creekside Suites',
        category: { code: '5EST', name: '5 Star Mock Hotel' },
        address: '1067 Sample Creek Road, Dubai, United Arab Emirates',
        phone: '+971-4-555-1067',
        images: [
            { path: 'mock/hotel-1067/facade.jpg', visualOrder: 0, order: 1, type: { code: 'GEN', description: 'Facade (mock)' }, roomCode: '' },
            { path: 'mock/hotel-1067/pool.jpg', visualOrder: 1, order: 2, type: { code: 'POOL', description: 'Pool (mock)' }, roomCode: '' },
            { path: 'mock/hotel-1067/suite.jpg', visualOrder: 2, order: 1, type: { code: 'HAB', description: 'Suite (mock)' }, roomCode: 'STE.KG' }
        ],
        facilities: [
            { facilityCode: 320, facilityGroupCode: 70, description: 'Mock valet parking', order: 1, indFee: true, indYesOrNo: true, amount: 40, currency: 'AED', voucher: true, applicationType: 'UN' },
            { facilityCode: 100, facilityGroupCode: 70, description: 'Mock high-speed Wi-Fi', order: 2, indFee: false, indYesOrNo: true, voucher: true },
            { facilityCode: 295, facilityGroupCode: 60, description: 'Mock suite size (sqm)', order: 3, number: 68, indYesOrNo: true, voucher: false }
        ]
    },
    {
        hotelCode: 1070,
        language: LANGUAGE,
        name: 'Mock Garden Court Hotel',
        category: { code: '3EST', name: '3 Star Mock Hotel' },
        address: '1070 Demo Garden Street, Abu Dhabi, United Arab Emirates',
        phone: '+971-2-555-1070',
        images: [
            { path: 'mock/hotel-1070/garden.jpg', visualOrder: 0, order: 1, type: { code: 'GEN', description: 'Garden (mock)' }, roomCode: '' },
            { path: 'mock/hotel-1070/restaurant.jpg', visualOrder: 1, order: 2, type: { code: 'RES', description: 'Restaurant (mock)' }, roomCode: '' },
            { path: 'mock/hotel-1070/twin-room.jpg', visualOrder: 2, order: 1, type: { code: 'HAB', description: 'Twin room (mock)' }, roomCode: 'TWN.ST' }
        ],
        facilities: [
            { facilityCode: 100, facilityGroupCode: 70, description: 'Mock public-area Wi-Fi', order: 1, indFee: false, indYesOrNo: true, voucher: true },
            { facilityCode: 320, facilityGroupCode: 70, description: 'Mock nearby parking', order: 2, indFee: true, indYesOrNo: true, amount: 15, currency: 'AED', voucher: true },
            { facilityCode: 230, facilityGroupCode: 60, description: 'Mock balcony', order: 1, indFee: false, indLogic: false, voucher: false }
        ]
    },
    {
        hotelCode: 295423,
        language: LANGUAGE,
        name: 'Mock Marina View Residence',
        category: { code: 'APTH', name: 'Mock Apartment Hotel' },
        address: '295423 Fictional Marina Walk, Dubai, United Arab Emirates',
        phone: '+971-4-555-5423',
        images: [
            { path: 'mock/hotel-295423/marina-view.jpg', visualOrder: 0, order: 1, type: { code: 'GEN', description: 'Marina view (mock)' }, roomCode: '' },
            { path: 'mock/hotel-295423/kitchen.jpg', visualOrder: 1, order: 2, type: { code: 'GEN', description: 'Kitchen (mock)' }, roomCode: '' },
            { path: 'mock/hotel-295423/one-bedroom.jpg', visualOrder: 2, order: 1, type: { code: 'HAB', description: 'One-bedroom apartment (mock)' }, roomCode: 'APT.1B' }
        ],
        facilities: [
            { facilityCode: 100, facilityGroupCode: 70, description: 'Mock in-room Wi-Fi', order: 1, indFee: false, indYesOrNo: true, voucher: true },
            { facilityCode: 320, facilityGroupCode: 70, description: 'Mock secured parking', order: 2, indFee: false, indYesOrNo: true, voucher: true },
            { facilityCode: 295, facilityGroupCode: 60, description: 'Mock apartment size (sqm)', order: 1, number: 82, indYesOrNo: true, voucher: false }
        ]
    }
]);

function fail(code) {
    return Object.assign(new Error(code), { code });
}

function mongoTargetFrom(raw, errorCode) {
    let uri;
    try { uri = new URL(String(raw || '').trim()); } catch { throw fail(errorCode); }
    const database = decodeURIComponent(uri.pathname.replace(/^\//, '').replace(/\/$/, ''));
    if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol) || !uri.hostname
        || !database || database.includes('/') || uri.hash) {
        throw fail(errorCode);
    }
    return { uri: String(raw).trim(), host: uri.hostname.toLowerCase(), database };
}

function mockMongoUriFrom(env = process.env) {
    const configuredMockUri = String(env.HOTELBEDS_MOCK_MONGO_URI || '').trim();
    const target = mongoTargetFrom(configuredMockUri || DEFAULT_MOCK_MONGO_URI, 'mock_mongo_uri_invalid');
    if (!target.database.toLowerCase().includes('mock')) {
        throw fail('mock_mongo_database_name_required');
    }

    const applicationUri = String(env.MONGO_URI || '').trim();
    if (applicationUri) {
        const application = mongoTargetFrom(applicationUri, 'application_mongo_uri_invalid');
        if (target.database.toLowerCase() === application.database.toLowerCase()) {
            throw fail('mock_mongo_must_not_target_application_database');
        }
    }
    return target.uri;
}

function recordsAt(syncedAt = new Date()) {
    const date = new Date(syncedAt);
    if (Number.isNaN(date.getTime())) throw fail('mock_content_sync_date_invalid');
    return MOCK_HOTELS.map(hotel => ({
        ...hotel,
        category: { ...hotel.category },
        images: hotel.images.map(image => ({ ...image, type: { ...image.type } })),
        facilities: hotel.facilities.map(facility => ({ ...facility })),
        contentStatus: 'complete',
        contentSource: 'mock_fixture',
        sourceUpdatedAt: date,
        syncedAt: date
    }));
}

function contentForAvailability(record) {
    return {
        name: record.name,
        category: { ...record.category },
        address: record.address,
        phone: record.phone,
        images: record.images.map(image => ({ ...image, type: { ...image.type } })),
        facilities: record.facilities.map(facility => ({ ...facility })),
        contentStatus: record.contentStatus
    };
}

async function seedMockHotelbedsContent({
    HotelModel,
    ContentModel,
    now = () => new Date(),
    env = process.env,
    database = require('../services/hotelbedsMockDatabase'),
    testOnly = false,
    ensureModelsConnected: testEnsureModelsConnected
} = {}) {
    if (!HotelModel || !ContentModel) throw fail('mock_content_models_required');
    if (testOnly && (typeof testEnsureModelsConnected !== 'function' || process.env.NODE_ENV === 'production')
        || !testOnly && testEnsureModelsConnected !== undefined) {
        throw fail('mock_content_database_dependency_invalid');
    }
    const records = recordsAt(now());

    // Validate the complete fixture set before deleting or writing any records.
    const documents = records.map(record => {
        const document = new HotelModel(record);
        const validationError = document.validateSync();
        if (validationError) throw validationError;
        return document;
    });

    if (testOnly) {
        await testEnsureModelsConnected(HotelModel, ContentModel);
    } else {
        await database.ensureModelConnected(HotelModel, { env, errorCode: 'hotelbeds_content_database_unavailable' });
        await database.ensureModelConnected(ContentModel, { env, errorCode: 'hotelbeds_content_database_unavailable' });
    }

    await HotelModel.deleteMany({
        hotelCode: { $in: [...PILOT_HOTEL_CODES] },
        language: LANGUAGE,
        contentSource: 'mock_fixture'
    });
    const hotelWriteResult = await HotelModel.bulkWrite(documents.map(document => ({
        replaceOne: {
            filter: { hotelCode: document.hotelCode, language: document.language, contentSource: 'mock_fixture' },
            replacement: document.toObject(),
            upsert: true
        }
    })), { ordered: true });

    const contentWriteResult = await ContentModel.bulkWrite(records.map(record => ({
        updateOne: {
            filter: { hotelCode: record.hotelCode, language: record.language, source: 'mock_fixture' },
            update: {
                $set: {
                    content: contentForAvailability(record),
                    source: 'mock_fixture',
                    sourceUpdatedAt: record.sourceUpdatedAt,
                    syncedAt: record.syncedAt
                },
                $setOnInsert: { hotelCode: record.hotelCode, language: record.language }
            },
            upsert: true
        }
    })), { ordered: true });

    return {
        hotelCodes: [...PILOT_HOTEL_CODES],
        hotelIds: documents.map(document => ({ hotelCode: document.hotelCode, id: String(document._id) })),
        hotelWriteResult,
        contentWriteResult
    };
}

async function main() {
    // Load only project .env values after clearing inherited DB and Hotelbeds
    // settings. Never log either Mongo URI or its credentials.
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('HOTELBEDS_')) delete process.env[key];
    }
    delete process.env.MONGO_URI;
    const dotenv = require('dotenv');
    const loaded = dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true, quiet: true });
    if (loaded.error) throw fail('dotenv_load_failed');
    if (!String(process.env.HOTELBEDS_MOCK_MONGO_URI || '').trim()) {
        throw fail('hotelbeds_mock_mongo_uri_required');
    }

    const mongoUri = mockMongoUriFrom({
        ...process.env,
        MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rimal'
    });
    const databaseEnv = {
        ...process.env,
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_MOCK_MONGO_URI: mongoUri,
        MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rimal'
    };
    const database = require('../services/hotelbedsMockDatabase');
    if (process.env.HOTELBEDS_MOCK_MONGO_URI !== mongoUri) throw fail('mock_mongo_target_mismatch');
    const HotelModel = require('../models/HotelbedsHotel');
    const ContentModel = require('../models/HotelbedsHotelContent');

    try {
        await database.ensureModelConnected(HotelModel, { env: databaseEnv, connectTimeoutMs: 3000 });
        await database.ensureModelConnected(ContentModel, { env: databaseEnv, connectTimeoutMs: 3000 });
        const result = await seedMockHotelbedsContent({ HotelModel, ContentModel, env: databaseEnv, database });
        process.stdout.write(`${JSON.stringify({ ok: true, database: 'rimal_hotelbeds_mock', ...result }, null, 2)}\n`);
    } finally {
        await database.close();
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${JSON.stringify({
            ok: false,
            error: error.code || 'mock_hotelbeds_content_seed_failed',
            hint: 'Set HOTELBEDS_MOCK_MONGO_URI to an isolated MongoDB database whose name includes mock; it must not target the application database.'
        })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    PILOT_HOTEL_CODES,
    LANGUAGE,
    MOCK_HOTELS,
    DEFAULT_MOCK_MONGO_URI,
    mongoTargetFrom,
    mockMongoUriFrom,
    recordsAt,
    contentForAvailability,
    seedMockHotelbedsContent
};