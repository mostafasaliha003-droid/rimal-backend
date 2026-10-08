const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const mongoose = require('mongoose');
const hotelbedsMockDatabaseModule = require('../services/hotelbedsMockDatabase');
const contentSchema = require('../models/HotelbedsVerifiedHotelContent').schema;
const stateSchema = require('../models/HotelbedsContentSyncState').schema;
const leaseSchema = require('../models/HotelbedsContentSyncLease').schema;
const { createHotelbedsContentClient } = require('../services/hotelbedsContentClient');
const { createHotelbedsContentSyncService } = require('../services/hotelbedsContentSyncService');

const MONGO_URI_ENV = 'HOTELBEDS_CONTENT_SYNC_MONGO_INTEGRATION_URI';
const rawMongoUri = process.env[MONGO_URI_ENV];
const TIMEOUT_MS = 10000;
const OWNERSHIP_COLLECTION_PREFIX = 'hotelbeds_sync_test_owner_';
const OWNERSHIP_PURPOSE = 'hotelbeds-content-sync-integration-test';

const integrationEnv = {
    HOTELBEDS_MOCK_MONGO_URI: 'mongodb://content.example/rimal_content_mock',
    MONGO_URI: 'mongodb://app.example/rimal',
    HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
    HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_API_KEY: 'local-mongo-integration-fixture-key',
    HOTELBEDS_SECRET: 'local-mongo-integration-fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'local-mongo-integration-fixture-account',
    HOTELBEDS_PILOT_HOTEL_CODES: '74',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_DAILY_BUDGETS: '{"contentsync":10}',
    HOTELBEDS_DAILY_MAX_REQUESTS: '10',
    HOTELBEDS_RATE_MAX_REQUESTS: '10',
    HOTELBEDS_RATE_WINDOW_MS: '1000',
    HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
    NODE_ENV: 'test'
};

const hotelFixture = {
    code: 74,
    name: { content: 'Local Mongo transaction fixture' },
    categoryCode: '4EST',
    address: { content: '1 Local Test Road' },
    city: { content: 'Dubai' },
    countryCode: 'AE',
    phones: [{ phoneNumber: '+97145550100' }],
    description: { content: 'Fixture hotel for local transaction integration tests.' },
    lastUpdate: '2026-10-03',
    images: [{ path: '00/000074/000074a_hb_ro_001.jpg', type: { code: 'GEN' } }],
    facilities: [{ facilityCode: 330, facilityGroupCode: 70,
        description: { content: 'Garage' }, indFee: true, indYesOrNo: true }],
    issues: []
};

function ownershipCollectionForRun(runId) {
    const normalizedRunId = String(runId).replace(/-/g, '').toLowerCase();
    if (!/^[a-f\d]{32}$/.test(normalizedRunId)) throw new Error('integration_run_id_invalid');
    return `${OWNERSHIP_COLLECTION_PREFIX}${normalizedRunId}`;
}

function localMongoUriForDatabase(rawUri, databaseName) {
    let parsed;
    try { parsed = new URL(rawUri); } catch { throw new Error('integration_mongo_uri_invalid'); }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (parsed.protocol !== 'mongodb:' || net.isIP(hostname) === 0
        || !['127.0.0.1', '::1'].includes(hostname)
        || parsed.username || parsed.password
        || parsed.searchParams.get('directConnection') !== 'true'
        || [...parsed.searchParams.keys()].length !== 1 || parsed.hash
        || !/^hotelbeds_sync_mock_[a-f\d]{32}$/.test(databaseName)) {
        throw new Error('integration_mongo_uri_must_be_local_direct_connection');
    }
    parsed.pathname = `/${databaseName}`;
    return parsed.toString();
}

function assertTestDatabaseUriIsLocalAndDirect(uri) {
    const parsed = new URL(uri);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    assert.equal(parsed.protocol, 'mongodb:');
    assert.ok(['127.0.0.1', '::1'].includes(hostname));
    assert.equal(parsed.username, '');
    assert.equal(parsed.password, '');
    assert.equal(parsed.searchParams.get('directConnection'), 'true');
    assert.match(parsed.pathname, /^\/hotelbeds_sync_mock_[a-f\d]{32}$/);
}

function withTimeout(promise, description, timeoutMs = TIMEOUT_MS) {
    let timer;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${description}_timeout`)), timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

function createOperationTracker() {
    const pending = new Set();
    return {
        run(label, operation) {
            let settled = false;
            const entry = { label, promise: null, isSettled: () => settled };
            entry.promise = Promise.resolve().then(operation).finally(() => {
                settled = true;
                pending.delete(entry);
            });
            // Mark rejections handled while allowing callers to await the original promise.
            entry.promise.catch(() => {});
            pending.add(entry);
            return entry;
        },
        async settle(timeoutMs = TIMEOUT_MS) {
            const snapshot = [...pending];
            if (!snapshot.length) return { settled: true, pending: [] };
            try {
                await withTimeout(Promise.allSettled(snapshot.map(entry => entry.promise)),
                    'integration_pending_operations', timeoutMs);
            } catch {
                return {
                    settled: false,
                    pending: snapshot.filter(entry => !entry.isSettled()).map(entry => entry.label)
                };
            }
            return { settled: pending.size === 0, pending: [...pending].map(entry => entry.label) };
        },
        isSettled() { return pending.size === 0; },
        pendingLabels() { return [...pending].map(entry => entry.label); }
    };
}

async function runTrackedOperation(tracker, label, operation, timeoutMs = TIMEOUT_MS) {
    const entry = tracker.run(label, operation);
    return withTimeout(entry.promise, label, timeoutMs);
}

function schemasForIntegration() {
    const schemas = {
        content: contentSchema.clone(),
        state: stateSchema.clone(),
        lease: leaseSchema.clone()
    };
    for (const schema of Object.values(schemas)) {
        schema.set('autoCreate', false);
        schema.set('autoIndex', false);
    }
    return schemas;
}

test('integration Mongoose options are applied only to cloned test schemas', () => {
    const originalOptions = [contentSchema, stateSchema, leaseSchema].map(schema => ({
        autoCreate: schema.get('autoCreate'),
        autoIndex: schema.get('autoIndex')
    }));
    const clones = schemasForIntegration();

    for (const schema of Object.values(clones)) {
        assert.equal(schema.get('autoCreate'), false);
        assert.equal(schema.get('autoIndex'), false);
    }
    assert.deepEqual([contentSchema, stateSchema, leaseSchema].map(schema => ({
        autoCreate: schema.get('autoCreate'),
        autoIndex: schema.get('autoIndex')
    })), originalOptions);
});

async function createOwnedModels({ connection, schemas, ownershipCollection, ownershipRecord,
    onDatabaseCreationAttempt }) {
    // The caller first verifies the randomized database name is absent. This
    // marker insert is the first operation that can create the DB. Mark that
    // cleanup may be required before issuing it, because network failure may
    // leave the write outcome uncertain; cleanup still requires the marker.
    onDatabaseCreationAttempt();
    await connection.db.collection(ownershipCollection).insertOne(ownershipRecord, {
        writeConcern: { w: 'majority' }
    });

    const modelCollections = [
        ['content', 'hotelbedsverifiedcontent'],
        ['state', 'hotelbedscontentsyncstate'],
        ['lease', 'hotelbedscontentsyncleases']
    ];
    for (const [, collectionName] of modelCollections) {
        await connection.db.createCollection(collectionName);
    }

    const models = {
        ContentModel: connection.model('HotelbedsSyncIntegrationContent', schemas.content,
            'hotelbedsverifiedcontent'),
        StateModel: connection.model('HotelbedsSyncIntegrationState', schemas.state,
            'hotelbedscontentsyncstate'),
        LeaseModel: connection.model('HotelbedsSyncIntegrationLease', schemas.lease,
            'hotelbedscontentsyncleases')
    };
    for (const Model of Object.values(models)) await Model.createIndexes();
    return models;
}

async function initializeOwnedDatabase({ databaseName, runId, tracker, listDatabaseNames,
    createOwnershipMarkerAndModels, onDatabaseCreationAttempt }) {
    const names = await runTrackedOperation(tracker, 'integration_list_database_names', listDatabaseNames);
    const ownershipRecord = assertFreshDatabaseOwnership({
        existingDatabaseNames: names,
        expectedDatabaseName: databaseName,
        runId
    });
    const setup = tracker.run('integration_create_owned_models', () =>
        createOwnershipMarkerAndModels(ownershipRecord, onDatabaseCreationAttempt));
    return { ownershipRecord, setup };
}

function assertFreshDatabaseOwnership({ existingDatabaseNames, expectedDatabaseName, runId }) {
    if (existingDatabaseNames.includes(expectedDatabaseName)) {
        throw new Error('integration_database_preexisting');
    }
    return {
        _id: runId,
        databaseName: expectedDatabaseName,
        ownershipCollection: ownershipCollectionForRun(runId),
        purpose: OWNERSHIP_PURPOSE,
        createdAt: new Date()
    };
}

function assertDatabaseOwnership({ actualDatabaseName, expectedDatabaseName,
    ownershipCollection, ownershipRecord, runId }) {
    if (actualDatabaseName !== expectedDatabaseName
        || ownershipCollection !== ownershipCollectionForRun(runId)
        || ownershipRecord?._id !== runId
        || ownershipRecord?.databaseName !== expectedDatabaseName
        || ownershipRecord?.ownershipCollection !== ownershipCollection
        || ownershipRecord?.purpose !== OWNERSHIP_PURPOSE) {
        throw new Error('integration_cleanup_database_ownership_mismatch');
    }
}

function combineErrors(primaryError, cleanupError) {
    if (primaryError && cleanupError) {
        return new AggregateError([primaryError, cleanupError],
            'Mongo integration failed and cleanup also failed', { cause: primaryError });
    }
    return primaryError || cleanupError || null;
}

async function releaseAndSettleActiveRun({ release, activeRun, primaryError }) {
    release?.();
    if (!activeRun) return { error: primaryError, settled: true };
    let settled = false;
    const observedRun = Promise.resolve(activeRun).then(value => {
        settled = true;
        return value;
    }, error => {
        settled = true;
        throw error;
    });
    try {
        await withTimeout(observedRun, 'integration_active_sync_cleanup');
        return { error: primaryError, settled };
    } catch (cleanupError) {
        return { error: combineErrors(primaryError, cleanupError), settled };
    }
}

function createFakeContentClient({ requests, noChanges }) {
    return createHotelbedsContentClient({
        http: { request: async config => {
            requests.push(config);
            if (config.url.endsWith('/hotel-content-api/1.0/hotels')) {
                return { status: 200, data: { hotels: noChanges() ? [] : [hotelFixture] } };
            }
            if (config.url.endsWith('/hotel-content-api/1.0/types/categories')) {
                return { status: 200, data: { categories: [
                    { code: '4EST', description: { content: '4 STARS' } }
                ] } };
            }
            assert.fail(`Unexpected fake HTTP endpoint: ${config.url}`);
        } },
        requestLimiter: { acquire: async () => {} },
        env: integrationEnv,
        now: () => Date.parse('2026-10-06T12:00:00.000Z'),
        log: { logEtgExchange() {} }
    });
}

async function cleanupIntegrationRun({ database, connection, mongooseInstance, databaseEnv,
    databaseName, runId, databaseCreatedByRun, allOperationsSettled,
    databaseSetupSettled = true, activeRunSettled = true, primaryError, tracker }) {
    let cleanupError;
    const operationsSettled = (allOperationsSettled ?? (databaseSetupSettled && activeRunSettled))
        && (!tracker || tracker.isSettled());
    if (databaseCreatedByRun && !operationsSettled) {
        cleanupError = new Error('integration_cleanup_database_preserved_operations_not_settled');
    } else if (databaseCreatedByRun) {
        const cleanupTracker = tracker || createOperationTracker();
        try {
            await runTrackedOperation(cleanupTracker, 'integration_cleanup_connect',
                () => database.ensureConnected({ env: databaseEnv, connectTimeoutMs: 2500 }));
            if (connection.db.databaseName !== databaseName) {
                throw new Error('integration_cleanup_database_target_mismatch');
            }
            const ownershipCollection = ownershipCollectionForRun(runId);
            const ownershipRecord = await runTrackedOperation(cleanupTracker,
                'integration_cleanup_read_ownership',
                () => connection.db.collection(ownershipCollection).findOne({ _id: runId }));
            assertDatabaseOwnership({
                actualDatabaseName: connection.db.databaseName,
                expectedDatabaseName: databaseName,
                ownershipCollection,
                ownershipRecord,
                runId
            });
            if (!cleanupTracker.isSettled()) {
                throw new Error('integration_cleanup_database_preserved_operations_not_settled');
            }
            await runTrackedOperation(cleanupTracker, 'integration_drop_owned_database',
                () => connection.dropDatabase());
        } catch (error) {
            cleanupError = error;
        }
    }

    try {
        await runTrackedOperation(tracker || createOperationTracker(), 'integration_database_close',
            () => database.close());
    } catch (error) {
        cleanupError = combineErrors(cleanupError, error);
        try {
            await runTrackedOperation(tracker || createOperationTracker(),
                'integration_forced_connection_close', () => connection.close(true));
        } catch (forcedCloseError) {
            cleanupError = combineErrors(cleanupError, forcedCloseError);
        }
    }
    try {
        await runTrackedOperation(tracker || createOperationTracker(), 'integration_mongoose_disconnect',
            () => mongooseInstance.disconnect());
    } catch (error) {
        cleanupError = combineErrors(cleanupError, error);
    }
    return combineErrors(primaryError, cleanupError);
}

function buildFetchAdapters(client) {
    return {
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
    };
}

function matchesMongoFilter(document, filter) {
    if (!document) return false;
    return Object.entries(filter || {}).every(([key, expected]) => {
        if (key === '$and') return expected.every(item => matchesMongoFilter(document, item));
        if (key === '$or') return expected.some(item => matchesMongoFilter(document, item));
        const actual = document[key];
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
            if ('$exists' in expected && (actual !== undefined) !== expected.$exists) return false;
            if ('$lte' in expected && !(actual instanceof Date && actual <= expected.$lte)) return false;
            if ('$gt' in expected && !(actual instanceof Date && actual > expected.$gt)) return false;
            return true;
        }
        if (actual instanceof Date && expected instanceof Date) {
            return actual.getTime() === expected.getTime();
        }
        return actual === expected;
    });
}

function createFakeSyncModels({ events, failCheckpointOnce = false }) {
    const store = { content: new Map(), states: new Map(), leases: new Map() };
    let shouldFailCheckpoint = failCheckpointOnce;

    class ContentModel {
        constructor(record) { Object.assign(this, record); }
        validateSync() { return undefined; }
        static async createIndexes() { events.push('content_indexes'); }
        static async bulkWrite(operations, options = {}) {
            events.push('content_write');
            const apply = () => {
                for (const { updateOne } of operations) {
                    const { hotelCode, language, source } = updateOne.filter;
                    const key = `${hotelCode}|${language}|${source}`;
                    store.content.set(key, {
                        ...(store.content.get(key) || {}),
                        ...(updateOne.update.$setOnInsert || {}),
                        ...updateOne.update.$set
                    });
                }
            };
            if (options.session) options.session.stage(apply);
            else apply();
            return { acknowledged: true, upsertedCount: operations.length };
        }
        static async countDocuments(filter) {
            events.push('content_count');
            return [...store.content.values()].filter(record => matchesMongoFilter(record, filter)).length;
        }
        static findOne(filter) {
            return {
                lean: async () => {
                    events.push('content_find');
                    const record = [...store.content.values()].find(item => matchesMongoFilter(item, filter));
                    return record ? structuredClone(record) : null;
                }
            };
        }
    }

    class StateModel {
        static async createIndexes() { events.push('state_indexes'); }
        static findById(id) {
            const query = {
                lean() { return query; },
                exec: async () => structuredClone(store.states.get(id) || null)
            };
            return query;
        }
        static async updateOne(filter, update, options = {}) {
            events.push('state_write');
            if (options.session && shouldFailCheckpoint) {
                shouldFailCheckpoint = false;
                throw new Error('integration_fixture_checkpoint_failure');
            }
            const current = store.states.get(filter._id);
            if (!current && !options.upsert) return { acknowledged: true, matchedCount: 0 };
            const apply = () => store.states.set(filter._id, {
                ...(store.states.get(filter._id) || {}),
                ...(update.$set || {}),
                _id: filter._id
            });
            if (options.session) options.session.stage(apply);
            else apply();
            return { acknowledged: true, matchedCount: current ? 1 : 0, upsertedCount: current ? 0 : 1 };
        }
        static async countDocuments(filter) {
            events.push('state_count');
            return [...store.states.values()].filter(record => matchesMongoFilter(record, filter)).length;
        }
    }

    class LeaseModel {
        static async createIndexes() { events.push('lease_indexes'); }
        static findOneAndUpdate(filter, update, options = {}) {
            return {
                exec: async () => {
                    let current = store.leases.get(filter._id);
                    if (!matchesMongoFilter(current, filter)) {
                        if (current || !options.upsert) {
                            const error = new Error('duplicate key');
                            error.code = 11000;
                            throw error;
                        }
                        current = { _id: filter._id };
                        store.leases.set(filter._id, current);
                    }
                    Object.assign(current, update.$setOnInsert || {}, update.$set || {});
                    for (const [key, amount] of Object.entries(update.$inc || {})) {
                        current[key] = (current[key] || 0) + amount;
                    }
                    return { ...structuredClone(current), toObject() { return structuredClone(current); } };
                }
            };
        }
        static findById(id) {
            const query = {
                lean() { return query; },
                exec: async () => structuredClone(store.leases.get(id) || null)
            };
            return query;
        }
        static async updateOne(filter, update, options = {}) {
            events.push(options.session ? 'lease_transaction_write' : 'lease_write');
            const current = store.leases.get(filter._id);
            if (!matchesMongoFilter(current, filter)) return { acknowledged: true, matchedCount: 0 };
            const apply = () => {
                const latest = store.leases.get(filter._id);
                Object.assign(latest, update.$set || {});
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
                events.push('session_start');
                return {
                    stage(operation) { staged.push(operation); },
                    async withTransaction(callback) {
                        staged = [];
                        try {
                            await callback();
                            for (const operation of staged) operation();
                            events.push('transaction_commit');
                        } catch (error) {
                            staged = [];
                            events.push('transaction_abort');
                            throw error;
                        }
                    },
                    async endSession() { events.push('session_end'); }
                };
            }
        }
    };
    return { ContentModel, StateModel, LeaseModel, database, store };
}

test('Mongo integration URI guard rejects non-loopback and unsafe connection options', () => {
    const databaseName = `hotelbeds_sync_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    const unsafeUris = [
        'mongodb+srv://localhost/anything',
        'mongodb://example.com:27017/?directConnection=true',
        'mongodb://user:pass@127.0.0.1:27017/?directConnection=true',
        'mongodb://127.0.0.1:27017/?directConnection=false',
        'mongodb://localhost:27017/?directConnection=true',
        'mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0'
    ];
    for (const uri of unsafeUris) {
        assert.throws(() => localMongoUriForDatabase(uri, databaseName),
            /integration_mongo_uri_must_be_local_direct_connection/);
    }
    assert.throws(() => localMongoUriForDatabase(
        'mongodb://127.0.0.1:27017/?directConnection=true', 'existing_application_db'),
    /integration_mongo_uri_must_be_local_direct_connection/);

    const safeUri = localMongoUriForDatabase(
        'mongodb://127.0.0.1:27017/?directConnection=true', databaseName);
    assertTestDatabaseUriIsLocalAndDirect(safeUri);
});

test('database ownership is mandatory before cleanup and existing names are refused', () => {
    const databaseName = `hotelbeds_sync_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    const runId = crypto.randomUUID();
    assert.throws(() => assertFreshDatabaseOwnership({
        existingDatabaseNames: [databaseName], expectedDatabaseName: databaseName, runId
    }), error => error.message === 'integration_database_preexisting');

    const marker = assertFreshDatabaseOwnership({
        existingDatabaseNames: [], expectedDatabaseName: databaseName, runId
    });
    assertDatabaseOwnership({
        actualDatabaseName: databaseName,
        expectedDatabaseName: databaseName,
        ownershipCollection: ownershipCollectionForRun(runId),
        ownershipRecord: marker,
        runId
    });
    assert.throws(() => assertDatabaseOwnership({
        actualDatabaseName: databaseName,
        expectedDatabaseName: databaseName,
        ownershipCollection: ownershipCollectionForRun(runId),
        ownershipRecord: { ...marker, _id: crypto.randomUUID() },
        runId
    }), error => error.message === 'integration_cleanup_database_ownership_mismatch');
});

test('active sync cleanup always releases its barrier and preserves primary errors', async () => {
    let released = 0;
    const primaryError = new Error('integration_primary_failure');
    const cleanupError = new Error('integration_active_sync_cleanup_timeout');
    const result = await releaseAndSettleActiveRun({
        release: () => { released += 1; },
        activeRun: Promise.reject(cleanupError),
        primaryError
    });
    assert.equal(released, 1);
    assert.equal(result.settled, true);
    const combined = result.error;
    assert.ok(combined instanceof AggregateError);
    assert.equal(combined.errors[0], primaryError);
    assert.equal(combined.errors[1], cleanupError);
    assert.equal(combineErrors(primaryError, null), primaryError);
});

test('owned database initialization uses cloned schemas and tracks setup until settled', async () => {
    const databaseName = `hotelbeds_sync_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    const runId = crypto.randomUUID();
    const tracker = createOperationTracker();
    let finishSetup;
    let creationAttempted = false;
    const setupOperation = new Promise(resolve => { finishSetup = resolve; });
    const schemas = schemasForIntegration();

    const initialization = await initializeOwnedDatabase({
        databaseName,
        runId,
        tracker,
        listDatabaseNames: async () => [],
        onDatabaseCreationAttempt: () => { creationAttempted = true; },
        createOwnershipMarkerAndModels: async (record, markCreationAttempted) => {
            assert.equal(record.databaseName, databaseName);
            assert.equal(record.ownershipCollection, ownershipCollectionForRun(runId));
            markCreationAttempted();
            await setupOperation;
            return { schemas };
        }
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(creationAttempted, true);
    const pending = await tracker.settle(5);
    assert.equal(pending.settled, false);
    assert.deepEqual(pending.pending, ['integration_create_owned_models']);

    finishSetup({ schemas });
    const initialized = await initialization.setup.promise;
    assert.equal(initialization.setup.isSettled(), true);
    assert.equal(initialized.schemas, schemas);
    assert.deepEqual(await tracker.settle(), { settled: true, pending: [] });
});

test('complete fake adapter sync flow waits for every operation before owned database cleanup', async () => {
    const tracker = createOperationTracker();
    const databaseName = `hotelbeds_sync_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    const runId = crypto.randomUUID();
    const ownershipRecords = new Map();
    const events = [];
    let releaseFetch;
    const fetchBarrier = new Promise(resolve => { releaseFetch = resolve; });
    let signalFetchStarted;
    const fetchStarted = new Promise(resolve => { signalFetchStarted = resolve; });
    let noChanges = false;
    const database = {
        async ensureConnected() { events.push('connect'); },
        async close() { events.push('close'); }
    };
    const connection = {
        db: {
            databaseName,
            collection(name) {
                return {
                    async insertOne(record) {
                        ownershipRecords.set(name, record);
                        events.push('ownership_insert');
                    },
                    async findOne() {
                        events.push('ownership_read');
                        return ownershipRecords.get(name);
                    }
                };
            }
        },
        async dropDatabase() { events.push('drop'); }
    };
    const mongooseInstance = { async disconnect() { events.push('disconnect'); } };
    const schemas = schemasForIntegration();
    const models = createFakeSyncModels({ events, failCheckpointOnce: true });
    Object.assign(models.database, {
        async ensureConnected() { events.push('sync_database_connect'); },
        async close() { events.push('sync_database_close'); }
    });
    const initialization = await initializeOwnedDatabase({
        databaseName,
        runId,
        tracker,
        listDatabaseNames: async () => [],
        onDatabaseCreationAttempt: () => { events.push('creation_attempt'); },
        createOwnershipMarkerAndModels: async (record, onCreationAttempt) => {
            onCreationAttempt();
            await connection.db.collection(record.ownershipCollection).insertOne(record);
            return { ...models, schemas };
        }
    });
    const initialized = await withTimeout(initialization.setup.promise, 'fake_database_setup');
    assert.equal(initialized.schemas, schemas);

    const client = createFakeContentClient({ requests: [], noChanges: () => noChanges });
    const createService = StateModel => createHotelbedsContentSyncService({
        ContentModel: models.ContentModel,
        StateModel,
        LeaseModel: models.LeaseModel,
        database: models.database,
        env: integrationEnv,
        now: () => new Date('2026-10-06T12:00:00.000Z'),
        testOnly: true,
        ensureModelsConnected: async () => { events.push('sync_models_ready'); }
    });
    const fetchAdapters = buildFetchAdapters(client);
    const options = { hotelCodes: [74], language: 'ENG' };

    const failedBootstrap = tracker.run('fake_failed_checkpoint_sync',
        () => createService(models.StateModel).syncContent(options, fetchAdapters));
    await assert.rejects(withTimeout(failedBootstrap.promise, 'fake_failed_checkpoint_sync'),
        /integration_fixture_checkpoint_failure/);
    assert.equal(await runTrackedOperation(tracker, 'fake_rollback_content_count',
        () => models.ContentModel.countDocuments({})), 0,
    'transaction rollback must leave content empty when the checkpoint write fails');
    assert.equal(await runTrackedOperation(tracker, 'fake_rollback_state_count',
        () => models.StateModel.countDocuments({})), 0,
    'a failed bootstrap must not persist its cursor');

    const bootstrap = await runTrackedOperation(tracker, 'fake_bootstrap_sync',
        () => createService(models.StateModel).syncContent(options, fetchAdapters));
    assert.equal(bootstrap.bootstrap, true);
    assert.equal(bootstrap.importedCount, 1);
    assert.equal(await runTrackedOperation(tracker, 'fake_committed_content_count',
        () => models.ContentModel.countDocuments({ hotelCode: 74, language: 'ENG' })), 1);
    assert.equal(await runTrackedOperation(tracker, 'fake_committed_state_count',
        () => models.StateModel.countDocuments({ initialized: true })), 1);

    noChanges = false;
    const delayedAdapters = {
        ...fetchAdapters,
        fetchPage: async requestOptions => {
            const response = await client.getHotelsPage(requestOptions);
            signalFetchStarted();
            await withTimeout(fetchBarrier, 'fake_sync_fetch_release');
            return response.data;
        }
    };
    const activeSync = tracker.run('fake_active_content_sync',
        () => createService(models.StateModel).syncContent(options, delayedAdapters));
    const activeRun = activeSync.promise;
    await Promise.race([
        withTimeout(fetchStarted, 'fake_sync_fetch_start'),
        activeRun.then(() => { throw new Error('fake_active_sync_ended_before_fetch'); })
    ]);
    await assert.rejects(runTrackedOperation(tracker, 'fake_competing_content_sync',
        () => createService(models.StateModel).syncContent(options, fetchAdapters)),
    error => error.code === 'hotelbeds_content_sync_already_running');

    const timedOut = await tracker.settle(5);
    assert.equal(timedOut.settled, false);
    assert.ok(timedOut.pending.includes('fake_active_content_sync'));

    const cleanupBeforeSyncSettles = await cleanupIntegrationRun({
        database,
        connection,
        mongooseInstance,
        databaseEnv: {},
        databaseName,
        runId,
        databaseCreatedByRun: true,
        allOperationsSettled: timedOut.settled,
        primaryError: new Error('fixture_sync_timeout'),
        tracker
    });
    assert.ok(cleanupBeforeSyncSettles instanceof AggregateError);
    assert.equal(events.includes('drop'), false, 'cleanup must preserve the database while sync is pending');

    releaseFetch();
    const settledRun = await releaseAndSettleActiveRun({ activeRun, primaryError: null });
    assert.equal(settledRun.settled, true);
    assert.equal(settledRun.error, null);
    assert.equal(activeSync.isSettled(), true);
    events.push('sync_finished');
    assert.deepEqual(await tracker.settle(), { settled: true, pending: [] });
    const lease = await runTrackedOperation(tracker, 'fake_writer_lease_read',
        () => models.LeaseModel.findById('hotelbeds-content-writer:test').lean().exec());
    assert.equal(lease.leaseId, undefined, 'successful commits release the writer lease');

    const cleanupError = await cleanupIntegrationRun({
        database,
        connection,
        mongooseInstance,
        databaseEnv: {},
        databaseName,
        runId,
        databaseCreatedByRun: true,
        allOperationsSettled: tracker.isSettled(),
        primaryError: null,
        tracker
    });

    assert.equal(cleanupError, null);
    assert.ok(events.lastIndexOf('transaction_commit') < events.indexOf('sync_finished'));
    assert.ok(events.indexOf('sync_finished') < events.indexOf('ownership_read'));
    assert.ok(events.indexOf('ownership_read') < events.indexOf('drop'));
    const droppedAt = events.indexOf('drop');
    const finalCloseAt = events.lastIndexOf('close');
    assert.ok(droppedAt < finalCloseAt);
    assert.ok(finalCloseAt < events.lastIndexOf('disconnect'));
});

test('cleanup failure is reported together with the original sync failure', async () => {
    const primaryError = new Error('integration_sync_failure');
    const cleanupError = new Error('integration_drop_failure');
    const result = combineErrors(primaryError, cleanupError);
    assert.ok(result instanceof AggregateError);
    assert.equal(result.errors[0], primaryError);
    assert.equal(result.errors[1], cleanupError);
    assert.equal(result.cause, primaryError);
});

test('unsettled sync preserves the owned database instead of dropping it', async () => {
    let connected = 0;
    let closed = 0;
    let disconnected = 0;
    const database = {
        async ensureConnected() { connected += 1; },
        async close() { closed += 1; }
    };
    const connection = { readyState: 1 };
    const mongooseInstance = { async disconnect() { disconnected += 1; } };
    const primaryError = new Error('integration_sync_timeout');

    const result = await cleanupIntegrationRun({
        database,
        connection,
        mongooseInstance,
        databaseEnv: {},
        databaseName: 'hotelbeds_sync_mock_fixture',
        runId: crypto.randomUUID(),
        databaseCreatedByRun: true,
        activeRunSettled: false,
        primaryError
    });

    assert.ok(result instanceof AggregateError);
    assert.equal(result.errors[0], primaryError);
    assert.equal(result.errors[1].message,
        'integration_cleanup_database_preserved_operations_not_settled');
    assert.equal(connected, 0, 'must not reconnect to drop a DB while its writer may still run');
    assert.equal(closed, 1);
    assert.equal(disconnected, 1);
});

test('unsettled active sync preserves database and reports cleanup failure without reconnecting', async () => {
    const primaryError = new Error('integration_sync_timeout');
    let connectCalls = 0;
    let closeCalls = 0;
    let disconnectCalls = 0;
    const result = await cleanupIntegrationRun({
        database: {
            async ensureConnected() { connectCalls += 1; },
            async close() { closeCalls += 1; }
        },
        connection: { readyState: 1 },
        mongooseInstance: { async disconnect() { disconnectCalls += 1; } },
        databaseEnv: {},
        databaseName: 'hotelbeds_sync_mock_fixture',
        runId: crypto.randomUUID(),
        databaseCreatedByRun: true,
        activeRunSettled: false,
        primaryError
    });

    assert.ok(result instanceof AggregateError);
    assert.equal(result.errors[0], primaryError);
    assert.equal(result.errors[1].message,
        'integration_cleanup_database_preserved_operations_not_settled');
    assert.equal(connectCalls, 0);
    assert.equal(closeCalls, 1);
    assert.equal(disconnectCalls, 1);
});

test('database setup cleanup preserves the database until setup operations settle', async () => {
    let connected = 0;
    let closed = 0;
    let disconnected = 0;
    const primaryError = new Error('integration_setup_timeout');
    const cleanupError = await cleanupIntegrationRun({
        database: {
            async ensureConnected() { connected += 1; },
            async close() { closed += 1; }
        },
        connection: { readyState: 1 },
        mongooseInstance: { async disconnect() { disconnected += 1; } },
        databaseEnv: {},
        databaseName: 'hotelbeds_sync_mock_fixture',
        runId: crypto.randomUUID(),
        databaseCreatedByRun: true,
        databaseSetupSettled: false,
        activeRunSettled: true,
        primaryError
    });

    assert.ok(cleanupError instanceof AggregateError);
    assert.equal(cleanupError.errors[0], primaryError);
    assert.equal(cleanupError.errors[1].message,
        'integration_cleanup_database_preserved_operations_not_settled');
    assert.equal(connected, 0, 'must not reconnect or drop while DB setup commands remain in flight');
    assert.equal(closed, 1);
    assert.equal(disconnected, 1);
});

test('Content sync commits atomically on an owned local MongoDB replica set with fake supplier HTTP', {
    skip: !rawMongoUri && `${MONGO_URI_ENV} is not set; no database was contacted`,
    timeout: 30000
}, async () => {
    const databaseName = `hotelbeds_sync_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    const runId = crypto.randomUUID();
    const isolatedUri = localMongoUriForDatabase(rawMongoUri, databaseName);
    assertTestDatabaseUriIsLocalAndDirect(isolatedUri);

    const mongooseInstance = new mongoose.Mongoose();
    const connection = mongooseInstance.createConnection();
    connection.set('autoCreate', false);
    connection.set('autoIndex', false);
    const database = hotelbedsMockDatabaseModule.createHotelbedsMockDatabase({
        mongooseInstance,
        isolatedConnection: connection
    });
    const databaseEnv = {
        ...integrationEnv,
        HOTELBEDS_MOCK_MONGO_URI: isolatedUri,
        MONGO_URI: 'mongodb://127.0.0.1:27017/rimal_application_guard'
    };
    const tracker = createOperationTracker();
    const schemas = schemasForIntegration();
    let models;
    let databaseCreationAttempted = false;
    let databaseSetup;
    let activeRun;
    let releaseActiveRun;
    let activeRunSettled = true;
    let primaryError;

    try {
        await runTrackedOperation(tracker, 'integration_mongo_connect',
            () => database.ensureConnected({ env: databaseEnv, connectTimeoutMs: 2500 }));
        assert.equal(connection.db.databaseName, databaseName);
        const initialization = await initializeOwnedDatabase({
            databaseName,
            runId,
            tracker,
            listDatabaseNames: async () => {
                const result = await connection.db.admin().listDatabases({ nameOnly: true });
                return result.databases.map(item => item.name);
            },
            onDatabaseCreationAttempt: () => { databaseCreationAttempted = true; },
            createOwnershipMarkerAndModels: (ownershipRecord, onDatabaseCreationAttempt) =>
                createOwnedModels({
                    connection,
                    schemas,
                    ownershipCollection: ownershipCollectionForRun(runId),
                    ownershipRecord,
                    onDatabaseCreationAttempt
                })
        });
        databaseSetup = initialization.setup;
        models = await withTimeout(databaseSetup.promise, 'integration_create_owned_models');
        const { ContentModel, StateModel, LeaseModel } = models;

        const requests = [];
        let noChanges = false;
        const client = createFakeContentClient({
            requests,
            noChanges: () => noChanges
        });
        const createService = ModelState => createHotelbedsContentSyncService({
            ContentModel,
            StateModel: ModelState,
            LeaseModel,
            database,
            env: databaseEnv,
            now: () => new Date('2026-10-06T12:00:00.000Z')
        });
        const fetchAdapters = buildFetchAdapters(client);
        const options = { hotelCodes: [74], language: 'ENG' };

        let failCheckpointOnce = true;
        const FailingCheckpointModel = new Proxy(StateModel, {
            get(target, property) {
                if (property === 'updateOne') {
                    return (filter, update, updateOptions) => {
                        if (failCheckpointOnce && updateOptions?.session) {
                            failCheckpointOnce = false;
                            throw new Error('integration_fixture_checkpoint_failure');
                        }
                        return target.updateOne(filter, update, updateOptions);
                    };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });

        await assert.rejects(
            runTrackedOperation(tracker, 'integration_failed_checkpoint_sync',
                () => createService(FailingCheckpointModel).syncContent(options, fetchAdapters)),
            /integration_fixture_checkpoint_failure/
        );
        assert.equal(await runTrackedOperation(tracker, 'integration_failed_content_count',
            () => ContentModel.countDocuments({})), 0,
            'content write must roll back when checkpoint write fails');
        assert.equal(await runTrackedOperation(tracker, 'integration_failed_state_count',
            () => StateModel.countDocuments({})), 0,
            'failed bootstrap must not persist a cursor');

        const first = await runTrackedOperation(tracker, 'integration_bootstrap_sync',
            () => createService(StateModel).syncContent(options, fetchAdapters));
        assert.equal(first.bootstrap, true);
        assert.equal(first.importedCount, 1);
        assert.deepEqual(requests.map(config => config.url), [
            'https://api.test.hotelbeds.com/hotel-content-api/1.0/hotels',
            'https://api.test.hotelbeds.com/hotel-content-api/1.0/types/categories',
            'https://api.test.hotelbeds.com/hotel-content-api/1.0/hotels',
            'https://api.test.hotelbeds.com/hotel-content-api/1.0/types/categories'
        ]);
        assert.equal(requests[2].params.codes, '74');
        assert.equal(await runTrackedOperation(tracker, 'integration_bootstrap_content_count',
            () => ContentModel.countDocuments({ hotelCode: 74, language: 'ENG' })), 1);
        assert.equal(await runTrackedOperation(tracker, 'integration_bootstrap_state_count',
            () => StateModel.countDocuments({ initialized: true })), 1);
        const contentBeforeEmptyDelta = await runTrackedOperation(tracker,
            'integration_content_before_delta_read',
            () => ContentModel.findOne({ hotelCode: 74, language: 'ENG' }).lean());

        noChanges = true;
        const emptyDelta = await runTrackedOperation(tracker, 'integration_empty_delta_sync',
            () => createService(StateModel).syncContent(options, fetchAdapters));
        assert.equal(emptyDelta.bootstrap, false);
        assert.equal(emptyDelta.importedCount, 0);
        assert.equal(emptyDelta.lastUpdateTime, '2026-10-05');
        const contentAfterEmptyDelta = await runTrackedOperation(tracker,
            'integration_content_after_delta_read',
            () => ContentModel.findOne({ hotelCode: 74, language: 'ENG' }).lean());
        assert.equal(contentAfterEmptyDelta.syncedAt.getTime(), contentBeforeEmptyDelta.syncedAt.getTime());
        assert.equal(await runTrackedOperation(tracker, 'integration_empty_delta_state_count',
            () => StateModel.countDocuments({ initialized: true })), 1);

        noChanges = false;
        let signalFetchStarted;
        const started = new Promise(resolve => { signalFetchStarted = resolve; });
        let releaseResumeFetch;
        const resume = new Promise(resolve => { releaseResumeFetch = resolve; });
        releaseActiveRun = () => releaseResumeFetch?.();
        const delayedAdapters = {
            ...fetchAdapters,
            fetchPage: async options => {
                const response = await client.getHotelsPage(options);
                signalFetchStarted();
                await withTimeout(resume, 'integration_fetch_release');
                return response.data;
            }
        };
        const activeRunEntry = tracker.run('integration_active_sync',
            () => createService(StateModel).syncContent(options, delayedAdapters));
        activeRun = activeRunEntry.promise;
        let concurrencyError;
        try {
            await Promise.race([
                withTimeout(started, 'integration_fetch_start'),
                activeRun.then(() => { throw new Error('integration_active_sync_ended_before_fetch'); })
            ]);
            await assert.rejects(
                runTrackedOperation(tracker, 'integration_competing_sync',
                    () => createService(StateModel).syncContent(options, fetchAdapters)),
                error => error.code === 'hotelbeds_content_sync_already_running'
            );
        } catch (error) {
            concurrencyError = error;
        }
        const settledRun = await releaseAndSettleActiveRun({
            release: releaseActiveRun,
            activeRun,
            primaryError: concurrencyError
        });
        activeRunSettled = settledRun.settled;
        activeRun = null;
        releaseActiveRun = null;
        if (settledRun.error) throw settledRun.error;

        const lease = await runTrackedOperation(tracker, 'integration_writer_lease_read',
            () => LeaseModel.findById('hotelbeds-content-writer:test').lean());
        assert.equal(lease.leaseId, undefined, 'writer lease must be released after successful commits');

        await runTrackedOperation(tracker, 'integration_close_before_reopen',
            () => database.close());
        await runTrackedOperation(tracker, 'integration_reopen_database',
            () => database.ensureConnected({ env: databaseEnv, connectTimeoutMs: 2500 }));
        assert.equal(connection.db.databaseName, databaseName);
        assert.equal(await runTrackedOperation(tracker, 'integration_reopened_state_count',
            () => StateModel.countDocuments({ initialized: true })), 1,
            'cursor must persist after closing and reopening the local database connection');
        assert.equal(await runTrackedOperation(tracker, 'integration_reopened_content_count',
            () => ContentModel.countDocuments({ hotelCode: 74, language: 'ENG' })), 1);
        assert.equal(await runTrackedOperation(tracker, 'integration_reopened_ping',
            () => connection.db.admin().command({ ping: 1 }).then(result => result.ok)), 1);
    } catch (error) {
        primaryError = error;
    } finally {
        if (databaseSetup && !databaseSetup.isSettled()) {
            try {
                await withTimeout(databaseSetup.promise, 'integration_database_setup_cleanup');
            } catch (error) {
                primaryError = combineErrors(primaryError, error);
            }
        }
        if (activeRun) {
            const settledRun = await releaseAndSettleActiveRun({
                release: releaseActiveRun,
                activeRun,
                primaryError
            });
            activeRunSettled = settledRun.settled;
            primaryError = settledRun.error;
        }

        const cleanupError = await cleanupIntegrationRun({
            database,
            connection,
            mongooseInstance,
            databaseEnv,
            databaseName,
            runId,
            databaseCreatedByRun: databaseCreationAttempted,
            allOperationsSettled: tracker.isSettled(),
            databaseSetupSettled: !databaseSetup || databaseSetup.isSettled(),
            activeRunSettled,
            primaryError,
            tracker
        });
        if (cleanupError) throw cleanupError;
    }
});