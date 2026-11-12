const { test } = require('node:test');
const assert = require('node:assert/strict');
const { staticSyncPlan, createStaticSyncCoordinator, createMongoStaticSyncStore, LEASE_MS } = require('./services/ratehawkStaticSyncCoordinator');

const environment = {
    RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', RATEHAWK_KEY_ID: 'fixture-account',
    RATEHAWK_API_KEY: 'fixture-only', MONGO_URI: 'mongodb://localhost/remal_staging',
    PAYMENT_SANDBOX_DATABASE: 'remal_staging', RATEHAWK_FILTERS_JSON: '{"country":[201]}',
    RATEHAWK_REGION_DUMP_HOSTS: 'downloads.example.com'
};

function memoryStore() {
    const states = new Map();
    let lease, fence = 0;
    const guard = (actor, at) => {
        if (!lease || actor.leaseId !== lease.leaseId || actor.fencingToken !== lease.fencingToken
            || lease.until <= at.getTime()) throw new Error('static_sync_lease_lost');
    };
    return {
        states,
        ensureReady: async () => {},
        acquire: async (plan, at) => {
            if (lease && lease.until > at.getTime()) throw new Error('static_sync_already_running');
            lease = { leaseId: String(++fence), fencingToken: fence, scopeKey: plan.scopeKey, until: at.getTime() + LEASE_MS };
            return { ...lease };
        },
        renew: async (actor, at) => { guard(actor, at); lease.until = at.getTime() + LEASE_MS; },
        readState: async kind => states.get(kind),
        writeBatch: async (actor, Model, operations, at) => { guard(actor, at); return Model.bulkWrite(operations); },
        checkpoint: async (actor, state, at) => { guard(actor, at); states.set(state.kind, state); },
        release: async actor => { if (lease?.leaseId === actor.leaseId) lease = null; }
    };
}

test('unattended plans require exact Sandbox account, isolated database and explicit bounded country scope', () => {
    const plan = staticSyncPlan('content', environment);
    assert.deepEqual(plan.filters, { country: [201] });
    assert.equal(plan.maxHotels, 500);
    assert.equal(plan.scopeKey.length, 64);
    for (const updates of [
        { RATEHAWK_BASE_URL: 'https://api.ratehawk.com' },
        { RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com:444' },
        { MONGO_URI: 'mongodb://localhost/production' },
        { RATEHAWK_FILTERS_JSON: '{}' },
        { RATEHAWK_FILTERS_JSON: '{"country":[201],"updated_since":"2026-01-01 00:00:00"}' },
        { RATEHAWK_STATIC_SYNC_MAX_HOTELS: '5001' }
    ]) assert.throws(() => staticSyncPlan('content', { ...environment, ...updates }));
    assert.notEqual(plan.scopeKey, staticSyncPlan('content', { ...environment, RATEHAWK_KEY_ID: 'other-account' }).scopeKey);
    assert.equal(staticSyncPlan('regions', { ...environment, RATEHAWK_FILTERS_JSON: undefined }).kind, 'regions');
});

test('successful cursor anchors to run start and the next run overlaps the prior minute', async () => {
    let clock = Date.parse('2026-11-12T10:00:00Z');
    const store = memoryStore(), plan = staticSyncPlan('content', environment);
    const coordinator = createStaticSyncCoordinator({ store, now: () => new Date(clock) });
    await coordinator.run(plan, async context => {
        assert.equal(context.updatedSince, undefined);
        clock += 20000;
        return { content: 1 };
    });
    assert.equal(store.states.get('content').cursor.toISOString(), '2026-11-12T10:00:00.000Z');
    await coordinator.run(plan, async context => {
        assert.equal(context.updatedSince, '2026-11-12 09:59:00');
        return { content: 0 };
    });
});

test('a partial import failure preserves the old cursor so a retry replays its update window', async () => {
    const store = memoryStore(), plan = staticSyncPlan('content', environment);
    const coordinator = createStaticSyncCoordinator({ store, now: () => new Date('2026-11-12T10:00:00Z') });
    let writes = 0;
    const Model = { bulkWrite: async () => { writes++; return { acknowledged: true }; } };
    await assert.rejects(coordinator.run(plan, async context => {
        await context.writeBatch(Model, [{ updateOne: {} }]);
        throw new Error('later chunk failed');
    }), /later chunk failed/);
    assert.equal(writes, 1);
    assert.equal(store.states.size, 0);
    await coordinator.run(plan, async context => { assert.equal(context.updatedSince, undefined); return {}; });
});

test('an overlapping writer is rejected before it can fetch or import content', async () => {
    const store = memoryStore(), plan = staticSyncPlan('content', environment);
    const coordinator = createStaticSyncCoordinator({ store });
    let resume, started;
    const ready = new Promise(resolve => { started = resolve; });
    const first = coordinator.run(plan, async () => { started(); await new Promise(resolve => { resume = resolve; }); return {}; });
    await ready;
    await assert.rejects(coordinator.run(plan, () => { throw new Error('unexpected work'); }), /already_running/);
    resume(); await first;
});

test('a crashed or expired writer cannot write or advance a cursor after lease takeover', async () => {
    let clock = Date.parse('2026-11-12T10:00:00Z');
    const store = memoryStore(), plan = staticSyncPlan('content', environment);
    const coordinator = createStaticSyncCoordinator({ store, now: () => new Date(clock) });
    let resume, started, staleWrites = 0;
    const ready = new Promise(resolve => { started = resolve; });
    const first = coordinator.run(plan, async context => {
        started(); await new Promise(resolve => { resume = resolve; });
        await context.writeBatch({ bulkWrite: async () => { staleWrites++; } }, [{}]);
        return {};
    });
    const rejected = assert.rejects(first, /lease_lost/);
    await ready;
    clock += LEASE_MS + 1;
    await coordinator.run(plan, async () => ({ content: 2 }));
    resume(); await rejected;
    assert.equal(staleWrites, 0);
    assert.equal(store.states.get('content').stats.content, 2);
});

test('changing the configured import scope requires deliberate cursor reset instead of silent bootstrap', async () => {
    const store = memoryStore(), coordinator = createStaticSyncCoordinator({ store });
    await coordinator.run(staticSyncPlan('content', environment), async () => ({}));
    const changed = staticSyncPlan('content', { ...environment, RATEHAWK_FILTERS_JSON: '{"country":[59]}' });
    await assert.rejects(coordinator.run(changed, () => { throw new Error('unexpected work'); }), /scope_changed/);
});

test('a future cursor or a failed checkpoint cannot silently skip updates', async () => {
    const store = memoryStore(), plan = staticSyncPlan('content', environment);
    const coordinator = createStaticSyncCoordinator({ store, now: () => new Date('2026-11-12T10:00:00Z') });
    store.states.set('content', { scopeKey: plan.scopeKey, cursor: new Date('2026-11-13T10:00:00Z') });
    await assert.rejects(coordinator.run(plan, () => { throw new Error('unexpected work'); }), /cursor_invalid/);
    store.states.clear();
    store.checkpoint = async () => { throw new Error('checkpoint unavailable'); };
    await assert.rejects(coordinator.run(plan, async () => ({ content: 1 })), /checkpoint unavailable/);
    assert.equal(store.states.size, 0);
});

test('Mongo batch writes and checkpoints renew the fencing lease inside the same transaction', async () => {
    let active = false, matched = 1, imported = 0, checkpoints = 0, ended = 0;
    const session = { withTransaction: async work => { active = true; try { await work(); } finally { active = false; } },
        endSession: async () => { ended++; } };
    const Lease = { updateOne: async (criteria, update, options) => {
        assert.equal(active, true); assert.equal(options.session, session);
        assert.equal(criteria.leaseId, 'fixture-lease'); assert.equal(criteria.fencingToken, 7);
        assert.equal(criteria.scopeKey, 'fixture-scope'); assert.ok(criteria.leaseUntil.$gt instanceof Date);
        return { matchedCount: matched };
    } };
    const State = { updateOne: async (criteria, update, options) => {
        assert.equal(active, true); assert.equal(options.session, session); checkpoints++;
        return { acknowledged: true };
    } };
    const connection = { model: name => name.endsWith('State') ? State : Lease, startSession: async () => session };
    const store = createMongoStaticSyncStore(connection);
    const lease = { leaseId: 'fixture-lease', fencingToken: 7, scopeKey: 'fixture-scope' };
    const Model = { bulkWrite: async (operations, options) => {
        assert.equal(active, true); assert.equal(options.session, session); imported++;
        return { acknowledged: true };
    } };
    await store.writeBatch(lease, Model, [{}], new Date());
    await store.checkpoint(lease, { kind: 'content' }, new Date());
    matched = 0;
    await assert.rejects(store.writeBatch(lease, Model, [{}], new Date()), /lease_lost/);
    assert.equal(imported, 1); assert.equal(checkpoints, 1); assert.equal(ended, 3);
});

test('content job validates metadata, caps IDs, and refuses missing content without checkpointing', async context => {
    context.mock.method(require('dotenv'), 'config', () => ({}));
    const { syncContentJob } = require('./services/ratehawkStaticSyncJobs');
    const plan = staticSyncPlan('content', environment), events = [];
    const jobContext = { updatedSince: '2026-11-12 09:59:00', assertActive() {},
        writeBatch: async (Model, operations) => { events.push('write'); assert.equal(operations.length, 1); return { upsertedCount: 1 }; } };
    let ids = [123], content = [{ hid: 123, id: 'fixture', name: 'Fixture Hotel' }];
    const client = { normalizeHotelIdFilters: filters => filters,
        fetchHotelIdsByFilter: async filters => { events.push('IDs'); assert.equal(filters.updated_since, jobContext.updatedSince); return ids; },
        hotelContentByIds: async () => { events.push('content'); return { ok: true, data: content }; } };
    const service = { getFilterValues: async () => { events.push('metadata'); return { filters: { country: [{ value: '201' }] } }; } };
    const job = () => syncContentJob({ plan, context: jobContext, HotelModel: {}, client, service });
    assert.equal((await job()).upserted, 1);
    assert.deepEqual(events, ['metadata', 'IDs', 'content', 'write']);
    ids = Array.from({ length: 501 }, (_, index) => index + 1); events.length = 0;
    await assert.rejects(job(), /hotel_limit_exceeded/);
    assert.deepEqual(events, ['metadata', 'IDs']);
    ids = [123]; content = []; events.length = 0;
    await assert.rejects(job(), /content_identity_mismatch/);
    assert.deepEqual(events, ['metadata', 'IDs', 'content']);
    for (const malformed of [null, true, '', [], 1.5, '01', '1e2', ' 123 ']) {
        ids = [malformed]; events.length = 0;
        await assert.rejects(job(), /hotel_ids_invalid/);
        assert.deepEqual(events, ['metadata', 'IDs']);
    }
    ids = [123, '123', 123]; content = [{ hid: 123, id: 'fixture', name: 'Fixture Hotel' }];
    assert.equal((await job()).ids, 1);
});

test('region job uses an approved download policy, owned connection and strict raw region IDs', async context => {
    context.mock.method(require('dotenv'), 'config', () => ({}));
    const { syncRegionsJob } = require('./services/ratehawkStaticSyncJobs');
    const plan = staticSyncPlan('regions', environment);
    const jobContext = { runId: 'fixture-lease', assertActive() {}, writeBatch: async () => ({ acknowledged: true }) };
    await syncRegionsJob({ plan, context: jobContext, RegionModel: {},
        client: { getRegionDumpUrl: async () => 'https://downloads.example.com/region.zst?signature=fixture' },
        dump: async options => {
            assert.equal(options.manageConnection, false);
            assert.deepEqual(options.downloadPolicy.allowedHosts, ['downloads.example.com']);
            assert.equal(await options.getUrl(), 'https://downloads.example.com/region.zst?signature=fixture');
            for (const value of [null, true, '', [], 1.5]) assert.throws(() => options.operationFactory({ id: value }), /region_id_invalid/);
            assert.equal(options.operationFactory({ id: '123' }).updateOne.filter.id, 123);
            return { read: 1, skipped: 0 };
        } });
    await assert.rejects(syncRegionsJob({ plan, context: jobContext, RegionModel: {},
        client: { getRegionDumpUrl: async () => 'https://unapproved.example.com/region.zst' },
        dump: async options => { await options.getUrl(); return { read: 1, skipped: 0 }; }
    }), /destination_forbidden/);
});
