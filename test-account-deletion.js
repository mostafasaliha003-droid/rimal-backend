const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const Model = require('./models/AccountDeletionRequest');
const { createAccountDeletionService, WRITE_CONCERN } = require('./services/accountDeletionService');
const { createAccountDeletionRouter, createAdminAccountDeletionRouter } = require('./services/accountDeletionRoutes');
const { createSessionAuthMiddleware } = require('./services/sessionAuthMiddleware');
const { createMembershipAccessGate } = require('./services/membershipAccessGate');

const identity = { subject: 'owner-a', email: 'owner-a@example.test', role: 'user', realm: 'realm-a' };
const at = new Date('2026-11-17T10:00:00.000Z');
const reference = 'del_' + '1'.repeat(32);
function memoryModel() {
    const rows = new Map(), calls = [];
    const key = filter => JSON.stringify([filter.ownerSubject, filter.realm]);
    const state = { rows, calls, database: { readyState: 1 }, failInit: false, failRead: false, failWrite: false };
    function query(run) {
        let offset = 0, limit = Infinity;
        return { select() { return this; }, maxTimeMS(value) { assert.equal(value, 10000); return this; },
            sort(value) { assert.deepEqual(value, { requestedAt: -1, reference: 1 }); return this; },
            skip(value) { offset = value; return this; }, limit(value) { limit = value; return this; },
            async lean() { if (state.failRead) throw new Error('private database failure');
                const value = run(); return Array.isArray(value) ? value.slice(offset, offset + limit) : value; } };
    }
    state.Model = {
        async init() { calls.push(['init']); if (state.failInit) throw new Error('index unavailable'); },
        findOne(filter) { calls.push(['findOne', filter]); return query(() => rows.get(key(filter)) || null); },
        find(filter) { calls.push(['find', filter]); return query(() => [...rows.values()].filter(row => row.realm === filter.realm)); },
        async create(documents, options) {
            calls.push(['create', documents, options]);
            if (state.failWrite) throw new Error('private write failure');
            const row = documents[0];
            if (rows.has(key(row))) throw Object.assign(new Error('duplicate'), { code: 11000 });
            rows.set(key(row), row); return [row];
        }
    };
    return state;
}
function serviceFor(state, overrides = {}) {
    return createAccountDeletionService({ Model: state.Model, database: state.database,
        realm: 'realm-a', now: () => at, createReference: () => reference, ...overrides });
}

test('schema is minimal intake-only, with unique owner/realm and no contact/password/TTL fields', async () => {
    const document = new Model({ reference, ownerSubject: identity.subject, realm: identity.realm, status: 'requested', requestedAt: at });
    await document.validate();
    assert.throws(() => new Model({ reference, ownerSubject: identity.subject, realm: identity.realm,
        status: 'requested', requestedAt: at, password: 'never-store' }), /strict mode/);
    await assert.rejects(new Model({ reference, ownerSubject: identity.subject, realm: identity.realm, status: 'completed', requestedAt: at }).validate(), /not a valid enum/);
    assert.ok(Model.schema.indexes().some(([keys, options]) => keys.ownerSubject === 1 && keys.realm === 1 && options.unique));
    assert.equal(Model.schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined), false);
    assert.deepEqual(Object.keys(document.toObject()).sort(), ['_id', 'reference', 'ownerSubject', 'realm', 'status', 'requestedAt'].sort());
});

test('durable intake survives service replacement, preserves reference/time, and writes only minimal fields with majority concern', async () => {
    const state = memoryModel(), service = serviceFor(state);
    assert.equal(await service.get(identity), null);
    const first = await service.request(identity);
    const repeated = await serviceFor(state, { now: () => new Date('2030-01-01'), createReference: () => 'del_' + '2'.repeat(32) }).request(identity);
    assert.deepEqual(first, { reference, status: 'requested', requested_at: at.toISOString() });
    assert.deepEqual(first, repeated);
    const writes = state.calls.filter(call => call[0] === 'create');
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(writes[0][1][0]).sort(), ['ownerSubject', 'realm', 'reference', 'status', 'requestedAt'].sort());
    assert.deepEqual(writes[0][2], { ordered: true, writeConcern: WRITE_CONCERN });
    assert.equal(JSON.stringify(state.calls).includes(identity.email), false);
});

test('concurrent intake resolves unique-index duplicate to the same owned request', async () => {
    const state = memoryModel(), service = serviceFor(state);
    const [left, right] = await Promise.all([service.request(identity), service.request(identity)]);
    assert.deepEqual(left, right);
    assert.equal(state.rows.size, 1);
});

test('owner and realm isolation never returns another user request', async () => {
    const state = memoryModel(), service = serviceFor(state);
    await service.request(identity);
    assert.equal(await service.get({ ...identity, subject: 'owner-b' }), null);
    for (const value of [{ ...identity, realm: 'realm-b' }, { ...identity, role: 'admin' }, { ...identity, subject: '' }]) {
        await assert.rejects(service.get(value), error => error.httpStatus === 401);
    }
    assert.equal(state.calls.some(call => call[1]?.realm === 'realm-b'), false);
});

test('database/index/read/write failures fail closed, and failed index preparation can recover', async () => {
    const state = memoryModel(), service = serviceFor(state);
    state.database.readyState = 0;
    await assert.rejects(service.request(identity), /account_deletion_unavailable/);
    assert.equal(state.calls.length, 0);
    state.database.readyState = 1; state.failInit = true;
    await assert.rejects(service.request(identity), /account_deletion_unavailable/);
    state.failInit = false; state.failRead = true;
    await assert.rejects(service.request(identity), /account_deletion_unavailable/);
    state.failRead = false; state.failWrite = true;
    await assert.rejects(service.request(identity), /account_deletion_unavailable/);
    assert.equal(state.rows.size, 0);
    state.failWrite = false;
    assert.equal((await service.request(identity)).status, 'requested');
});

test('invalid clock/reference, incomplete creates and unrelated duplicate keys never produce a receipt', async () => {
    for (const overrides of [{ now: () => new Date(NaN) }, { createReference: () => 'predictable' }]) {
        const state = memoryModel();
        await assert.rejects(serviceFor(state, overrides).request(identity), /account_deletion_unavailable/);
        assert.equal(state.rows.size, 0);
    }
    for (const create of [async () => [], async () => { throw Object.assign(new Error('other reference collision'), { code: 11000 }); }]) {
        const state = memoryModel(); state.Model.create = create;
        await assert.rejects(serviceFor(state).request(identity), /account_deletion_unavailable/);
    }
});

test('a corrupted completed state is rejected rather than represented as fulfilled deletion', async () => {
    const state = memoryModel(), service = serviceFor(state);
    await service.request(identity);
    [...state.rows.values()][0].status = 'completed';
    await assert.rejects(service.get(identity), /account_deletion_unavailable/);
    await assert.rejects(service.request(identity), /account_deletion_unavailable/);
});

test('admin queue is bounded, realm-scoped and exposes no duplicated contact fields', async () => {
    const state = memoryModel(), service = serviceFor(state);
    for (let index = 0; index < 3; index++) state.rows.set(String(index), { reference: 'del_' + String(index).repeat(32),
        ownerSubject: `owner-${index}`, realm: 'realm-a', requestedAt: at, status: 'requested', email: 'must-not-return@example.test' });
    state.rows.set('other', { reference, ownerSubject: 'other', realm: 'realm-b', requestedAt: at, status: 'requested' });
    const result = await service.list({ realm: 'realm-a', limit: 2, offset: 0 });
    assert.equal(result.requests.length, 2);
    assert.deepEqual(result.pagination, { limit: 2, offset: 0, has_more: true });
    assert.equal(JSON.stringify(result).includes('must-not-return'), false);
    assert.deepEqual(Object.keys(result.requests[0]).sort(), ['reference', 'ownerSubject', 'status', 'requested_at'].sort());
    assert.equal((await service.list({ realm: 'realm-a', limit: 2, offset: 2 })).requests.length, 1);
    await assert.rejects(service.list({ realm: 'realm-b' }), error => error.httpStatus === 401);
    for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 10001 }, { offset: '1' }]) {
        await assert.rejects(service.list({ realm: 'realm-a', ...input }), error => error.httpStatus === 400);
    }
    state.database.readyState = 0;
    await assert.rejects(service.list({ realm: 'realm-a' }), /account_deletion_unavailable/);
});

async function fixture(context, options = {}) {
    const state = memoryModel(), service = serviceFor(state);
    const token = 'a'.repeat(64), adminToken = 'b'.repeat(64), otherToken = 'c'.repeat(64);
    const user = { _id: identity.subject, email: identity.email, password: bcrypt.hashSync(' exact password ', 4),
        name: 'Protected Name', points: 500, savedCards: [{ cardToken: 'protected-token' }] };
    const protectedRecords = { user, bookings: [{ status: 'active', ownerSubject: identity.subject }],
        documents: ['encrypted-document'], payments: ['pending-payment'], support: ['private-message'] };
    const preserved = JSON.stringify(protectedRecords);
    let active = true, resolves = 0, limiterCalls = 0, passwordCalls = 0, userReads = 0;
    let membershipMode = options.membershipMode, membershipLookups = 0;
    const sessions = { async resolve(value, { realm = 'realm-a' } = {}) {
        resolves++;
        if (!active || realm !== 'realm-a') return null;
        if (value === token) return options.finalIdentity && resolves > 1 ? options.finalIdentity : identity;
        if (value === adminToken) return { ...identity, subject: 'admin', role: 'admin' };
        // Actual AuthSessionService never resolves another realm's token into
        // the active realm; the account route must not see that identity.
        if (value === otherToken) return null;
        return null;
    }, revoke() { throw new Error('Intake must never revoke a session'); } };
    const auth = createSessionAuthMiddleware({ sessions, realm: 'realm-a' });
    const UserModel = { findOne(filter) {
        userReads++; assert.deepEqual(filter, { _id: identity.subject, email: identity.email });
        return { select() { return this; }, maxTimeMS() { return this; }, async lean() {
            if (options.userReadFailure) throw new Error('private-user-database-error');
            return options.missingUser ? null : user;
        } };
    } };
    const app = express(); app.use(express.json({ limit: '4kb', strict: false }));
    if (membershipMode) app.use(createMembershipAccessGate({ sessions, service: {
        enabled: () => true,
        async application() {
            membershipLookups++;
            if (membershipMode === 'unavailable') throw new Error('private membership database failure');
            return { row: { status: membershipMode } };
        }
    } }));
    const router = createAccountDeletionRouter({ UserModel, sessions, auth, service,
        comparePassword: async (password, digest) => {
            passwordCalls++; if (options.revokeDuringPassword) active = false;
            if (options.passwordFailure) throw new Error('private-password-error');
            return bcrypt.compare(password, digest);
        }, authLimiter: (_req, _res, next) => { limiterCalls++; next(); } });
    app.use('/api/auth/account-deletion', router);
    app.use('/api/admin/account-deletion-requests', createAdminAccountDeletionRouter({ service, auth }));
    const server = http.createServer(app);
    context.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method = 'GET', body, suffix = '', useToken = token, admin = false) => {
        const response = await fetch(`${base}/api/${admin ? 'admin/account-deletion-requests' : 'auth/account-deletion'}${suffix}`, {
            method, headers: { ...(useToken ? { Authorization: `Bearer ${useToken}` } : {}), 'Content-Type': 'application/json' },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { response, body: await response.json() };
    };
    return { state, service, call, token, adminToken, otherToken, protectedRecords,
        membershipLookups: () => membershipLookups, setMembershipMode: value => { membershipMode = value; },
        assertPreserved() { assert.equal(JSON.stringify(protectedRecords), preserved); assert.equal(active, true); },
        counts: () => ({ resolves, limiterCalls, passwordCalls, userReads }) };
}
const consent = { password: ' exact password ', confirm_account_deletion: true };

test('loopback intake/status are authenticated, no-store, idempotent and preserve all account/booking/session data', async context => {
    const f = await fixture(context);
    const empty = await f.call();
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.body, { success: true, request: null, data_deleted: false });
    const submitted = await f.call('POST', consent);
    assert.equal(submitted.response.status, 200);
    assert.deepEqual(submitted.body, { success: true, request: { reference, status: 'requested', requested_at: at.toISOString() }, data_deleted: false });
    assert.equal(submitted.response.headers.get('cache-control'), 'no-store');
    assert.match(submitted.response.headers.get('vary'), /Authorization/);
    assert.deepEqual((await f.call('POST', consent)).body, submitted.body);
    assert.deepEqual((await f.call()).body, submitted.body);
    f.assertPreserved();
    assert.deepEqual(f.counts(), { resolves: 6, limiterCalls: 2, passwordCalls: 2, userReads: 2 });
    assert.equal(/email|password|token|Protected Name|completed/.test(JSON.stringify(submitted.body)), false);
});

test('customer and admin roles/realms are separated, and unauthenticated requests never persist', async context => {
    const f = await fixture(context);
    for (const token of [null, 'd'.repeat(64), f.adminToken, f.otherToken]) {
        assert.equal((await f.call('GET', undefined, '', token)).response.status, 401);
        assert.equal((await f.call('POST', consent, '', token)).response.status, 401);
    }
    assert.equal((await f.call('GET', undefined, '', f.token, true)).response.status, 401);
    assert.equal(f.state.rows.size, 0);
    assert.equal(f.counts().passwordCalls, 0);
});

test('strict request body and query selectors are rejected before password lookup', async context => {
    const f = await fixture(context);
    for (const body of [null, [], 'text', {}, { ...consent, email: 'other@example.test' }, { ...consent, ownerSubject: 'other' },
        { ...consent, realm: 'realm-b' }, { ...consent, confirm_account_deletion: false },
        { ...consent, password: '' }, { ...consent, password: 'x'.repeat(257) }]) {
        assert.equal((await f.call('POST', body)).response.status, 400);
    }
    for (const suffix of ['?email=other@example.test', '?ownerSubject=other', '?realm=realm-b', '?reference=other']) {
        assert.equal((await f.call('GET', undefined, suffix)).response.status, 400);
        assert.equal((await f.call('POST', consent, suffix)).response.status, 400);
    }
    assert.equal(f.counts().userReads, 0);
    assert.equal(f.state.rows.size, 0);
});

test('wrong password returns 400 without invalidating the valid session or creating intake', async context => {
    const f = await fixture(context);
    const result = await f.call('POST', { ...consent, password: 'wrong password' });
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, { success: false, error: 'reauthentication_failed' });
    assert.equal((await f.call()).response.status, 200);
    assert.equal(f.state.rows.size, 0);
    f.assertPreserved();
});

test('session revocation during asynchronous password verification prevents persistence', async context => {
    const f = await fixture(context, { revokeDuringPassword: true });
    const result = await f.call('POST', consent);
    assert.equal(result.response.status, 401);
    assert.deepEqual(result.body, { success: false, error: 'unauthorized' });
    assert.equal(f.state.rows.size, 0);
});

test('final session must still match original owner/email/realm/user role', async context => {
    for (const change of [{ subject: 'owner-b' }, { email: 'other@example.test' }, { realm: 'realm-b' }, { role: 'admin' }]) {
        const f = await fixture(context, { finalIdentity: { ...identity, ...change } });
        assert.equal((await f.call('POST', consent)).response.status, 401);
        assert.equal(f.state.rows.size, 0);
    }
});

test('missing account, unavailable password/database, and failed durable write never claim acceptance', async context => {
    for (const options of [{ missingUser: true }, { passwordFailure: true }, { userReadFailure: true }]) {
        const f = await fixture(context, options);
        const result = await f.call('POST', consent);
        assert.equal(result.response.status, options.missingUser ? 400 : 503);
        assert.equal(f.state.rows.size, 0);
        assert.equal(JSON.stringify(result.body).includes('private-'), false);
    }
    const f = await fixture(context); f.state.failWrite = true;
    assert.deepEqual((await f.call('POST', consent)).body, { success: false, error: 'account_deletion_unavailable' });
    assert.equal(f.state.rows.size, 0);
    f.assertPreserved();
});

test('loopback admin queue is read-only, derives realm and rejects selectors/pagination abuse', async context => {
    const f = await fixture(context);
    await f.call('POST', consent);
    const result = await f.call('GET', undefined, '?limit=1&offset=0', f.adminToken, true);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { success: true, requests: [{ reference, ownerSubject: identity.subject,
        status: 'requested', requested_at: at.toISOString() }], pagination: { limit: 1, offset: 0, has_more: false } });
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    for (const suffix of ['?realm=realm-b', '?ownerSubject=other', '?limit=101', '?limit=01', '?offset=10001', '?offset=-1', '?limit=1&limit=2']) {
        assert.equal((await f.call('GET', undefined, suffix, f.adminToken, true)).response.status, 400);
    }
    f.state.database.readyState = 0;
    assert.equal((await f.call('GET', undefined, '', f.adminToken, true)).response.status, 503);
    f.assertPreserved();
});

test('actual membership gate exempts authenticated account intake even for pending/suspended/unavailable membership, without bypassing session ownership', async context => {
    for (const membershipMode of ['pending', 'suspended', 'unavailable']) {
        const f = await fixture(context, { membershipMode });
        const empty = await f.call();
        assert.equal(empty.response.status, 200);
        assert.deepEqual(empty.body, { success: true, request: null, data_deleted: false });
        const submitted = await f.call('POST', consent);
        assert.equal(submitted.response.status, 200);
        assert.equal(submitted.body.request.status, 'requested');
        assert.deepEqual((await f.call()).body, submitted.body);
        assert.equal((await f.call('GET', undefined, '', null)).response.status, 401);
        assert.equal((await f.call('POST', consent, '', null)).response.status, 401);
        assert.equal((await f.call('GET', undefined, '?ownerSubject=other')).response.status, 400);
        assert.equal(f.membershipLookups(), 0, 'real /api/auth exemption must never consult membership application');
        assert.equal(f.state.rows.size, 1);
        assert.equal([...f.state.rows.values()][0].ownerSubject, identity.subject);
        assert.equal([...f.state.rows.values()][0].realm, identity.realm);
        // An administrator bypasses membership, but still passes the real admin
        // session guard. An approved ordinary user reaches that guard and fails401.
        assert.equal((await f.call('GET', undefined, '', f.adminToken, true)).response.status, 200);
        f.setMembershipMode('approved');
        assert.equal((await f.call('GET', undefined, '', f.token, true)).response.status, 401);
        assert.equal(f.membershipLookups(), 1);
        f.assertPreserved();
    }
});
