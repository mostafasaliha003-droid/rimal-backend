const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createUserAuthRouter } = require('./services/userAuthRoutes');

function setup(t, { sendFails = false } = {}) {
    const users = [{ _id: 'u1', email: 'layla@example.test', name: 'Layla', password: 'old-hash', points: 0 }];
    function query(row) {
        const q = { select() { return q; }, lean: async () => row && { ...row }, exec: async () => row && Object.assign(row, { save: async () => row }) };
        return q;
    }
    function UserModel() {}
    UserModel.prototype.save = async () => {};
    UserModel.findOne = filter => query(users.find(u => (!filter.email || u.email === filter.email) && (!filter._id || u._id === filter._id)) || null);
    const sent = [], revoked = [], created = [];
    let clock = Date.parse('2026-11-27T10:00:00Z');
    const codes = ['111111', '222222', '333333'];
    const app = express(); app.use(express.json());
    app.use('/auth', createUserAuthRouter({
        UserModel, BookingModel: { find() {} },
        sessions: { create: async identity => { created.push(identity); return { token: 'f'.repeat(64) }; }, revokeAll: async who => { revoked.push(who); return 2; } },
        auth: { requireRole: () => (_req, _res, next) => next() },
        sendVerificationEmail: async () => true,
        sendPasswordResetEmail: async (email, code) => { if (sendFails) return false; sent.push({ email, code }); return true; },
        hashPassword: async password => `hashed:${password}`, comparePassword: async () => false,
        now: () => clock, randomCode: () => codes.shift() || '999999'
    }));
    const server = app.listen(0); t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/auth`;
    const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    return { post, users, sent, revoked, created, tick: ms => { clock += ms; } };
}

test('asking for a reset never reveals whether an account exists, and a code is re-sent at most once a minute', async t => {
    const s = setup(t);
    const unknown = await s.post('/password/forgot', { email: 'nobody@example.test' });
    assert.deepEqual([unknown.status, unknown.body.success], [200, true]);
    assert.equal(s.sent.length, 0);
    const known = await s.post('/password/forgot', { email: ' Layla@Example.test ' });
    assert.deepEqual([known.status, known.body], [unknown.status, unknown.body], 'same answer for both');
    assert.deepEqual(s.sent, [{ email: 'layla@example.test', code: '111111' }]);
    await s.post('/password/forgot', { email: 'layla@example.test' });
    assert.equal(s.sent.length, 1, 'no second e-mail within a minute');
    s.tick(61000);
    await s.post('/password/forgot', { email: 'layla@example.test' });
    assert.equal(s.sent[1].code, '222222');
    assert.equal((await s.post('/password/forgot', { email: 'not-an-email' })).status, 400);
});

test('the right code sets a new password, signs the account out everywhere and signs this device in', async t => {
    const s = setup(t);
    await s.post('/password/forgot', { email: 'layla@example.test' });
    assert.equal((await s.post('/password/reset', { email: 'layla@example.test', code: '000000', password: 'a-new-password' })).body.error, 'INVALID_RESET_CODE');
    assert.equal((await s.post('/password/reset', { email: 'layla@example.test', code: '111111', password: 'short' })).body.error, 'INVALID_PASSWORD');
    const ok = await s.post('/password/reset', { email: 'layla@example.test', code: '111111', password: 'a-new-password' });
    assert.equal(ok.status, 200); assert.equal(ok.body.access_token, 'f'.repeat(64)); assert.equal(ok.body.user.email, 'layla@example.test');
    assert.equal(s.users[0].password, 'hashed:a-new-password');
    assert.deepEqual(s.revoked, [{ subject: 'u1', role: 'user' }]);
    assert.equal((await s.post('/password/reset', { email: 'layla@example.test', code: '111111', password: 'another-password' })).body.error, 'INVALID_RESET_CODE', 'a code works once');
});

test('five wrong tries or ten minutes end a code', async t => {
    const s = setup(t);
    await s.post('/password/forgot', { email: 'layla@example.test' });
    for (let i = 0; i < 5; i++) await s.post('/password/reset', { email: 'layla@example.test', code: '000000', password: 'a-new-password' });
    assert.equal((await s.post('/password/reset', { email: 'layla@example.test', code: '111111', password: 'a-new-password' })).body.error, 'INVALID_RESET_CODE');
    s.tick(61000);
    await s.post('/password/forgot', { email: 'layla@example.test' });
    s.tick(10 * 60 * 1000 + 1);
    assert.equal((await s.post('/password/reset', { email: 'layla@example.test', code: '222222', password: 'a-new-password' })).body.error, 'INVALID_RESET_CODE');
    assert.equal(s.users[0].password, 'old-hash');
});

test('a reset e-mail that cannot be sent is reported, not pretended', async t => {
    const s = setup(t, { sendFails: true });
    const r = await s.post('/password/forgot', { email: 'layla@example.test' });
    assert.deepEqual([r.status, r.body.error], [503, 'PASSWORD_RESET_EMAIL_UNAVAILABLE']);
});
