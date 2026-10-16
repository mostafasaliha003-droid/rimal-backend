const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketSessionAuth } = require('./services/socketSessionAuth');

const token = 'a'.repeat(64);
const realm = 'socket-fixture-realm';

function socketFor(value) {
    return { handshake: { auth: value }, data: {} };
}

function run(middleware, socket) {
    return new Promise(resolve => middleware(socket, error => resolve(error || null)));
}

test('socket session auth leaves customer chat anonymous but never grants admin rooms by absence', async () => {
    let lookups = 0;
    const middleware = createSocketSessionAuth({ sessions: { async resolve() { lookups += 1; return null; } }, realm });
    const socket = socketFor({});
    assert.equal(await run(middleware, socket), null);
    assert.equal(socket.data.auth, null);
    assert.equal(lookups, 0);
});

test('socket session auth resolves a role-scoped admin identity without exposing raw token state', async () => {
    const queries = [];
    const middleware = createSocketSessionAuth({ sessions: { async resolve(value, options) {
        queries.push([value, options]);
        return { subject: 'admin@example.test', role: 'admin', realm };
    } }, realm });
    const socket = socketFor({ token });
    assert.equal(await run(middleware, socket), null);
    assert.deepEqual(queries, [[token, { realm }]]);
    assert.deepEqual(socket.data.auth, { subject: 'admin@example.test', role: 'admin', realm });
});

test('socket session auth rejects malformed, expired, wrong-realm, and database-failed tokens', async () => {
    const middleware = createSocketSessionAuth({ sessions: { async resolve(value) {
        if (value === 'b'.repeat(64)) return null;
        if (value === 'c'.repeat(64)) throw new Error('database');
        if (value === token) return { subject: 'user-1', role: 'user', realm: 'other-realm' };
        return { subject: 'user-1', role: 'user', realm };
    } }, realm });
    for (const [auth, expected] of [
        [{ token: 'bad' }, 'unauthorized'],
        [{ token: 'b'.repeat(64) }, 'unauthorized'],
        [{ token: 'c'.repeat(64) }, 'authentication_unavailable'],
        [{ token }, 'unauthorized']
    ]) {
        assert.equal((await run(middleware, socketFor(auth)))?.message, expected);
    }
});