const crypto = require('node:crypto');
const HotelbedsHotelContent = require('../models/HotelbedsVerifiedHotelContent');
const HotelbedsContentSyncState = require('../models/HotelbedsContentSyncState');
const HotelbedsContentSyncLease = require('../models/HotelbedsContentSyncLease');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { credentialsFrom } = require('./hotelbedsClient');
const { contentImportPlan, createHotelbedsContentImportService } = require('./hotelbedsContentImportService');

const RESOURCE_VERSION = 'hotels-categories-v1';
const WRITER_LEASE_ID = 'hotelbeds-content-writer:test';
const LEASE_DURATION_MS = 10 * 60 * 1000;
const OVERLAP_DAYS = 1;
const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true, wtimeout: 10000 });

function fail(code, httpStatus = 503, cause) {
    return Object.assign(new Error(code), { code, httpStatus, ...(cause ? { cause } : {}) });
}

function validDate(value) {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function validDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function utcDate(value) {
    return value.toISOString().slice(0, 10);
}

function subtractUtcDays(value, days) {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return utcDate(date);
}

function scopeFrom(options, env) {
    const credentials = credentialsFrom(env);
    const hotelCodes = [...options.hotelCodes].sort((left, right) => left - right);
    const accountFingerprint = crypto.createHash('sha256')
        .update(`hotelbeds-content-account-v1:${credentials.environment}:${credentials.apiKey}`, 'utf8')
        .digest('hex');
    const identity = {
        environment: credentials.environment,
        accountFingerprint,
        hotelCodes,
        language: options.language,
        resourceVersion: RESOURCE_VERSION
    };
    const scopeKey = crypto.createHash('sha256').update(JSON.stringify(identity), 'utf8').digest('hex');
    return Object.freeze({ ...identity, scopeKey, cursorId: scopeKey });
}

function queryExec(query) {
    return query && typeof query.exec === 'function' ? query.exec() : query;
}

function duplicateKey(error) {
    return error?.code === 11000 || error?.code === 11001;
}

function createHotelbedsContentSyncService({
    ContentModel = HotelbedsHotelContent,
    StateModel = HotelbedsContentSyncState,
    LeaseModel = HotelbedsContentSyncLease,
    database = hotelbedsMockDatabase,
    env = process.env,
    now = () => new Date(),
    testOnly = false,
    ensureModelsConnected: testEnsureModelsConnected,
} = {}) {
    if (!ContentModel || !StateModel || !LeaseModel || !database
        || testOnly && (typeof testEnsureModelsConnected !== 'function' || process.env.NODE_ENV === 'production')
        || !testOnly && testEnsureModelsConnected !== undefined) {
        throw new TypeError('hotelbeds_content_sync_dependencies_invalid');
    }

    const importer = createHotelbedsContentImportService({
        ContentModel, database, env, now, testOnly,
        ...(testOnly ? { ensureModelConnected: async model => testEnsureModelsConnected([model]) } : {})
    });

    let readyPromise;
    async function ensureReady() {
        if (testOnly) {
            await testEnsureModelsConnected([ContentModel, StateModel, LeaseModel]);
            return;
        }
        if (!readyPromise) {
            readyPromise = Promise.resolve().then(async () => {
                for (const Model of [ContentModel, StateModel, LeaseModel]) {
                    await database.ensureModelConnected(Model, {
                        env,
                        expectedConnection: database.connection,
                        errorCode: 'hotelbeds_content_database_unavailable'
                    });
                }
                await Promise.all([ContentModel.init(), StateModel.init(), LeaseModel.init()]);
                const hello = await database.connection.db.admin().command({ hello: 1 });
                const supportedReplicaSet = typeof hello?.setName === 'string'
                    && hello.setName.trim()
                    && Number.isSafeInteger(hello.maxWireVersion) && hello.maxWireVersion >= 7;
                const supportedShardedCluster = hello?.msg === 'isdbgrid'
                    && Number.isSafeInteger(hello.maxWireVersion) && hello.maxWireVersion >= 8;
                if (!supportedReplicaSet && !supportedShardedCluster) {
                    throw fail('hotelbeds_content_transactions_unavailable', 503);
                }
            }).catch(error => {
                readyPromise = null;
                if (error?.code === 'hotelbeds_content_transactions_unavailable') throw error;
                throw fail('hotelbeds_content_database_unavailable', 503, error);
            });
        }
        await readyPromise;
    }

    async function acquireLease(scope, leaseId, acquiredAt) {
        try {
            const query = LeaseModel.findOneAndUpdate({
                _id: WRITER_LEASE_ID,
                $and: [
                    { $or: [
                        { accountFingerprint: scope.accountFingerprint },
                        { accountFingerprint: { $exists: false } }
                    ] },
                    { $or: [
                        { leaseUntil: { $exists: false } },
                        { leaseUntil: { $lte: acquiredAt } }
                    ] }
                ]
            }, {
                $set: {
                    leaseId,
                    leaseUntil: new Date(acquiredAt.getTime() + LEASE_DURATION_MS),
                    scopeKey: scope.scopeKey,
                    accountFingerprint: scope.accountFingerprint
                },
                $setOnInsert: { _id: WRITER_LEASE_ID },
                $inc: { fencingToken: 1 }
            }, {
                new: true,
                upsert: true,
                setDefaultsOnInsert: false,
                writeConcern: WRITE_CONCERN
            });
            const lease = await queryExec(query);
            if (!lease) throw fail('hotelbeds_content_sync_already_running', 409);
            return { ...(lease.toObject?.() || lease), acquiredAt };
        } catch (error) {
            if (error?.code === 'hotelbeds_content_sync_lease_unavailable'
                || error?.code === 'hotelbeds_content_sync_already_running') throw error;
            if (duplicateKey(error)) {
                const current = await queryExec(LeaseModel.findById(WRITER_LEASE_ID));
                if (current?.accountFingerprint && current.accountFingerprint !== scope.accountFingerprint) {
                    throw fail('hotelbeds_content_sync_database_account_mismatch', 409);
                }
                throw fail('hotelbeds_content_sync_already_running', 409);
            }
            throw fail('hotelbeds_content_sync_lease_unavailable', 503, error);
        }
    }

    async function releaseLease(lease) {
        const result = await LeaseModel.updateOne({
            _id: WRITER_LEASE_ID,
            leaseId: lease.leaseId,
            fencingToken: lease.fencingToken
        }, {
            $unset: { leaseId: '', leaseUntil: '', scopeKey: '' }
        }, { writeConcern: WRITE_CONCERN });
        if (result?.acknowledged === false) throw fail('hotelbeds_content_sync_cleanup_failed', 500);
    }

    async function commitRun({ scope, lease, initialized, writeContent }) {
        const session = await database.connection.startSession();
        let result = null;
        try {
            await session.withTransaction(async () => {
                const commitAt = new Date(now());
                if (!validDate(commitAt)) throw fail('hotelbeds_content_sync_clock_invalid', 503);

                const renewed = await LeaseModel.updateOne({
                    _id: WRITER_LEASE_ID,
                    leaseId: lease.leaseId,
                    fencingToken: lease.fencingToken,
                    scopeKey: scope.scopeKey,
                    leaseUntil: { $gt: commitAt }
                }, {
                    $set: { leaseUntil: new Date(commitAt.getTime() + LEASE_DURATION_MS) }
                }, { session });
                if (renewed.matchedCount !== 1) {
                    throw fail('hotelbeds_content_sync_lease_lost', 409);
                }

                result = await writeContent(session);
                if (result?.acknowledged === false) {
                    throw fail('hotelbeds_content_sync_write_unacknowledged', 503);
                }

                const stateWrite = await StateModel.updateOne({ _id: scope.cursorId }, {
                    $set: {
                        environment: scope.environment,
                        accountFingerprint: scope.accountFingerprint,
                        hotelCodes: scope.hotelCodes,
                        language: scope.language,
                        resourceVersion: scope.resourceVersion,
                        initialized: true,
                        // Anchor the next date-granular request to when this run
                        // started, never to a later date crossed during the run.
                        lastSuccessfulDate: utcDate(lease.acquiredAt),
                        lastRunAt: commitAt
                    }
                }, { upsert: true, session });
                if (!stateWrite.acknowledged) throw fail('hotelbeds_content_sync_checkpoint_failed', 503);
            }, { writeConcern: WRITE_CONCERN });
            return result;
        } finally {
            await session.endSession();
        }
    }

    async function syncContent(options, adapters = {}) {
        if (String(env.NODE_ENV ?? process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
            throw fail('hotelbeds_content_sync_production_forbidden', 403);
        }
        const requestedPlan = contentImportPlan(options, env);
        if (requestedPlan.from !== 1) {
            throw fail('hotelbeds_content_sync_partial_bootstrap_forbidden', 400);
        }
        if (typeof adapters.fetchPage !== 'function') {
            throw fail('hotelbeds_content_import_adapter_required', 400);
        }
        const scope = scopeFrom(requestedPlan, env);
        await ensureReady();

        const acquiredAt = new Date(now());
        if (!validDate(acquiredAt)) throw fail('hotelbeds_content_sync_clock_invalid', 503);
        const leaseId = crypto.randomUUID();
        const lease = await acquireLease(scope, leaseId, acquiredAt);
        lease.acquiredAt = acquiredAt;
        let primaryError = null;

        try {
            const stateQuery = StateModel.findById(scope.cursorId);
            const existing = await queryExec(stateQuery?.lean ? stateQuery.lean() : stateQuery);
            if (existing && (existing.accountFingerprint !== scope.accountFingerprint
                || existing.environment !== scope.environment
                || existing.language !== scope.language
                || existing.resourceVersion !== scope.resourceVersion)) {
                throw fail('hotelbeds_content_sync_scope_mismatch', 409);
            }

            const initialized = existing?.initialized === true
                && JSON.stringify(existing.hotelCodes) === JSON.stringify(scope.hotelCodes);
            if (!initialized && requestedPlan.lastUpdateTime) {
                throw fail('hotelbeds_content_sync_bootstrap_required', 409);
            }

            let effectiveLastUpdateTime;
            if (initialized) {
                if (!validDateString(existing.lastSuccessfulDate)) {
                    throw fail('hotelbeds_content_sync_checkpoint_invalid', 503);
                }
                effectiveLastUpdateTime = subtractUtcDays(existing.lastSuccessfulDate, OVERLAP_DAYS);
                if (requestedPlan.lastUpdateTime && requestedPlan.lastUpdateTime < effectiveLastUpdateTime) {
                    effectiveLastUpdateTime = requestedPlan.lastUpdateTime;
                }
            }

            const importOptions = {
                hotelCodes: requestedPlan.hotelCodes,
                language: requestedPlan.language,
                from: requestedPlan.from,
                pageSize: requestedPlan.pageSize,
                pageLimit: requestedPlan.pageLimit,
                ...(effectiveLastUpdateTime ? { lastUpdateTime: effectiveLastUpdateTime } : {})
            };
            const result = await importer.importContent(importOptions, {
                ...adapters,
                commit: writeContent => commitRun({ scope, lease, initialized, writeContent })
            });
            return {
                ...result,
                bootstrap: !initialized,
                lastUpdateTime: effectiveLastUpdateTime || null,
                scopeKey: scope.scopeKey
            };
        } catch (error) {
            primaryError = error;
            throw error;
        } finally {
            try {
                await releaseLease(lease);
            } catch (cleanupError) {
                if (!primaryError) throw fail('hotelbeds_content_sync_cleanup_failed', 500, cleanupError);
            }
        }
    }

    return { syncContent, ensureReady };
}

module.exports = {
    RESOURCE_VERSION,
    WRITER_LEASE_ID,
    LEASE_DURATION_MS,
    OVERLAP_DAYS,
    scopeFrom,
    subtractUtcDays,
    createHotelbedsContentSyncService
};