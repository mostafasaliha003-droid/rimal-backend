const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createHotelbedsContentSyncService,
    subtractUtcDays
} = require('../services/hotelbedsContentSyncService');
const { contentImportPlan } = require('../services/hotelbedsContentImportService');
const { createHotelbedsContentClient } = require('../services/hotelbedsContentClient');
const HotelbedsContentSyncState = require('../models/HotelbedsContentSyncState');
const HotelbedsContentSyncLease = require('../models/HotelbedsContentSyncLease');

const env = {
    HOTELBEDS_RATE_MAX_REQUESTS: '8',
    HOTELBEDS_RATE_WINDOW_MS: '4000',
    HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
    HOTELBEDS_MOCK_MONGO_URI: 'mongodb://content.example/rimal_content_mock',
    MONGO_URI: 'mongodb://app.example/rimal',
    HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
    HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_API_KEY: 'sync-fixture-api-key',
    HOTELBEDS_SECRET: 'sync-fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'sync-fixture-account',
    HOTELBEDS_PILOT_HOTEL_CODES: '74,1067,295423',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_DAILY_BUDGETS: '{"contentsync":10}',
    HOTELBEDS_DAILY_MAX_REQUESTS: '10'
};

const hotel = {
    code: 74,
    name: { content: 'Sync-state fixture hotel' },
    categoryCode: '4EST',
    category: { code: '4EST', description: '4 STARS' },
    address: { content: '1 Fixture Road' },
    city: { content: 'Dubai' },
    countryCode: 'AE',
    phones: [{ phoneNumber: '+97145550100' }],
    description: { content: 'A valid static hotel fixture.' },
    lastUpdate: '2026-10-03',
    images: [{ path: '00/000074/000074a_hb_ro_001.jpg', type: { code: 'GEN' } }],
    facilities: [{ facilityCode: 330, facilityGroupCode: 70,
        description: { content: 'Garage' }, indFee: true, indYesOrNo: true }],
    issues: []
};

function matchesFilter(document, filter) {
    if (!document) return false;
    for (const [key, expected] of Object.entries(filter || {})) {
        if (key === '$and') {
            if (!expected.every(condition => matchesFilter(document, condition))) return false;
            continue;
        }
        if (key === '$or') {
            if (!expected.some(condition => matchesFilter(document, condition))) return false;
            continue;
        }
        const actual = document[key];
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
            if ('$exists' in expected && (actual !== undefined) !== expected.$exists) return false;
            if ('$lte' in expected && !(actual instanceof Date && actual <= expected.$lte)) return false;
            if ('$gt' in expected && !(actual instanceof Date && actual > expected.$gt)) return false;
        } else if (actual instanceof Date && expected instanceof Date) {
            if (actual.getTime() !== expected.getTime()) return false;
        } else if (actual !== expected) return false;
    }
    return true;
}

function createHarness({ now = new Date('2026-10-06T12:00:00.000Z') } = {}) {
    const store = { content: new Map(), states: new Map(), leases: new Map() };
    let failContentWrite = false;
    let failStateWrite = false;
    let replayTransactionOnce = false;
    const writes = [];

    class ContentModel {
        constructor(record) { Object.assign(this, record); }
        validateSync() { return undefined; }
        static async bulkWrite(operations, options = {}) {
            writes.push({ operations, options });
            if (failContentWrite) throw new Error('fixture_content_write_failed');
            const apply = () => {
                for (const operation of operations) {
                    const update = operation.updateOne;
                    const key = `${update.filter.hotelCode}|${update.filter.language}`;
                    const previous = store.content.get(key) || {};
                    store.content.set(key, { ...previous, ...structuredClone(update.update.$set) });
                }
            };
            if (options.session) options.session.stage(apply);
            else apply();
            return { acknowledged: true, upsertedCount: operations.length };
        }
    }

    class StateModel {
        static findById(id) {
            const query = { lean() { return query; }, exec: async () => store.states.get(id) || null };
            return query;
        }
        static async updateOne(filter, update, options = {}) {
            const current = store.states.get(filter._id);
            if (!current && !options.upsert) return { acknowledged: true, matchedCount: 0 };
            if (options.session && failStateWrite) throw new Error('fixture_checkpoint_write_failed');
            const apply = () => store.states.set(filter._id, {
                ...(store.states.get(filter._id) || {}), ...structuredClone(update.$set), _id: filter._id
            });
            if (options.session) options.session.stage(apply);
            else apply();
            return { acknowledged: true, matchedCount: current ? 1 : 0, upsertedCount: current ? 0 : 1 };
        }
    }

    class LeaseModel {
        static findOneAndUpdate(filter, update, options = {}) {
            const query = {
                exec: async () => {
                    let current = store.leases.get(filter._id);
                    if (!matchesFilter(current, filter)) {
                        if (!current && options.upsert) {
                            current = { _id: filter._id };
                            store.leases.set(filter._id, current);
                        } else {
                            const duplicate = new Error('duplicate key');
                            duplicate.code = 11000;
                            throw duplicate;
                        }
                    }
                    const inserted = current.fencingToken === undefined;
                    Object.assign(current, structuredClone(update.$set || {}));
                    if (inserted) Object.assign(current, structuredClone(update.$setOnInsert || {}));
                    if (update.$inc) {
                        for (const [key, amount] of Object.entries(update.$inc)) {
                            current[key] = (current[key] || 0) + amount;
                        }
                    }
                    return structuredClone(current);
                }
            };
            return query;
        }
        static findById(id) {
            const query = { exec: async () => structuredClone(store.leases.get(id) || null) };
            return query;
        }
        static async updateOne(filter, update, options = {}) {
            const current = store.leases.get(filter._id);
            if (!matchesFilter(current, filter)) return { acknowledged: true, matchedCount: 0 };
            const apply = () => {
                const latest = store.leases.get(filter._id);
                Object.assign(latest, structuredClone(update.$set || {}));
                for (const key of Object.keys(update.$unset || {})) delete latest[key];
            };
            if (options.session) options.session.stage(apply);
            else apply();
            return { acknowledged: true, matchedCount: 1 };
        }
    }

    const database = {
        connection: {
            async startSession() {
                let staged = [];
                return {
                    stage(operation) { staged.push(operation); },
                    async withTransaction(callback) {
                        staged = [];
                        await callback();
                        if (replayTransactionOnce) {
                            replayTransactionOnce = false;
                            staged = [];
                            await callback();
                        }
                        for (const operation of staged) operation();
                        staged = [];
                    },
                    async endSession() {}
                };
            }
        }
    };

    const service = createHotelbedsContentSyncService({
        ContentModel, StateModel, LeaseModel, database, env,
        now: () => new Date(typeof now === 'function' ? now() : now),
        testOnly: true,
        ensureModelsConnected: async () => {}
    });
    const requestOptions = { hotelCodes: [74], language: 'ENG' };
    const adapters = {
        fetchPage: async () => ({ hotels: [hotel] }),
        fetchCategories: async () => ({ categories: [] })
    };

    return {
        service, store, writes, adapters, requestOptions,
        ContentModel, StateModel, LeaseModel, database,
        failNextContentWrite() { failContentWrite = true; },
        allowContentWrites() { failContentWrite = false; },
        failCheckpointWrite() { failStateWrite = true; },
        replayNextTransaction() { replayTransactionOnce = true; },
        setNow(value) { now = () => new Date(value); }
    };
}

test('scope keys bind sorted pilot codes, account fingerprint, language and resource version without secrets', () => {
    const plan = contentImportPlan({ hotelCodes: [1067, 74], language: 'ENG' }, env);
    const { scopeFrom } = require('../services/hotelbedsContentSyncService');
    const scope = scopeFrom(plan, env);
    assert.deepEqual(scope.hotelCodes, [74, 1067]);
    assert.equal(scope.environment, 'test');
    assert.match(scope.accountFingerprint, /^[a-f\d]{64}$/);
    assert.match(scope.scopeKey, /^[a-f\d]{64}$/);
    assert.equal(JSON.stringify(scope).includes(env.HOTELBEDS_API_KEY), false);
    assert.equal(JSON.stringify(scope).includes(env.HOTELBEDS_SECRET), false);
});

test('durable state and writer lease schemas validate without opening MongoDB', () => {
    const validState = new HotelbedsContentSyncState({
        _id: 'a'.repeat(64),
        environment: 'test',
        accountFingerprint: 'b'.repeat(64),
        hotelCodes: [74, 1067],
        language: 'ENG',
        resourceVersion: 'hotels-categories-v1',
        initialized: true,
        lastSuccessfulDate: '2026-10-06',
        lastRunAt: new Date('2026-10-06T12:00:00.000Z')
    });
    assert.equal(validState.validateSync(), undefined);
    const invalidDateState = new HotelbedsContentSyncState({
        _id: 'a'.repeat(64), environment: 'test', accountFingerprint: 'b'.repeat(64),
        hotelCodes: [74], language: 'ENG', resourceVersion: 'hotels-categories-v1',
        initialized: true, lastSuccessfulDate: '2026-02-30'
    });
    assert.ok(invalidDateState.validateSync());

    const validLease = new HotelbedsContentSyncLease({
        _id: 'hotelbeds-content-writer:test',
        leaseId: 'f1234567-1234-4123-8123-123456789abc',
        leaseUntil: new Date('2026-10-06T12:10:00.000Z'),
        scopeKey: 'a'.repeat(64),
        accountFingerprint: 'b'.repeat(64),
        fencingToken: 1
    });
    assert.equal(validLease.validateSync(), undefined);
    const invalidLease = new HotelbedsContentSyncLease({ _id: 'production-writer', fencingToken: -1 });
    assert.ok(invalidLease.validateSync());
});

test('database readiness rejects standalone MongoDB and accepts supported transaction deployments', async () => {
    const harness = createHarness();
    let hello = { isWritablePrimary: true, maxWireVersion: 21 };
    let readyCalls = 0;
    for (const Model of [harness.ContentModel, harness.StateModel, harness.LeaseModel]) {
        Model.init = async () => {};
    }
    const database = {
        ...harness.database,
        ensureModelConnected: async () => { readyCalls += 1; },
        connection: {
            ...harness.database.connection,
            db: { admin: () => ({ command: async () => hello }) }
        }
    };
    const service = createHotelbedsContentSyncService({
        ContentModel: harness.ContentModel,
        StateModel: harness.StateModel,
        LeaseModel: harness.LeaseModel,
        database,
        env,
        testOnly: false
    });

    await assert.rejects(service.ensureReady(),
        error => error.code === 'hotelbeds_content_transactions_unavailable');
    assert.equal(readyCalls, 3);

    hello = { setName: 'fixture-rs', isWritablePrimary: true, maxWireVersion: 21 };
    await service.ensureReady();
    assert.equal(readyCalls, 6);
});

test('persistent sync coordinator rejects partial pages and production mode before DB access', async () => {
    const harness = createHarness();
    const productionService = createHotelbedsContentSyncService({
        ContentModel: harness.ContentModel,
        StateModel: harness.StateModel,
        LeaseModel: harness.LeaseModel,
        database: harness.database,
        env: { ...env, NODE_ENV: 'production' },
        testOnly: true,
        ensureModelsConnected: async () => assert.fail('production must fail before DB access')
    });

    await assert.rejects(harness.service.syncContent({ ...harness.requestOptions, from: 2 }, harness.adapters),
        error => error.code === 'hotelbeds_content_sync_partial_bootstrap_forbidden');
    await assert.rejects(productionService.syncContent(harness.requestOptions, harness.adapters),
        error => error.code === 'hotelbeds_content_sync_production_forbidden');
    assert.equal(harness.store.leases.size, 0);
});

test('database-wide lease rejects a competing account fingerprint', async () => {
    const harness = createHarness();
    const firstScope = require('../services/hotelbedsContentSyncService')
        .scopeFrom(contentImportPlan(harness.requestOptions, env), env);
    const lease = [...harness.store.leases.values()];
    assert.deepEqual(lease, []);

    let enteredFetch;
    let resumeFetch;
    const entered = new Promise(resolve => { enteredFetch = resolve; });
    const delayed = {
        ...harness.adapters,
        fetchPage: async () => {
            enteredFetch();
            await new Promise(resolve => { resumeFetch = resolve; });
            return { hotels: [hotel] };
        }
    };
    const active = harness.service.syncContent(harness.requestOptions, delayed);
    await entered;
    const otherAccountEnv = { ...env, HOTELBEDS_API_KEY: 'different-fixture-key' };
    const otherAccount = createHotelbedsContentSyncService({
        ContentModel: harness.ContentModel,
        StateModel: harness.StateModel,
        LeaseModel: harness.LeaseModel,
        database: harness.database,
        env: otherAccountEnv,
        testOnly: true,
        ensureModelsConnected: async () => {}
    });
    const secondScope = require('../services/hotelbedsContentSyncService')
        .scopeFrom(contentImportPlan(harness.requestOptions, otherAccountEnv), otherAccountEnv);
    assert.notEqual(firstScope.accountFingerprint, secondScope.accountFingerprint);
    await assert.rejects(otherAccount.syncContent(harness.requestOptions, harness.adapters),
        error => error.code === 'hotelbeds_content_sync_database_account_mismatch');
    resumeFetch();
    await active;
});

test('sync bootstraps once, then uses the persisted overlapping differential date', async () => {
    const harness = createHarness();
    const pageCalls = [];
    const adapters = { ...harness.adapters, fetchPage: async options => {
        pageCalls.push(options);
        return { hotels: [hotel] };
    } };

    const bootstrap = await harness.service.syncContent(harness.requestOptions, adapters);
    assert.equal(bootstrap.bootstrap, true);
    assert.equal(bootstrap.lastUpdateTime, null);
    assert.equal(pageCalls[0].lastUpdateTime, undefined);
    assert.equal(harness.store.content.size, 1);
    assert.equal(harness.store.states.size, 1);
    assert.equal([...harness.store.states.values()][0].initialized, true);

    const delta = await harness.service.syncContent(harness.requestOptions, {
        ...adapters,
        fetchPage: async options => { pageCalls.push(options); return { hotels: [] }; }
    });
    assert.equal(delta.bootstrap, false);
    assert.equal(delta.lastUpdateTime, '2026-10-05');
    assert.equal(pageCalls[1].lastUpdateTime, '2026-10-05');
    assert.equal(harness.store.content.size, 1);
    assert.equal(harness.writes.length, 1);
});

test('real Content API client, importer and cursor coordinator run together with fake HTTP and DB adapters', async () => {
    const harness = createHarness();
    const requestConfigs = [];
    const client = createHotelbedsContentClient({
        http: { request: async config => {
            requestConfigs.push(config);
            if (config.url.endsWith('/hotel-content-api/1.0/hotels')) {
                return { status: 200, data: { hotels: [{ ...hotel, category: undefined }] } };
            }
            if (config.url.endsWith('/hotel-content-api/1.0/types/categories')) {
                return { status: 200, data: { categories: [{ code: '4EST', description: { content: '4 STARS' } }] } };
            }
            assert.fail(`Unexpected fake Content API endpoint: ${config.url}`);
        } },
        requestLimiter: { acquire: async () => {} },
        env,
        now: () => Date.parse('2026-10-06T12:00:00.000Z'),
        log: { logEtgExchange() {} }
    });
    const coordinatedService = createHotelbedsContentSyncService({
        ContentModel: harness.ContentModel,
        StateModel: harness.StateModel,
        LeaseModel: harness.LeaseModel,
        database: harness.database,
        env,
        now: () => new Date('2026-10-06T12:00:00.000Z'),
        testOnly: true,
        ensureModelsConnected: async () => {}
    });

    const result = await coordinatedService.syncContent(harness.requestOptions, {
        fetchPage: async options => {
            const response = await client.getHotelsPage(options);
            assert.equal(response.ok, true);
            return response.data;
        },
        fetchCategories: async options => {
            const response = await client.getCategoriesPage(options);
            assert.equal(response.ok, true);
            return response.data;
        }
    });

    assert.equal(result.bootstrap, true);
    assert.equal(requestConfigs.length, 2);
    assert.equal(requestConfigs[0].params.codes, '74');
    assert.equal(requestConfigs[1].params.codes, '4EST');
    assert.deepEqual(harness.store.content.get('74|ENG').content.category, { code: '4EST', name: '4 STARS' });
    assert.equal(harness.store.states.size, 1);
});

test('failed content write rolls back cursor and releases the lease so bootstrap can retry', async () => {
    const harness = createHarness();
    harness.failNextContentWrite();

    await assert.rejects(harness.service.syncContent(harness.requestOptions, harness.adapters),
        /fixture_content_write_failed/);
    assert.equal(harness.store.states.size, 0);
    assert.equal(harness.store.content.size, 0);
    assert.equal(harness.store.leases.values().next().value.leaseId, undefined);

    harness.allowContentWrites();
    const retry = await harness.service.syncContent(harness.requestOptions, harness.adapters);
    assert.equal(retry.bootstrap, true);
    assert.equal(harness.store.states.size, 1);
});

test('checkpoint failure after staged content write commits neither content nor cursor', async () => {
    const harness = createHarness();
    harness.failCheckpointWrite();

    await assert.rejects(harness.service.syncContent(harness.requestOptions, harness.adapters),
        /fixture_checkpoint_write_failed/);
    assert.equal(harness.store.states.size, 0);
    assert.equal(harness.store.content.size, 0);
    assert.equal(harness.store.leases.values().next().value.leaseId, undefined);
});

test('transaction callback retry replays DB writes but never repeats supplier requests', async () => {
    const harness = createHarness();
    harness.replayNextTransaction();
    let hotelRequests = 0;
    let categoryRequests = 0;
    const result = await harness.service.syncContent(harness.requestOptions, {
        fetchPage: async () => {
            hotelRequests += 1;
            return { hotels: [{ ...hotel, category: undefined }] };
        },
        fetchCategories: async () => {
            categoryRequests += 1;
            return { categories: [{ code: '4EST', description: '4 STARS' }] };
        }
    });

    assert.equal(result.importedCount, 1);
    assert.equal(hotelRequests, 1);
    assert.equal(categoryRequests, 1);
    assert.equal(harness.writes.length, 2);
    assert.equal(harness.store.content.size, 1);
    assert.equal(harness.store.states.size, 1);
});

test('active writer lease rejects overlapping apply runs', async () => {
    const harness = createHarness();
    let enteredFetch;
    let resumeFetch;
    const entered = new Promise(resolve => { enteredFetch = resolve; });
    const blockedAdapters = {
        ...harness.adapters,
        fetchPage: async () => {
            enteredFetch();
            await new Promise(resolve => { resumeFetch = resolve; });
            return { hotels: [hotel] };
        }
    };
    const firstRun = harness.service.syncContent(harness.requestOptions, blockedAdapters);
    await entered;
    await assert.rejects(harness.service.syncContent(harness.requestOptions, harness.adapters),
        error => error.code === 'hotelbeds_content_sync_already_running');
    resumeFetch();
    await firstRun;
});

test('expired writer cannot commit after a newer fencing token owns the scope', async () => {
    const harness = createHarness();
    let enteredFetch;
    let resumeFetch;
    const entered = new Promise(resolve => { enteredFetch = resolve; });
    const delayedAdapters = {
        ...harness.adapters,
        fetchPage: async () => {
            enteredFetch();
            await new Promise(resolve => { resumeFetch = resolve; });
            return { hotels: [hotel] };
        }
    };
    const staleRun = harness.service.syncContent(harness.requestOptions, delayedAdapters);
    await entered;
    harness.setNow('2026-10-07T12:00:00.000Z');
    const currentRun = await harness.service.syncContent(harness.requestOptions, harness.adapters);
    assert.equal(currentRun.bootstrap, true);

    resumeFetch();
    await assert.rejects(staleRun, error => error.code === 'hotelbeds_content_sync_lease_lost');
    assert.equal(harness.store.states.size, 1);
    assert.equal(harness.store.content.size, 1);
    assert.equal(harness.store.leases.values().next().value.leaseId, undefined);
});

test('date overlap arithmetic is UTC-safe across month and year boundaries', () => {
    assert.equal(subtractUtcDays('2026-03-01', 1), '2026-02-28');
    assert.equal(subtractUtcDays('2026-01-01', 1), '2025-12-31');
});