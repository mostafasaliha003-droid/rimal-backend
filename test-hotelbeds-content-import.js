const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { contentImportPlan, contentImportPlanSummary, normalizeRateCommentRecord } = require('./services/hotelbedsContentImportService');
const { createPlanOutput, main } = require('./scripts/plan-hotelbeds-content-import');
const { createHotelbedsContentImportService } = require('./services/hotelbedsContentImportService');

function approvedEnvironment(overrides = {}) {
    return {
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
        HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
        HOTELBEDS_API_KEY: 'fixture-api-key',
        HOTELBEDS_SECRET: 'fixture-secret',
        HOTELBEDS_ACCOUNT_CONFIG: 'fixture-account-secret',
        HOTELBEDS_RATE_MAX_REQUESTS: '8',
        HOTELBEDS_RATE_WINDOW_MS: '4000',
        HOTELBEDS_DAILY_MAX_REQUESTS: '50',
        HOTELBEDS_DAILY_WINDOW_MS: '86400000',
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ contentsync: 8 }),
        HOTELBEDS_PILOT_HOTEL_CODES: '74001,74002',
        HOTELBEDS_PILOT_LANGUAGE: 'ENG',
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb://fixture-user:fixture-password@content.example/rimal_hotelbeds_mock',
        MONGO_URI: 'mongodb://fixture-user:fixture-password@app.example/rimal',
        ...overrides
    };
}

test('plan-only CLI is deterministic, bounded, local and excludes hotel IDs and configuration values', () => {
    const env = approvedEnvironment();
    const summary = createPlanOutput({ hotelCodes: [74001], language: 'eng', pageSize: 100, pageLimit: 1 }, env);
    assert.deepEqual(summary, {
        status: 'plan_only_no_external_requests_or_database_writes',
        source: 'hotelbeds_content_api',
        hotelCount: 1,
        language: 'ENG',
        pageCount: 1,
        pageSize: 100,
        maximumSupplierRequests: 2,
        operation: 'contentsync',
        isolatedDatabase: 'isolated_target_validated_not_connected'
    });
    const serialized = JSON.stringify(summary);
    for (const sensitive of [
        '74001', 'fixture-api-key', 'fixture-secret', 'fixture-account-secret',
        'fixture-password', 'content.example', 'rimal_hotelbeds_mock'
    ]) assert.equal(serialized.includes(sensitive), false);
});

test('plan-only CLI reads injected process environment and never loads dotenv or performs I/O', () => {
    const env = approvedEnvironment();
    const writes = [];
    const errors = [];
    assert.equal(main([
        JSON.stringify({ hotelCodes: [74002], language: 'ENG' })
    ], env, { write: value => writes.push(value) }, { write: value => errors.push(value) }), 0);
    assert.equal(writes.length, 1);
    assert.equal(errors.length, 0);
    assert.equal(JSON.parse(writes[0]).status, 'plan_only_no_external_requests_or_database_writes');

    const denied = [];
    const nonzero = main([JSON.stringify({ hotelCodes: [99999], language: 'ENG' })], env,
        { write() { throw new Error('must_not_write_plan'); } }, { write: value => denied.push(value) });
    assert.equal(nonzero, 1);
    assert.equal(JSON.parse(denied[0]).error, 'hotelbeds_content_import_hotel_not_approved');

    const blocked = [];
    assert.equal(main([JSON.stringify({ hotelCodes: [74001], language: 'ENG' })],
        { ...env, HOTELBEDS_CONTENT_IMPORT_APPROVED: 'false' },
        { write() { throw new Error('must_not_write_plan'); } }, { write: value => blocked.push(value) }), 1);
    assert.equal(JSON.parse(blocked[0]).error, 'hotelbeds_content_plan_gates_unavailable');
});

test('real CLI process accepts PowerShell-safe options and emits a redacted summary', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hotelbeds-content-plan-'));
    try {
        const script = path.resolve(__dirname, 'scripts/plan-hotelbeds-content-import.js');
        const guardPath = path.join(cwd, 'io-guard.cjs');
        fs.writeFileSync(guardPath, `
            const fs = require('node:fs');
            const net = require('node:net');
            const tls = require('node:tls');
            const http = require('node:http');
            const https = require('node:https');
            const http2 = require('node:http2');
            const dns = require('node:dns');
            const dgram = require('node:dgram');
            const mongoose = require('mongoose');
            const { MongoClient } = require('mongodb');
            const blocked = name => () => { process.stderr.write('PLAN_IO_GUARD_BLOCKED:' + name); process.exit(86); };
            const sensitivePath = value => typeof value === 'string'
                && /(?:^|[\\\\/])\\.env(?:\\.[^\\\\/]*)?$|\\.(?:pem|key|crt|cer|p12|pfx)$/i.test(value);
            for (const name of ['readFileSync', 'readFile', 'createReadStream', 'openSync', 'open']) {
                const original = fs[name];
                fs[name] = function(target, ...args) {
                    if (sensitivePath(target)) return blocked('sensitive_file_read')();
                    return original.call(this, target, ...args);
                };
            }
            for (const object of [fs.promises]) {
                for (const name of ['readFile', 'open']) {
                    const original = object[name];
                    object[name] = async function(target, ...args) {
                        if (sensitivePath(target)) return blocked('sensitive_file_read')();
                        return original.call(this, target, ...args);
                    };
                }
            }
            net.Socket.prototype.connect = blocked('socket_connect');
            tls.connect = blocked('tls_connect');
            http.request = blocked('http_request');
            http.get = blocked('http_get');
            https.request = blocked('https_request');
            https.get = blocked('https_get');
            http2.connect = blocked('http2_connect');
            globalThis.fetch = blocked('fetch');
            dns.lookup = blocked('dns_lookup');
            for (const name of ['resolve', 'resolve4', 'resolve6', 'resolveSrv']) dns[name] = blocked('dns_' + name);
            dgram.createSocket = blocked('udp_socket');
            mongoose.connect = blocked('mongoose_connect');
            mongoose.Mongoose.prototype.connect = blocked('mongoose_instance_connect');
            mongoose.Connection.prototype.openUri = blocked('mongoose_open_uri');
            MongoClient.prototype.connect = blocked('mongodb_driver_connect');
        `);
        const guardedEnv = {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            SYSTEMROOT: process.env.SYSTEMROOT,
            NODE_PATH: path.join(__dirname, 'node_modules'),
            NODE_OPTIONS: `--require=${guardPath}`
        };
        for (const [attempt, code] of [
            ['network', "require('node:net').connect(1, '127.0.0.1')"],
            ['udp network', "require('node:dgram').createSocket('udp4')"],
            ['fetch network', "fetch('http://127.0.0.1:1/guard_probe')"],
            ['http2 network', "require('node:http2').connect('http://127.0.0.1:1')"],
            ['mongoose', "require('mongoose').connect('mongodb://127.0.0.1:1/guard_probe')"],
            ['mongodb driver', "new (require('mongodb').MongoClient)('mongodb://127.0.0.1:1/guard_probe').connect()"],
            ['dotenv', "require('node:fs').readFileSync('.env')"],
            ['certificate', "require('node:fs').readFileSync('client.pem')"]
        ]) {
            const probe = spawnSync(process.execPath, ['-e', code], {
                cwd,
                encoding: 'utf8',
                env: guardedEnv
            });
            assert.equal(probe.error, undefined);
            assert.equal(probe.status, 86, `${attempt} guard did not stop its probe`);
            assert.equal(probe.stderr.includes('PLAN_IO_GUARD_BLOCKED'), true, `${attempt} guard did not report a blocked probe`);
        }
        const child = spawnSync(process.execPath, [script, '--hotel-code', '74001', '--language', 'ENG'], {
            cwd,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                SYSTEMROOT: process.env.SYSTEMROOT,
                NODE_OPTIONS: guardedEnv.NODE_OPTIONS,
                HOTELBEDS_ENABLED: 'true',
                HOTELBEDS_ENV: 'test',
                HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
                HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
                HOTELBEDS_API_KEY: 'fixture-api-key',
                HOTELBEDS_SECRET: 'fixture-secret',
                HOTELBEDS_ACCOUNT_CONFIG: 'fixture-account-secret',
                HOTELBEDS_RATE_MAX_REQUESTS: '8',
                HOTELBEDS_RATE_WINDOW_MS: '4000',
                HOTELBEDS_DAILY_MAX_REQUESTS: '50',
                HOTELBEDS_DAILY_WINDOW_MS: '86400000',
                HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ contentsync: 8 }),
                HOTELBEDS_PILOT_HOTEL_CODES: '74001',
                HOTELBEDS_PILOT_LANGUAGE: 'ENG',
                HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
                HOTELBEDS_MOCK_MONGO_URI: 'mongodb://fixture:fixture@content.example/rimal_hotelbeds_mock',
                MONGO_URI: 'mongodb://fixture:fixture@app.example/rimal'
            }
        });
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr);
        assert.equal(child.stderr.includes('PLAN_IO_GUARD_BLOCKED'), false);
        const summary = JSON.parse(child.stdout);
        assert.equal(summary.status, 'plan_only_no_external_requests_or_database_writes');
        assert.equal(summary.hotelCount, 1);
        assert.equal(child.stdout.includes('74001'), false);
        assert.equal(child.stdout.includes('fixture-secret'), false);
        assert.equal(fs.existsSync(path.join(cwd, '.env')), false);
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
});

test('plan validation rejects unapproved hotel codes, live mode, absent gates and a shared Mongo target', () => {
    const request = { hotelCodes: [74001], language: 'ENG' };
    const valid = approvedEnvironment();
    assert.throws(() => contentImportPlan({ hotelCodes: [99999], language: 'ENG' }, valid),
        error => error.code === 'hotelbeds_content_import_hotel_not_approved');
    assert.throws(() => contentImportPlan(request, { ...valid, HOTELBEDS_ENV: 'live' }),
        error => error.code === 'hotelbeds_content_import_test_only');
    assert.throws(() => contentImportPlan(request, { ...valid, HOTELBEDS_MOCK_DATABASE_ENABLED: 'false' }),
        error => error.code === 'hotelbeds_content_import_database_gate_disabled');
    assert.throws(() => contentImportPlan(request, {
        ...valid,
        MONGO_URI: 'mongodb://fixture-user:fixture-password@app.example/rimal_hotelbeds_mock'
    }), error => error.code === 'hotelbeds_mock_database_not_isolated');
    assert.throws(() => contentImportPlan(request, { ...valid, HOTELBEDS_API_KEY: '' }),
        error => error.code === 'hotelbeds_content_import_configuration_invalid');
});

test('plan-only summary makes no supplier calls, database connection or writes', () => {
    const env = approvedEnvironment();
    const plan = contentImportPlan({ hotelCodes: [74001], language: 'ENG' }, env);
    const summary = contentImportPlanSummary(plan);
    assert.equal(summary.maximumSupplierRequests, 2);
    assert.equal(summary.status, 'plan_only_no_external_requests_or_database_writes');
    assert.equal(plan.database.status, 'isolated_target_validated_not_connected');
    assert.equal(Object.hasOwn(plan, 'supplierResponse'), false);
    assert.equal(Object.hasOwn(plan, 'writeResult'), false);
});

test('fixture importer validates, paginates and upserts without supplier or database dependencies', async () => {
    const env = approvedEnvironment({ HOTELBEDS_PILOT_HOTEL_CODES: '74001' });
    const writes = [];
    const connectionChecks = [];
    const pageRequests = [];
    const events = [];
    class FixtureContentModel {
        constructor(document) { Object.assign(this, document); }
        validateSync() { return undefined; }
        static async bulkWrite(operations, options) {
            writes.push({ collection: 'content', operations, options });
            return { upsertedCount: operations.length };
        }
    }
    const service = createHotelbedsContentImportService({
        ContentModel: FixtureContentModel,
        env,
        testOnly: true,
        now: () => new Date('2026-10-04T12:00:00.000Z'),
        ensureModelConnected: async model => { connectionChecks.push(model); events.push(`connect:${model.name}`); }
    });
    const result = await service.importContent({
        hotelCodes: [74001], language: 'ENG', pageSize: 1, pageLimit: 1
    }, {
        fetchPage: async page => {
            pageRequests.push(page);
            events.push('fetch:content');
            return { hotels: [{
                code: 74001,
                language: 'ENG',
                name: 'Fixture Content Hotel',
                category: { code: '4EST', description: '4 STARS' },
                address: 'Fixture Road, Dubai, UAE',
                phone: '+971-4-555-0100',
                description: 'A fixture description.',
                images: [{ path: 'fixture/74001/photo.jpg', visualOrder: 1 }],
                facilities: [{ facilityCode: 1, facilityGroupCode: 2, description: 'Fixture facility' }]
            }] };
        }
    });

    assert.deepEqual(pageRequests, [{ language: 'ENG', from: 1, to: 1, fields: 'all', codes: [74001] }]);
    assert.deepEqual(connectionChecks, [FixtureContentModel]);
    assert.deepEqual(events, [
        'fetch:content', 'connect:FixtureContentModel'
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].options.ordered, true);
    assert.equal(writes[0].operations[0].updateOne.filter.hotelCode, 74001);
    assert.equal(writes[0].operations[0].updateOne.upsert, true);
    assert.equal(writes[0].operations[0].updateOne.update.$set.content.images.length, 1);
    assert.equal(result.supplierRequests, 1);
});

test('legacy optional comments cannot be silently accepted by the content-only importer', async () => {
    const env = approvedEnvironment({
        HOTELBEDS_PILOT_HOTEL_CODES: '74001',
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ contentsync: 2 })
    });
    const writes = [];
    const connectedModels = [];
    class FixtureModel {
        constructor(document) { Object.assign(this, document); }
        validateSync() { return undefined; }
        static async bulkWrite(operations) { writes.push(operations); return {}; }
    }
    class FixtureRateCommentModel extends FixtureModel {}
    const service = createHotelbedsContentImportService({
        ContentModel: FixtureModel,
        RateCommentModel: FixtureRateCommentModel,
        env,
        testOnly: true,
        now: () => new Date('2026-10-04T12:00:00.000Z'),
        ensureModelConnected: async model => { connectedModels.push(model); }
    });

    await assert.rejects(service.importContent({
        hotelCodes: [74001], language: 'ENG', pageSize: 1, pageLimit: 1
    }, {
        fetchPage: async () => ({ hotels: [{
            code: 74001,
            language: 'ENG',
            name: 'Fixture Content Hotel',
            category: { code: '4EST', name: '4 STARS' },
            address: 'Fixture Road, Dubai, UAE',
            phone: '+971-4-555-0100',
            description: 'A fixture description.',
            images: [{ path: 'fixture/74001/photo.jpg', visualOrder: 1 }],
            facilities: [{ facilityCode: 1, facilityGroupCode: 2, description: 'Fixture facility' }]
        }] }),
        fetchRateComments: async () => [{
            hotelCode: 74001,
            language: 'ENG',
            incoming: 'fixture',
            code: 'fixture',
            rateCodes: 'fixture',
            commentsByRates: [{ rateCodes: 'fixture', comments: [{
                dateStart: '2026-02-30', dateEnd: '2026-10-04', description: 'Invalid date fixture'
            }] }]
        }]
    }), error => error.code === 'hotelbeds_content_import_rate_comments_separate_sync_required');

    assert.throws(() => normalizeRateCommentRecord({ incoming: 'fixture', code: 'fixture',
        commentsByRates: [{ rateCodes: 'fixture', comments: [{
            dateStart: '2026-02-30', dateEnd: '2026-10-04', description: 'Invalid date fixture'
        }] }]
    }, { hotelCode: 74001, language: 'ENG', source: 'hotelbeds_content_api', syncedAt: new Date() }),
    error => error.code === 'hotelbeds_rate_comment_import_record_invalid');

    assert.deepEqual(connectedModels, []);
    assert.equal(writes.length, 0);
});

test('invalid comment adapter and insufficient shared operation budget fail before database access', async () => {
    const env = approvedEnvironment({
        HOTELBEDS_PILOT_HOTEL_CODES: '74001',
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ contentsync: 1 })
    });
    let databaseChecks = 0;
    const service = createHotelbedsContentImportService({
        ContentModel: class {},
        RateCommentModel: class {},
        env,
        testOnly: true,
        ensureModelConnected: async () => { databaseChecks += 1; }
    });

    await assert.rejects(service.importContent({
        hotelCodes: [74001], language: 'ENG', pageSize: 1, pageLimit: 1
    }, { fetchPage: async () => ({ hotels: [] }), fetchRateComments: {} }),
    error => error.code === 'hotelbeds_content_import_rate_comments_separate_sync_required');

    await assert.rejects(service.importContent({
        hotelCodes: [74001], language: 'ENG', pageSize: 1, pageLimit: 1
    }, { fetchPage: async () => ({ hotels: [] }) }),
    error => error.code === 'hotelbeds_content_import_operation_budget_exceeded');
    assert.equal(databaseChecks, 0);
});
