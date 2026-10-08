const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, run } = require('../scripts/sync-hotelbeds-content');
const { createHotelbedsContentClient } = require('../services/hotelbedsContentClient');
const { createHotelbedsContentSyncService } = require('../services/hotelbedsContentSyncService');
const VerifiedHotelContent = require('../models/HotelbedsVerifiedHotelContent');

const gatedEnv = {
    HOTELBEDS_RATE_MAX_REQUESTS: '8',
    HOTELBEDS_RATE_WINDOW_MS: '4000',
    HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
    HOTELBEDS_MOCK_MONGO_URI: 'mongodb://content.example/rimal_content_mock',
    MONGO_URI: 'mongodb://app.example/rimal',
    HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
    HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_API_KEY: 'sync-cli-fixture-key',
    HOTELBEDS_SECRET: 'sync-cli-fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'sync-cli-fixture-account',
    HOTELBEDS_PILOT_HOTEL_CODES: '74,1067,295423',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_DAILY_BUDGETS: '{"contentsync":10}'
};

function collector() {
    const values = [];
    return { values, output: value => values.push(value) };
}

test('content sync fails closed when approval gates are missing', async () => {
    const { values, output } = collector();
    const code = await run(['--hotels=74'], { env: {}, output });

    assert.equal(code, 1);
    assert.deepEqual(values, [{
        ok: false, error: 'hotelbeds_content_import_not_approved', httpStatus: 503
    }]);
});

test('content sync plan mode validates the plan without any supplier or database access', async () => {
    const { values, output } = collector();
    const code = await run(['--hotels=74,1067'], {
        env: gatedEnv,
        output,
        createService: () => assert.fail('plan mode must not build the import service'),
        createClient: () => assert.fail('plan mode must not build the content client')
    });

    assert.equal(code, 0);
    assert.equal(values.length, 1);
    assert.equal(values[0].ok, true);
    assert.equal(values[0].mode, 'plan');
    assert.deepEqual(values[0].plan.hotelCodes, [74, 1067]);
    assert.equal(values[0].plan.language, 'ENG');
    assert.equal(values[0].plan.source, 'hotelbeds_content_api');
});

test('content sync closes resources after an apply failure', async () => {
    const { values, output } = collector();
    let closed = 0;
    const code = await run(['--hotels=74', '--apply'], {
        env: gatedEnv,
        output,
        closeResources: async () => { closed += 1; },
        createClient: () => ({ async getHotelsPage() { return { ok: false, data: null }; } }),
        createService: () => ({
            async syncContent(_options, { fetchPage }) {
                await fetchPage({ language: 'ENG', from: 1, to: 10, fields: 'all' });
            }
        })
    });

    assert.equal(code, 1);
    assert.equal(closed, 1);
    assert.equal(values[0].error, 'hotelbeds_content_fetch_failed');
});

test('content sync rejects unapproved hotels and missing hotel selection', async () => {
    const blocked = collector();
    const blockedCode = await run(['--hotels=999999'], { env: gatedEnv, output: blocked.output });
    assert.equal(blockedCode, 1);
    assert.equal(blocked.values[0].error, 'hotelbeds_content_import_hotel_not_approved');

    const missing = collector();
    const missingCode = await run(['--apply'], { env: gatedEnv, output: missing.output });
    assert.equal(missingCode, 1);
    assert.equal(missing.values[0].error, 'hotelbeds_content_sync_hotels_required');
});

test('content sync apply requires the cursor coordinator and passes through the fetch adapters', async () => {
    const captured = {};
    const pageOptions = [];
    const fixturePage = { hotels: [{ code: 74 }] };
    const { values, output } = collector();
    const code = await run(['--hotels=74', '--apply'], {
        env: gatedEnv,
        output,
        createClient: () => ({
            async getHotelsPage(options) {
                pageOptions.push(options);
                return { ok: true, httpStatus: 200, data: fixturePage };
            }
        }),
        createService: () => ({
            async syncContent(options, { fetchPage }) {
                captured.options = options;
                captured.planValidated = true;
                const page = await fetchPage({ language: 'ENG', from: 1, to: 1000, fields: 'all' });
                assert.deepEqual(page, fixturePage);
                return {
                    importedCount: 1, pageCount: 1, supplierRequests: 1,
                    categoryRequestCount: 0, source: 'hotelbeds_content_api',
                    bootstrap: true, lastUpdateTime: null
                };
            }
        })
    });

    assert.equal(code, 0);
    assert.deepEqual(captured.options.hotelCodes, [74]);
    assert.equal(captured.options.language, 'ENG');
    assert.equal(pageOptions.length, 1);
    assert.deepEqual(values, [{
        ok: true, mode: 'apply',
        result: { importedCount: 1, pageCount: 1, categoryRequestCount: 0,
            supplierRequests: 1, source: 'hotelbeds_content_api', bootstrap: true, lastUpdateTime: null }
    }]);
});

test('content sync apply rejects importer-only adapters and closes its resources', async () => {
    const { values, output } = collector();
    let closed = 0;
    const code = await run(['--hotels=74', '--apply'], {
        env: gatedEnv,
        output,
        closeResources: async () => { closed += 1; },
        createService: () => ({ importContent: async () => ({ importedCount: 1 }) }),
        createClient: () => ({})
    });
    assert.equal(code, 1);
    assert.equal(closed, 1);
    assert.equal(values[0].error, 'hotelbeds_content_sync_service_unavailable');
});

test('content sync plan and apply reject partial bootstrap pagination', async () => {
    const plan = collector();
    const planCode = await run(['--hotels=74', '--from=2'], { env: gatedEnv, output: plan.output });
    assert.equal(planCode, 1);
    assert.equal(plan.values[0].error, 'hotelbeds_content_sync_partial_bootstrap_forbidden');

    const applied = collector();
    const applyCode = await run(['--hotels=74', '--from=2', '--apply'], {
        env: gatedEnv, output: applied.output,
        createService: () => assert.fail('invalid page must fail before constructing sync service'),
        createClient: () => assert.fail('invalid page must fail before constructing Content API client')
    });
    assert.equal(applyCode, 1);
    assert.equal(applied.values[0].error, 'hotelbeds_content_sync_partial_bootstrap_forbidden');
});

test('content sync apply is explicitly forbidden in production and closes resources', async () => {
    const { values, output } = collector();
    let closed = 0;
    const code = await run(['--hotels=74', '--apply'], {
        env: { ...gatedEnv, NODE_ENV: 'production' },
        output,
        closeResources: async () => { closed += 1; },
        createService: () => assert.fail('production must fail before constructing the sync service'),
        createClient: () => assert.fail('production must fail before constructing the client')
    });
    assert.equal(code, 1);
    assert.equal(closed, 1);
    assert.equal(values[0].error, 'hotelbeds_content_sync_production_forbidden');
});

test('Content API sync runs the real client and importer against fake HTTP and DB adapters', async () => {
    const env = {
        ...gatedEnv,
        HOTELBEDS_API_KEY: 'content-fixture-key',
        HOTELBEDS_SECRET: 'content-fixture-secret',
        HOTELBEDS_ACCOUNT_CONFIG: 'content-fixture-account',
        HOTELBEDS_DAILY_BUDGETS: '{"contentsync":3}',
        HOTELBEDS_DAILY_MAX_REQUESTS: '10',
        HOTELBEDS_RATE_MAX_REQUESTS: '4',
        HOTELBEDS_RATE_WINDOW_MS: '1000'
    };
    const requestConfigs = [];
    const writes = [];
    const ensured = [];
    const checkpoints = [];
    const leases = new Map();
    let closed = 0;
    const hotel = {
        code: 74,
        name: { content: 'Contract-shaped hotel' },
        categoryCode: '4EST',
        address: { content: '1 Fake Road' },
        city: { content: 'Dubai' },
        countryCode: 'AE',
        phones: [{ phoneNumber: '+97145550100' }],
        description: { content: 'Fixture hotel description.' },
        lastUpdate: '2026-10-03',
        images: [{ path: '00/000074/000074a_hb_ro_001.jpg', type: { code: 'GEN' } }],
        facilities: [{ facilityCode: 330, facilityGroupCode: 70,
            description: { content: 'Garage' }, indFee: true, indYesOrNo: true }],
        issues: []
    };
    const client = createHotelbedsContentClient({
        http: { request: async config => {
            requestConfigs.push(config);
            if (config.url.endsWith('/hotel-content-api/1.0/hotels')) {
                return { status: 200, data: { hotels: [hotel] } };
            }
            if (config.url.endsWith('/hotel-content-api/1.0/types/categories')) {
                return { status: 200, data: { categories: [{ code: '4EST', description: { content: '4 STARS' } }] } };
            }
            assert.fail(`Unexpected fake HTTP endpoint: ${config.url}`);
        } },
        requestLimiter: { acquire: async () => {} },
        env,
        now: () => Date.parse('2026-10-06T12:00:00.000Z'),
        log: { logEtgExchange() {} }
    });
    class SchemaValidatedFakeWriteModel {
        constructor(record) {
            return new VerifiedHotelContent(record);
        }

        static async bulkWrite(operations, options) {
            writes.push({ operations, options });
            return { upsertedCount: operations.length };
        }
    }
    class FakeStateModel {
        static findById(id) {
            const query = { lean() { return query; }, exec: async () => checkpoints.find(item => item._id === id) || null };
            return query;
        }
        static async init() {}
        static async updateOne(filter, update) {
            checkpoints.push({ _id: filter._id, ...update.$set });
            return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
        }
    }
    class FakeLeaseModel {
        static async init() {}
        static findOneAndUpdate(_filter, update) {
            return { exec: async () => {
                const lease = {
                    ...update.$setOnInsert,
                    ...update.$set,
                    fencingToken: (leases.get('writer')?.fencingToken || 0) + 1
                };
                leases.set('writer', lease);
                return structuredClone(lease);
            } };
        }
        static findById() {
            return { exec: async () => structuredClone(leases.get('writer') || null) };
        }
        static async updateOne(filter, update, options = {}) {
            const lease = leases.get('writer');
            if (!lease || lease.leaseId !== filter.leaseId || lease.fencingToken !== filter.fencingToken) {
                return { acknowledged: true, matchedCount: 0 };
            }
            if (options.session) return { acknowledged: true, matchedCount: 1 };
            for (const key of Object.keys(update.$unset || {})) delete lease[key];
            return { acknowledged: true, matchedCount: 1 };
        }
    }
    const database = {
        connection: {
            async startSession() {
                return {
                    async withTransaction(callback) { await callback(); },
                    async endSession() {}
                };
            }
        }
    };
    const service = createHotelbedsContentSyncService({
        ContentModel: SchemaValidatedFakeWriteModel,
        StateModel: FakeStateModel,
        LeaseModel: FakeLeaseModel,
        database,
        env,
        now: () => new Date('2026-10-06T12:00:00.000Z'),
        testOnly: true,
        ensureModelsConnected: async models => { ensured.push(...models); }
    });
    const { values, output } = collector();

    const code = await run(['--hotels=74', '--apply'], {
        env,
        output,
        createService: () => service,
        createClient: () => client,
        closeResources: async () => { closed += 1; }
    });

    assert.equal(code, 0);
    assert.equal(closed, 1);
    assert.deepEqual(requestConfigs.map(config => config.url), [
        'https://api.test.hotelbeds.com/hotel-content-api/1.0/hotels',
        'https://api.test.hotelbeds.com/hotel-content-api/1.0/types/categories'
    ]);
    assert.equal(requestConfigs[0].params.codes, '74');
    assert.equal(requestConfigs[1].params.codes, '4EST');
    assert.deepEqual(ensured, [SchemaValidatedFakeWriteModel, FakeStateModel, FakeLeaseModel,
        SchemaValidatedFakeWriteModel]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].options.ordered, true);
    const imported = writes[0].operations[0].updateOne.update.$set.content;
    assert.equal(imported.name, 'Contract-shaped hotel');
    assert.deepEqual(imported.category, { code: '4EST', name: '4 STARS' });
    assert.equal(imported.facilities[0].indFee, true);
    assert.deepEqual(values[0], {
        ok: true,
        mode: 'apply',
        result: {
            importedCount: 1,
            pageCount: 1,
            categoryRequestCount: 1,
            supplierRequests: 2,
            source: 'hotelbeds_content_api',
            bootstrap: true,
            lastUpdateTime: null
        }
    });
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0].initialized, true);
    assert.equal(checkpoints[0].lastSuccessfulDate, '2026-10-06');
    assert.equal(leases.get('writer').leaseId, undefined);
});

test('content sync apply mode surfaces supplier fetch failures without importing', async () => {
    const { values, output } = collector();
    const code = await run(['--hotels=74', '--apply'], {
        env: gatedEnv,
        output,
        createClient: () => ({ async getHotelsPage() { return { ok: false, httpStatus: 503, data: null }; } }),
        createService: () => ({
            async syncContent(_options, { fetchPage }) {
                await assert.rejects(() => fetchPage({ language: 'ENG', from: 1, to: 1000, fields: 'all' }),
                    error => error.code === 'hotelbeds_content_fetch_failed');
                const error = new Error('hotelbeds_content_fetch_failed');
                error.code = 'hotelbeds_content_fetch_failed';
                error.httpStatus = 502;
                throw error;
            }
        })
    });

    assert.equal(code, 1);
    assert.deepEqual(values, [{
        ok: false, error: 'hotelbeds_content_fetch_failed', httpStatus: 502
    }]);
});

test('content sync argument parser validates required and numeric flags', () => {
    assert.deepEqual(parseArgs(['--hotels=74,1067', '--page-limit=2']), {
        apply: false, help: false, hotels: [74, 1067], from: null, pageSize: null,
        pageLimit: 2, lastUpdateTime: null
    });
    assert.deepEqual(parseArgs(['--hotels=74', '--apply']).apply, true);
    assert.throws(() => parseArgs([]), error => error.code === 'hotelbeds_content_sync_hotels_required');
    assert.throws(() => parseArgs(['--hotels=abc']), error => error.code === 'hotelbeds_content_sync_argument_invalid');
    assert.throws(() => parseArgs(['--hotels=74', '--bogus=1']), error => error.code === 'hotelbeds_content_sync_argument_invalid');
    assert.deepEqual(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['--hotels=74', '--last-update-time=2026-10-01']).lastUpdateTime, '2026-10-01');
});
