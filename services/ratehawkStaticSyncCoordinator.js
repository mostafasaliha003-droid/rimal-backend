const crypto = require('node:crypto');
const { sandboxDatabaseConfigured } = require('./sandboxDatabase');

const LEASE_MS = 10 * 60 * 1000;
const OVERLAP_MS = 60 * 1000;
const WRITER_ID = 'ratehawk-static-writer-v1';
const WRITE_CONCERN = { w: 'majority', j: true, wtimeout: 10000 };
function fail(code) { return Object.assign(new Error(code), { code }); }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function canonical(value) {
    if (Array.isArray(value)) return [...new Set(value)].sort((a, b) => String(a).localeCompare(String(b)));
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
}

function staticSyncPlan(kind, env = process.env) {
    if (!['content', 'regions'].includes(kind)) throw fail('static_sync_kind_invalid');
    let url;
    try { url = new URL(env.RATEHAWK_BASE_URL); } catch { throw fail('static_sync_sandbox_required'); }
    if (url.protocol !== 'https:' || url.hostname !== 'api-sandbox.ratehawk.com' || url.port
        || url.username || url.password || url.search || url.hash
        || !['/', '/api/b2b/v3', '/api/b2b/v3/'].includes(url.pathname)
        || !env.RATEHAWK_KEY_ID || !env.RATEHAWK_API_KEY || !sandboxDatabaseConfigured(env)) {
        throw fail('static_sync_sandbox_required');
    }
    let filters = {};
    if (kind === 'content') {
        try { filters = JSON.parse(env.RATEHAWK_FILTERS_JSON || '{}'); } catch { throw fail('static_sync_filters_invalid'); }
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)
            || !Array.isArray(filters.country) || !filters.country.length || filters.updated_since !== undefined) {
            throw fail('static_sync_explicit_country_scope_required');
        }
        const allowed = new Set(['country', 'star_rating', 'kind', 'serp_filter', 'supplier_type', 'preferable', 'top']);
        if (Object.keys(filters).some(key => !allowed.has(key))) throw fail('static_sync_filters_invalid');
        if (filters.country.some(value => ![59, 189, 201].includes(value))) throw fail('static_sync_filters_invalid');
        filters = canonical(Object.fromEntries(Object.entries(filters).map(([key, value]) =>
            [key, Array.isArray(value) ? canonical(value) : value])));
    }
    const maxHotels = Number(env.RATEHAWK_STATIC_SYNC_MAX_HOTELS || 500);
    if (!Number.isSafeInteger(maxHotels) || maxHotels < 1 || maxHotels > 5000) throw fail('static_sync_hotel_limit_invalid');
    const regionDumpHosts = kind === 'regions'
        ? require('./ratehawkDumpDownloadPolicy').approvedHosts(String(env.RATEHAWK_REGION_DUMP_HOSTS || '').split(',').filter(Boolean))
        : undefined;
    const accountFingerprint = hash([url.origin, env.RATEHAWK_KEY_ID]);
    const scope = { kind, accountFingerprint, language: 'en', filters, resourceVersion: 'static-v1' };
    return { ...scope, scopeKey: hash(scope), maxHotels, ...(regionDumpHosts ? { regionDumpHosts } : {}) };
}

function createStaticSyncCoordinator({ store, now = () => new Date(), heartbeatMs = 30000 } = {}) {
    if (!store) throw new TypeError('static_sync_store_required');
    async function run(plan, work) {
        await store.ensureReady();
        const startedAt = new Date(now());
        if (!Number.isFinite(startedAt.getTime())) throw fail('static_sync_clock_invalid');
        const lease = await store.acquire(plan, startedAt);
        let heartbeatError, heartbeatPending = null;
        const heartbeat = async () => {
            if (heartbeatPending || heartbeatError) return;
            heartbeatPending = store.renew(lease, new Date(now()));
            try { await heartbeatPending; } catch (error) { heartbeatError = error; }
            finally { heartbeatPending = null; }
        };
        const timer = setInterval(heartbeat, heartbeatMs);
        timer.unref?.();
        const assertActive = () => { if (heartbeatError) throw heartbeatError; };
        let primaryError;
        try {
            const state = await store.readState(plan.kind);
            if (state && state.scopeKey !== plan.scopeKey) throw fail('static_sync_scope_changed');
            const previous = state?.cursor ? new Date(state.cursor) : null;
            if (previous && (!Number.isFinite(previous.getTime()) || previous > startedAt)) throw fail('static_sync_cursor_invalid');
            const updatedSince = previous
                ? new Date(previous.getTime() - OVERLAP_MS).toISOString().slice(0, 19).replace('T', ' ')
                : undefined;
            const writeBatch = async (Model, operations) => {
                assertActive();
                return store.writeBatch(lease, Model, operations, new Date(now()));
            };
            const stats = await work({ updatedSince, writeBatch, assertActive, runId: lease.leaseId });
            assertActive();
            await store.checkpoint(lease, { kind: plan.kind, scopeKey: plan.scopeKey,
                accountFingerprint: plan.accountFingerprint, filters: plan.filters,
                cursor: startedAt, completedAt: new Date(now()), stats }, new Date(now()));
            return { ...stats, cursor: startedAt.toISOString(), mode: previous ? 'incremental' : 'bootstrap' };
        } catch (error) {
            primaryError = error;
            throw error;
        } finally {
            clearInterval(timer);
            if (heartbeatPending) await heartbeatPending.catch(() => {});
            try { await store.release(lease); } catch (error) { if (!primaryError) throw error; }
        }
    }
    return { run };
}

function createMongoStaticSyncStore(connection, { now = () => new Date() } = {}) {
    const mongoose = require('mongoose');
    const State = connection.model('RatehawkStaticSyncState', new mongoose.Schema({
        _id: String, scopeKey: String, accountFingerprint: String, filters: mongoose.Schema.Types.Mixed,
        cursor: Date, completedAt: Date, stats: mongoose.Schema.Types.Mixed
    }, { collection: 'ratehawkstaticsyncstates', versionKey: false, bufferCommands: false }));
    const Lease = connection.model('RatehawkStaticSyncLease', new mongoose.Schema({
        _id: String, accountFingerprint: String, scopeKey: String, leaseId: String,
        leaseUntil: Date, fencingToken: Number
    }, { collection: 'ratehawkstaticsyncleases', versionKey: false, bufferCommands: false }));
    let ready;
    function guard(lease, at) {
        return { _id: WRITER_ID, leaseId: lease.leaseId, scopeKey: lease.scopeKey,
            fencingToken: lease.fencingToken, leaseUntil: { $gt: at } };
    }
    async function renew(lease, at, session) {
        const result = await Lease.updateOne(guard(lease, at), {
            $set: { leaseUntil: new Date(at.getTime() + LEASE_MS) }
        }, session ? { session } : { writeConcern: WRITE_CONCERN });
        if (result.matchedCount !== 1) throw fail('static_sync_lease_lost');
    }
    async function fenced(lease, at, write) {
        const session = await connection.startSession();
        let result;
        try {
            await session.withTransaction(async () => {
                const commitAt = new Date(now());
                // Renewing the same lease document in this transaction prevents
                // a stale process from committing after another writer takes over.
                await renew(lease, commitAt, session);
                result = await write(session);
                if (result?.acknowledged === false) throw fail('static_sync_write_unacknowledged');
            }, { writeConcern: WRITE_CONCERN });
            return result;
        } finally { await session.endSession(); }
    }
    return {
        ensureReady() {
            if (!ready) ready = Promise.resolve().then(async () => {
                const hello = await connection.db.admin().command({ hello: 1 });
                if (!(hello.setName && hello.maxWireVersion >= 7)
                    && !(hello.msg === 'isdbgrid' && hello.maxWireVersion >= 8)) throw fail('static_sync_transactions_required');
                await Promise.all([State.init(), Lease.init()]);
            });
            return ready;
        },
        async acquire(plan, at) {
            try {
                const lease = await Lease.findOneAndUpdate({ _id: WRITER_ID,
                    $and: [{ $or: [{ accountFingerprint: plan.accountFingerprint }, { accountFingerprint: { $exists: false } }] },
                        { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: at } }] }]
                }, { $set: { leaseId: crypto.randomUUID(), scopeKey: plan.scopeKey,
                    accountFingerprint: plan.accountFingerprint, leaseUntil: new Date(at.getTime() + LEASE_MS) },
                    $inc: { fencingToken: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: false,
                    writeConcern: WRITE_CONCERN }).lean();
                if (!lease) throw fail('static_sync_already_running');
                return lease;
            } catch (error) {
                if (error.code === 11000 || error.code === 11001) throw fail('static_sync_already_running_or_account_changed');
                throw error;
            }
        },
        renew,
        readState: kind => State.findById(kind).lean(),
        writeBatch: (lease, Model, operations, at) => fenced(lease, at, session =>
            Model.bulkWrite(operations, { ordered: false, session })),
        checkpoint: (lease, state, at) => fenced(lease, at, session => State.updateOne({ _id: state.kind }, {
            $set: { scopeKey: state.scopeKey, accountFingerprint: state.accountFingerprint,
                filters: state.filters, cursor: state.cursor, completedAt: state.completedAt, stats: state.stats }
        }, { upsert: true, session })),
        release: lease => Lease.updateOne({ _id: WRITER_ID, leaseId: lease.leaseId, fencingToken: lease.fencingToken }, {
            $unset: { leaseId: '', scopeKey: '', leaseUntil: '' }
        }, { writeConcern: WRITE_CONCERN })
    };
}

module.exports = { staticSyncPlan, createStaticSyncCoordinator, createMongoStaticSyncStore,
    LEASE_MS, OVERLAP_MS, WRITER_ID };
